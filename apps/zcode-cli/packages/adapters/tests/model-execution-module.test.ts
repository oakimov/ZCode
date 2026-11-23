import { describe, expect, it } from "vitest";
import { compileModelOptionMaps } from "@zcode/model-option-map";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { createModuleLanguageModelFactory } from "../src/model/model-execution-module.js";
import { ModuleProviderLoader } from "../src/model/module-provider-loader.js";
import type { RawRequestBodyCapture } from "../src/model/model-option-map-fetch.js";

describe("ModuleLanguageModel", () => {
  it("leaves module loading to the request and surfaces errors through its caller", async () => {
    let imports = 0;
    const loader = new ModuleProviderLoader({
      realPath: async (path) => path,
      readFileBytes: async () => Buffer.from("invalid module"),
      importModule: async () => {
        imports += 1;
        throw new Error("fixture module failed");
      },
    });
    const factory = createModuleLanguageModelFactory({
      providerId: "example",
      module: "/tmp/example.mjs",
      loader,
    });
    const unused = factory("unused") as unknown as LanguageModelV3;
    const active = factory("active") as unknown as LanguageModelV3;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(imports).toBe(0);
    await expect(Promise.resolve(active.supportedUrls)).rejects.toMatchObject({
      code: "module-load-failed",
    });
    expect(unused.modelId).toBe("unused");
    expect(imports).toBe(1);
  });

  it("applies option maps to call options and records them", async () => {
    const recorded: LanguageModelV3CallOptions[] = [];
    const fakeModel: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "fake",
      modelId: "model-a",
      supportedUrls: {},
      async doGenerate(options) {
        recorded.push(options);
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error("unused");
      },
    };
    const loader = new ModuleProviderLoader({
      realPath: async (path) => path,
      readFileBytes: async () => Buffer.from("unused"),
      importModule: async () => ({
        createProvider: () => ({
          languageModel: () => fakeModel,
        }),
      }),
    });
    const maps = compileModelOptionMaps({
      reasoningLevel: {
        map: '{"providerOptions":{"zcode":{"reasoningLevel":reasoningLevel}}}',
      },
      maxOutputTokens: {
        map: '{"maxOutputTokens":maxOutputTokens}',
      },
    });
    const capture: RawRequestBodyCapture = {};
    const factory = createModuleLanguageModelFactory({
      providerId: "example",
      module: "/tmp/example.mjs",
      optionMaps: maps,
      optionValues: { reasoningLevel: "high", maxOutputTokens: 128 },
      rawRequestBodyCapture: capture,
      loader,
    });
    const model = factory("model-a") as unknown as LanguageModelV3;
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.maxOutputTokens).toBe(128);
    expect(recorded[0]?.providerOptions).toEqual({
      zcode: { reasoningLevel: "high" },
    });
    expect(capture.body).toEqual({
      maxOutputTokens: 128,
      providerOptions: { zcode: { reasoningLevel: "high" } },
    });
  });

  it("rejects option map patches with unsupported root keys", async () => {
    const fakeModel: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "fake",
      modelId: "model-a",
      supportedUrls: {},
      async doGenerate() {
        throw new Error("should not run");
      },
      async doStream() {
        throw new Error("unused");
      },
    };
    const loader = new ModuleProviderLoader({
      realPath: async (path) => path,
      readFileBytes: async () => Buffer.from("unused"),
      importModule: async () => ({
        createProvider: () => ({
          languageModel: () => fakeModel,
        }),
      }),
    });
    const maps = compileModelOptionMaps({
      reasoningLevel: {
        map: '{"temperature":1}',
      },
      maxOutputTokens: {
        map: "{}",
      },
    });
    const factory = createModuleLanguageModelFactory({
      providerId: "example",
      module: "/tmp/example.mjs",
      optionMaps: maps,
      optionValues: { reasoningLevel: "high", maxOutputTokens: 1 },
      loader,
    });
    const model = factory("model-a") as unknown as LanguageModelV3;
    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toThrow(/unsupported root key "temperature"/);
  });
});
