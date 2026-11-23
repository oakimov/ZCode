import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ModuleProviderLoadError,
  ModuleProviderLoader,
} from "../src/model/module-provider-loader.js";

const loaders: ModuleProviderLoader[] = [];
const moduleDirs: string[] = [];

afterEach(async () => {
  for (const loader of loaders) loader.clear();
  loaders.length = 0;
  await Promise.all(moduleDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeModule(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-module-provider-"));
  moduleDirs.push(dir);
  const path = join(dir, "provider.mjs");
  await writeFile(path, source, "utf8");
  return path;
}

function createLoader(deps?: ConstructorParameters<typeof ModuleProviderLoader>[0]) {
  const loader = new ModuleProviderLoader(deps);
  loaders.push(loader);
  return loader;
}

describe("ModuleProviderLoader", () => {
  it("isolates provider IDs sharing a callable factory and entry", async () => {
    const path = await writeModule(`
      export function createProvider(options, { providerId }) {
        return Object.assign(() => {}, { languageModel: () => ({ provider: providerId }) });
      }
    `);
    const loader = createLoader();
    const [first, second] = await Promise.all([
      loader.load({ providerId: "first", module: path }),
      loader.load({ providerId: "second", module: path }),
    ]);
    expect(first.languageModel("model").provider).toBe("first");
    expect(second.languageModel("model").provider).toBe("second");
  });

  it("loads a valid provider export", async () => {
    const path = await writeModule(`
      export function createProvider() {
        return {
          languageModel(modelId) {
            return {
              specificationVersion: "v3",
              provider: "test",
              modelId,
              supportedUrls: {},
              async doGenerate() { throw new Error("unused"); },
              async doStream() { throw new Error("unused"); },
            };
          },
        };
      }
    `);
    const loader = createLoader();
    const provider = await loader.load({
      providerId: "example",
      module: path,
    });
    expect(typeof provider.languageModel).toBe("function");
    expect(provider.languageModel("a").specificationVersion).toBe("v3");
  });

  it("fails when export is missing", async () => {
    const path = await writeModule(`export const other = 1;\n`);
    const loader = createLoader();
    await expect(
      loader.load({ providerId: "example", module: path }),
    ).rejects.toMatchObject({ code: "module-export-missing" } satisfies Partial<ModuleProviderLoadError>);
  });

  it("fails when createProvider returns an invalid provider", async () => {
    const path = await writeModule(`
      export function createProvider() {
        return { notLanguageModel: true };
      }
    `);
    const loader = createLoader();
    await expect(
      loader.load({ providerId: "example", module: path }),
    ).rejects.toMatchObject({ code: "module-invalid-provider" });
  });

  it("fails when the module file is missing", async () => {
    const loader = createLoader();
    await expect(
      loader.load({
        providerId: "example",
        module: join(tmpdir(), "missing-zcode-module-provider.mjs"),
      }),
    ).rejects.toMatchObject({ code: "module-not-found" });
  });

  it("shares one pending load for concurrent first calls", async () => {
    let imports = 0;
    const path = await writeModule(`
      export function createProvider() {
        return {
          languageModel(modelId) {
            return {
              specificationVersion: "v3",
              provider: "test",
              modelId,
              supportedUrls: {},
              async doGenerate() { throw new Error("unused"); },
              async doStream() { throw new Error("unused"); },
            };
          },
        };
      }
    `);
    const fileUrl = pathToFileURL(path).href;
    const loader = createLoader({
      importModule: async (url) => {
        imports += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return (await import(url)) as Record<string, unknown>;
      },
    });
    const [a, b] = await Promise.all([
      loader.load({ providerId: "example", module: path }),
      loader.load({ providerId: "example", module: path }),
    ]);
    expect(a).toBe(b);
    expect(imports).toBe(1);
    expect(fileUrl).toContain("provider.mjs");
  });

  it("rejects a changed module file after successful load", async () => {
    const path = await writeModule(`
      export function createProvider() {
        return {
          languageModel(modelId) {
            return {
              specificationVersion: "v3",
              provider: "test",
              modelId,
              supportedUrls: {},
              async doGenerate() { throw new Error("unused"); },
              async doStream() { throw new Error("unused"); },
            };
          },
        };
      }
    `);
    const loader = createLoader();
    await loader.load({ providerId: "example", module: path });
    await writeFile(path, "// changed\nexport function createProvider() { return { languageModel() { return null; } }; }\n", "utf8");
    await expect(
      loader.load({ providerId: "example", module: path }),
    ).rejects.toMatchObject({ code: "module-changed-restart-required" });
    await expect(
      loader.load({ providerId: "example", module: pathToFileURL(path).href, options: { changed: true } }),
    ).rejects.toMatchObject({ code: "module-changed-restart-required" });
    if (process.platform !== "win32") {
      const alias = join(dirname(path), "alias.mjs");
      await symlink(path, alias);
      await expect(
        loader.load({ providerId: "example", module: alias }),
      ).rejects.toMatchObject({ code: "module-changed-restart-required" });
    }
  });
});
