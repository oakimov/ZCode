import { resolve } from "node:path";

/**
 * 桌面构建期可选能力的唯一解析入口：ARMS RUM 上报、事件上报、自动更新。
 *
 * 本公开 fork 永久硬关闭这些能力：忽略环境变量与 config/private/build-defaults.json，
 * 始终返回空端点与 autoUpdateEnabled=false。规则见
 * docs/desktop/build-time-optional-capabilities.md。
 */
export const PRIVATE_BUILD_DEFAULTS_PATH = resolve(
  import.meta.dirname,
  "../config/private/build-defaults.json",
);

const DISABLED_BUILD_TIME_CONFIG = Object.freeze({
  armsRumEndpoint: "",
  telemetryReportEndpoint: "",
  autoUpdateEnabled: false,
});

export async function resolveBuildTimeConfig(_env = process.env, _options = {}) {
  // 永久硬关闭：不读 env，不读 private defaults，避免 fork 被重新打开。
  return { ...DISABLED_BUILD_TIME_CONFIG };
}

export function createBuildTimeConfigDefines(_config) {
  // 即使调用方传入非空 config，define 也强制关闭，防止误注入。
  return {
    __ZCODE_ARMS_RUM_ENDPOINT__: JSON.stringify(""),
    __ZCODE_TELEMETRY_REPORT_ENDPOINT__: JSON.stringify(""),
    __ZCODE_AUTO_UPDATE_ENABLED__: JSON.stringify(false),
  };
}
