import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProviderV3 } from "@ai-sdk/provider";
import { isAbsoluteModulePathOrFileUrl } from "@zcode/provider";

export type ModuleProviderLoadErrorCode =
  | "module-not-found"
  | "module-export-missing"
  | "module-invalid-provider"
  | "module-load-failed"
  | "module-changed-restart-required";

export class ModuleProviderLoadError extends Error {
  readonly code: ModuleProviderLoadErrorCode;
  readonly providerId: string;

  constructor(input: {
    readonly code: ModuleProviderLoadErrorCode;
    readonly message: string;
    readonly providerId: string;
    readonly cause?: unknown;
  }) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined);
    this.name = "ModuleProviderLoadError";
    this.code = input.code;
    this.providerId = input.providerId;
  }
}

export type CreateProviderExport = (
  options: unknown,
  context: { readonly providerId: string },
) => ProviderV3 | Promise<ProviderV3>;

export interface ModuleProviderLoaderInput {
  readonly providerId: string;
  readonly module: string;
  readonly exportName?: string | null;
  readonly options?: Readonly<Record<string, unknown>> | null;
}

export interface ModuleProviderLoaderDeps {
  readonly realPath?: (absolutePath: string) => Promise<string>;
  readonly readFileBytes?: (absolutePath: string) => Promise<Buffer>;
  readonly importModule?: (fileUrl: string) => Promise<Record<string, unknown>>;
}

const DEFAULT_EXPORT_NAME = "createProvider";

export class ModuleProviderLoader {
  readonly #entryHashes = new Map<string, string>();
  readonly #providers = new Map<string, Promise<ProviderV3>>();
  readonly #realPath: (absolutePath: string) => Promise<string>;
  readonly #readFileBytes: (absolutePath: string) => Promise<Buffer>;
  readonly #importModule: (fileUrl: string) => Promise<Record<string, unknown>>;

  constructor(deps: ModuleProviderLoaderDeps = {}) {
    this.#realPath = deps.realPath ?? realpath;
    this.#readFileBytes = deps.readFileBytes ?? ((path) => readFile(path));
    this.#importModule =
      deps.importModule ??
      (async (fileUrl) => (await import(fileUrl)) as Record<string, unknown>);
  }

  async load(input: ModuleProviderLoaderInput): Promise<ProviderV3> {
    if (!isAbsoluteModulePathOrFileUrl(input.module)) {
      throw new ModuleProviderLoadError({
        code: "module-not-found",
        providerId: input.providerId,
        message: `Module path must be absolute or a file: URL for provider ${input.providerId}`,
      });
    }

    let absolutePath: string;
    try {
      const value = input.module.trim();
      if (/^file:/i.test(value)) {
        const url = new URL(value);
        if (url.search || url.hash) throw new Error("Unsupported file URL suffix");
        absolutePath = fileURLToPath(url);
      } else {
        if (!isAbsolute(value)) throw new Error("Path must be absolute on the Worker platform");
        absolutePath = value;
      }
    } catch (error) {
      throw new ModuleProviderLoadError({
        code: "module-not-found",
        providerId: input.providerId,
        message: `Invalid module path for provider ${input.providerId}`,
        cause: error,
      });
    }

    try {
      absolutePath = await this.#realPath(absolutePath);
    } catch (error) {
      throw new ModuleProviderLoadError({
        code: "module-not-found",
        providerId: input.providerId,
        message: `Module file could not be resolved for provider ${input.providerId}`,
        cause: error,
      });
    }
    // Node 按实际入口缓存代码，同一个文件的符号链接也要共用变更检查。
    const fileUrl = pathToFileURL(absolutePath).href;
    const digest = await this.#readDigest(absolutePath, input.providerId);
    const previousDigest = this.#entryHashes.get(fileUrl);
    if (previousDigest !== undefined) this.#assertDigest(input.providerId, previousDigest, digest);
    // Node 按入口 URL 缓存代码。更换实例配置或导出名不能绕过变更检查。
    this.#entryHashes.set(fileUrl, digest);

    const exportName = input.exportName?.trim() || DEFAULT_EXPORT_NAME;
    const cacheKey = JSON.stringify([input.providerId, fileUrl, exportName, stableJsonDigest(input.options ?? {})]);
    const cached = this.#providers.get(cacheKey);
    if (cached) return cached;

    const provider = this.#createProvider(input, fileUrl, exportName).then(async (value) => {
      this.#assertDigest(input.providerId, digest, await this.#readDigest(absolutePath, input.providerId));
      return value;
    });
    this.#providers.set(cacheKey, provider);
    try {
      return await provider;
    } catch (error) {
      if (this.#providers.get(cacheKey) === provider) this.#providers.delete(cacheKey);
      throw error;
    }
  }

  clear(): void {
    this.#providers.clear();
  }

  async #createProvider(input: ModuleProviderLoaderInput, fileUrl: string, exportName: string): Promise<ProviderV3> {
    let namespace: Record<string, unknown>;
    try {
      namespace = await this.#importModule(fileUrl);
    } catch (error) {
      throw new ModuleProviderLoadError({
        code: "module-load-failed",
        providerId: input.providerId,
        message: `Failed to import module for provider ${input.providerId}`,
        cause: error,
      });
    }

    const exported = namespace[exportName];
    if (typeof exported !== "function") {
      throw new ModuleProviderLoadError({
        code: "module-export-missing",
        providerId: input.providerId,
        message: `Module export "${exportName}" is missing or not a function for provider ${input.providerId}`,
      });
    }

    let provider: ProviderV3;
    try {
      provider = await (exported as CreateProviderExport)(input.options ?? {}, {
        providerId: input.providerId,
      });
    } catch (error) {
      throw new ModuleProviderLoadError({
        code: "module-load-failed",
        providerId: input.providerId,
        message: `createProvider threw for provider ${input.providerId}`,
        cause: error,
      });
    }

    assertValidProvider(provider, input.providerId);
    return provider;
  }

  async #readDigest(absolutePath: string, providerId: string): Promise<string> {
    try {
      return sha256Hex(await this.#readFileBytes(absolutePath));
    } catch (error) {
      throw new ModuleProviderLoadError({
        code: "module-not-found",
        providerId,
        message: `Module file could not be read for provider ${providerId}`,
        cause: error,
      });
    }
  }

  #assertDigest(providerId: string, expected: string, current: string): void {
    if (current !== expected) {
      throw new ModuleProviderLoadError({
        code: "module-changed-restart-required",
        providerId,
        message: `Module file changed for provider ${providerId}; restart the Worker to reload`,
      });
    }
  }
}

function assertValidProvider(provider: ProviderV3, providerId: string): void {
  // 不在 load 时用假 modelId 探测：真实 provider 可能对未知 id 直接抛错。
  // specificationVersion 在 ModuleLanguageModel 首次解析真实 modelId 时校验。
  if (
    provider == null ||
    (typeof provider !== "object" && typeof provider !== "function") ||
    typeof provider.languageModel !== "function"
  ) {
    throw new ModuleProviderLoadError({
      code: "module-invalid-provider",
      providerId,
      message: `Module did not return a ProviderV3 with languageModel() for provider ${providerId}`,
    });
  }
}

function stableJsonDigest(value: unknown): string {
  return sha256Hex(Buffer.from(stableStringify(value), "utf8"));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let sharedLoader: ModuleProviderLoader | undefined;

export function getSharedModuleProviderLoader(): ModuleProviderLoader {
  sharedLoader ??= new ModuleProviderLoader();
  return sharedLoader;
}
