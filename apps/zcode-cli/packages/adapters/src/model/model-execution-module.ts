import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type {
  CompiledModelOptionMaps,
  JsonObject,
  ModelOptionValues,
} from "@zcode/model-option-map";
import {
  getSharedModuleProviderLoader,
  ModuleProviderLoadError,
  type ModuleProviderLoader,
} from "./module-provider-loader.js";
import type { RawRequestBodyCapture } from "./model-option-map-fetch.js";

const MODULE_OPTION_MAP_ROOT_KEYS = new Set(["maxOutputTokens", "providerOptions"]);

export interface ModuleLanguageModelFactoryInput {
  readonly providerId: string;
  readonly module: string;
  readonly exportName?: string | null;
  readonly options?: Readonly<Record<string, unknown>> | null;
  readonly optionMaps?: CompiledModelOptionMaps;
  readonly optionValues?: ModelOptionValues;
  readonly rawRequestBodyCapture?: RawRequestBodyCapture;
  readonly loader?: ModuleProviderLoader;
}

export function createModuleLanguageModelFactory(
  input: ModuleLanguageModelFactoryInput,
): (modelId: string) => LanguageModelV3 {
  const loader = input.loader ?? getSharedModuleProviderLoader();
  return (modelId: string) =>
    new ModuleLanguageModel({
      ...input,
      modelId,
      loader,
    });
}

class ModuleLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider: string;
  readonly modelId: string;

  readonly #loader: ModuleProviderLoader;
  readonly #module: string;
  readonly #exportName?: string | null;
  readonly #options?: Readonly<Record<string, unknown>> | null;
  readonly #optionMaps?: CompiledModelOptionMaps;
  readonly #optionValues?: ModelOptionValues;
  readonly #rawRequestBodyCapture?: RawRequestBodyCapture;
  #delegatePromise?: Promise<LanguageModelV3>;

  constructor(
    input: ModuleLanguageModelFactoryInput & {
      readonly modelId: string;
      readonly loader: ModuleProviderLoader;
    },
  ) {
    this.provider = input.providerId;
    this.modelId = input.modelId;
    this.#loader = input.loader;
    this.#module = input.module;
    this.#exportName = input.exportName;
    this.#options = input.options;
    this.#optionMaps = input.optionMaps;
    this.#optionValues = input.optionValues;
    this.#rawRequestBodyCapture = input.rawRequestBodyCapture;
  }

  get supportedUrls(): PromiseLike<Record<string, RegExp[]>> {
    // 基础 Model 可在未发起请求时创建，加载失败应由实际请求处理。
    return this.#resolveDelegate().then(async (delegate) => (await delegate.supportedUrls) ?? {});
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const delegate = await this.#resolveDelegate();
    return delegate.doGenerate(this.#applyCallOptionMaps(options));
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const delegate = await this.#resolveDelegate();
    return delegate.doStream(this.#applyCallOptionMaps(options));
  }

  async #resolveDelegate(): Promise<LanguageModelV3> {
    this.#delegatePromise ??= this.#loadDelegate();
    return this.#delegatePromise;
  }

  async #loadDelegate(): Promise<LanguageModelV3> {
    const provider = await this.#loader.load({
      providerId: this.provider,
      module: this.#module,
      exportName: this.#exportName,
      options: this.#options,
    });
    const model = provider.languageModel(this.modelId);
    if (
      model?.specificationVersion !== "v3" ||
      typeof model.doGenerate !== "function" ||
      typeof model.doStream !== "function"
    ) {
      throw new ModuleProviderLoadError({
        code: "module-invalid-provider",
        providerId: this.provider,
        message: `languageModel(${JSON.stringify(this.modelId)}) must return LanguageModelV3 for provider ${this.provider}`,
      });
    }
    return model;
  }

  #applyCallOptionMaps(options: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
    if (!this.#optionMaps || !this.#optionValues) {
      return options;
    }

    const base: JsonObject = {};
    if (options.maxOutputTokens !== undefined) {
      (base as { maxOutputTokens?: number }).maxOutputTokens = options.maxOutputTokens;
    }
    if (options.providerOptions !== undefined) {
      (base as { providerOptions?: JsonObject }).providerOptions =
        options.providerOptions as JsonObject;
    }

    const patched = this.#optionMaps.apply(base, this.#optionValues);
    assertModuleOptionMapKeys(patched, this.provider);

    if (this.#rawRequestBodyCapture) {
      this.#rawRequestBodyCapture.body = patched;
    }

    const next: LanguageModelV3CallOptions = { ...options };
    if ("maxOutputTokens" in patched) {
      const value = patched.maxOutputTokens;
      if (value === null) {
        delete (next as { maxOutputTokens?: number }).maxOutputTokens;
      } else if (typeof value === "number") {
        next.maxOutputTokens = value;
      } else {
        throw new Error(
          `Module option map maxOutputTokens must be a number for provider ${this.provider}`,
        );
      }
    }
    if ("providerOptions" in patched) {
      const value = patched.providerOptions;
      if (value === null) {
        delete (next as { providerOptions?: LanguageModelV3CallOptions["providerOptions"] })
          .providerOptions;
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        next.providerOptions = value as LanguageModelV3CallOptions["providerOptions"];
      } else {
        throw new Error(
          `Module option map providerOptions must be an object for provider ${this.provider}`,
        );
      }
    }
    return next;
  }
}

function assertModuleOptionMapKeys(patched: JsonObject, providerId: string): void {
  for (const key of Object.keys(patched)) {
    if (!MODULE_OPTION_MAP_ROOT_KEYS.has(key)) {
      throw new Error(
        `Module option map produced unsupported root key "${key}" for provider ${providerId}`,
      );
    }
  }
}
