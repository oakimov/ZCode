import { describe, expect, it } from "vitest";
import {
  NoneAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  createRegistryProviderConfig,
} from "@zcode/provider";
import { ApiKeyAccessConfig } from "@zcode/provider";

describe("ai-sdk-module provider schema", () => {
  it("accepts a complete module provider with access none", () => {
    const config = new ProviderConfig({
      group: "standard-personal",
      access: new NoneAccessConfig(),
      api: new ProviderApiConfig({
        type: "ai-sdk-module",
        module: "/tmp/example-provider.mjs",
        export: "createProvider",
        options: { region: "us" },
      }),
      personalModelIds: ["model-a"],
      visibility: "visible",
    });
    const result = createRegistryProviderConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.api.type).toBe("ai-sdk-module");
      expect(result.config.access.type).toBe("none");
    }
  });

  it("rejects module provider with api-key access", () => {
    const config = new ProviderConfig({
      group: "standard-personal",
      access: new ApiKeyAccessConfig({ apiKey: "secret" }),
      api: new ProviderApiConfig({
        type: "ai-sdk-module",
        module: "/tmp/example-provider.mjs",
      }),
      personalModelIds: ["model-a"],
      visibility: "visible",
    });
    const result = createRegistryProviderConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes("access"))).toBe(true);
    }
  });

  it("rejects none access with HTTP api type", () => {
    const config = new ProviderConfig({
      group: "standard-personal",
      access: new NoneAccessConfig(),
      api: new ProviderApiConfig({
        type: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
      }),
      personalModelIds: ["model-a"],
      visibility: "visible",
    });
    const result = createRegistryProviderConfig(config);
    expect(result.ok).toBe(false);
  });

  it.each(["./relative.mjs", "file:///tmp/provider.mjs?reload", "file:///tmp/provider.mjs#other"])("rejects unsupported module path %s", (module) => {
    const config = new ProviderConfig({
      group: "standard-personal",
      access: new NoneAccessConfig(),
      api: new ProviderApiConfig({
        type: "ai-sdk-module",
        module,
      }),
      personalModelIds: ["model-a"],
      visibility: "visible",
    });
    const result = createRegistryProviderConfig(config);
    expect(result.ok).toBe(false);
  });

  it("rejects baseUrl on module api type via complete schema", () => {
    const api = new ProviderApiConfig({
      type: "ai-sdk-module",
      module: "/tmp/example-provider.mjs",
      baseUrl: "https://example.com",
    });
    // toJSON still carries baseUrl for sparse overlay; complete discriminated union rejects it.
    const issues = api.validateComplete(["api"]);
    expect(issues.length).toBeGreaterThan(0);
  });
});
