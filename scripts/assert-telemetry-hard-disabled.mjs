#!/usr/bin/env node

/**
 * CI / 本地门禁：本公开 fork 的遥测、ARMS、OTEL、自动更新必须保持硬关闭。
 * 若环境变量或构建解析结果非空 / 启用，立即失败。
 */
import { resolveBuildTimeConfig, createBuildTimeConfigDefines } from "./build-time-config.mjs";

const FORBIDDEN_ENV_KEYS = [
  "ZCODE_ARMS_RUM_ENDPOINT",
  "ZCODE_TELEMETRY_REPORT_ENDPOINT",
  "ZCODE_AUTO_UPDATE",
  "ZCODE_PACKAGED_AGENT_OTEL_ENDPOINT",
  "ZCODE_PACKAGED_AGENT_OTEL_HEADERS",
  "ZCODE_PACKAGED_AGENT_OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "OTEL_EXPORTER_OTLP_HEADERS",
];

function fail(message) {
  console.error(`[telemetry-hard-disabled] ${message}`);
  process.exit(1);
}

const nonEmptyForbidden = FORBIDDEN_ENV_KEYS.filter((key) => {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "";
});
if (nonEmptyForbidden.length > 0) {
  fail(`forbidden non-empty env: ${nonEmptyForbidden.join(", ")}`);
}

if (process.env.ZCODE_MODEL_TELEMETRY_ENABLED?.trim()) {
  const enabled = !["0", "false", "off", "disabled"].includes(
    process.env.ZCODE_MODEL_TELEMETRY_ENABLED.trim().toLowerCase(),
  );
  if (enabled) {
    fail("ZCODE_MODEL_TELEMETRY_ENABLED must stay disabled in this fork");
  }
}

const config = await resolveBuildTimeConfig(process.env);
if (
  config.armsRumEndpoint !== "" ||
  config.telemetryReportEndpoint !== "" ||
  config.autoUpdateEnabled !== false
) {
  fail("resolveBuildTimeConfig returned enabled config");
}

const defines = createBuildTimeConfigDefines({
  armsRumEndpoint: "https://should-not-inject.example",
  telemetryReportEndpoint: "https://should-not-inject.example",
  autoUpdateEnabled: true,
});
if (
  defines.__ZCODE_ARMS_RUM_ENDPOINT__ !== '""' ||
  defines.__ZCODE_TELEMETRY_REPORT_ENDPOINT__ !== '""' ||
  defines.__ZCODE_AUTO_UPDATE_ENABLED__ !== "false"
) {
  fail("createBuildTimeConfigDefines returned non-disabled defines");
}

console.log("[telemetry-hard-disabled] OK: telemetry/ARMS/OTEL/auto-update stay disabled");
