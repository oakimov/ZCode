import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetCapturedZCodeAgentTelemetryEnvForTest,
  sanitizeZCodeRuntimeEnvInPlace,
} from "@zcode/shared";
import { afterEach, describe, expect, it } from "vitest";
import { prepareZCodeTelemetryEnv } from "../src/telemetry-bootstrap.js";

describe("prepareZCodeTelemetryEnv", () => {
  afterEach(() => {
    resetCapturedZCodeAgentTelemetryEnvForTest();
  });

  it("忽略捕获的 OTLP 配置，不生成遥测 identity 或写回凭据", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-bootstrap-telemetry-"));
    try {
      const env: NodeJS.ProcessEnv = {
        OTEL_EXPORTER_OTLP_HEADERS: "x-arms-license-key=secret",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example/v1/traces",
        ZCODE_HOME: root,
      };
      sanitizeZCodeRuntimeEnvInPlace(env);

      const prepared = await prepareZCodeTelemetryEnv(env);

      expect(prepared.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
      expect(prepared.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
      expect(prepared.ZCODE_TELEMETRY_DEVICE_MID).toBeUndefined();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
