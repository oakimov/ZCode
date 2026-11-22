import type {
  AgentTelemetryRuntimeOwner,
  AgentExecutionTelemetryPort,
  ModelApiRuntimeSurface,
  ModelExecutionTelemetryPort,
  TelemetryIdentitySnapshot,
  TelemetryResourceContext,
} from "@zcode/contracts/telemetry";
import type { ModelStatusSink } from "@zcode/contracts/model";
import { NoopAgentExecutionTelemetry } from "./agent-trace-runtime.js";

type EnvRecord = Record<string, string | undefined>;

const TELEMETRY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const noopExecution = new NoopAgentExecutionTelemetry();

export interface CreateModelTelemetryOptions {
  owner?: AgentTelemetryRuntimeOwner;
  sessionId?: string;
}

export interface ModelTelemetryBootstrap {
  agentExecution: AgentExecutionTelemetryPort;
  enabled: boolean;
  modelExecution: ModelExecutionTelemetryPort;
  statusSink?: ModelStatusSink;
  shutdown(): Promise<void>;
}

export function createModelTelemetry(
  options: CreateModelTelemetryOptions = {},
): ModelTelemetryBootstrap {
  const { owner } = options;
  if (!owner) {
    return {
      agentExecution: noopExecution,
      enabled: false,
      modelExecution: noopExecution,
      async shutdown() {},
    };
  }
  return {
    agentExecution: owner.agentExecution,
    enabled: owner.enabled,
    modelExecution: owner.modelExecution,
    statusSink: owner.statusSink,
    async shutdown() {
      if (options.sessionId) owner.abandonSession(options.sessionId);
      // Session 只借用进程 Owner。关闭 Session 可以 flush，但不能关闭 Provider、Exporter、
      // Context Manager 或其他 Session 仍在使用的队列。
      await owner.flush({ timeoutMs: 1_500 });
    },
  };
}

export interface PrepareModelTelemetryOptions {
  buildCommitId?: string;
  cliVersion?: string;
  onWarning?: (message: string, context: Record<string, unknown>) => void;
  productVersion?: string;
  runtimeDistribution?: TelemetryResourceContext["runtimeDistribution"];
  runtimeSurface?: ModelApiRuntimeSurface;
}

export function resolveOtlpTraceEndpoint(env: EnvRecord): string | undefined {
  const traceEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (traceEndpoint) return validHttpUrl(traceEndpoint);
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!commonEndpoint) return undefined;
  const valid = validHttpUrl(commonEndpoint);
  if (!valid) return undefined;
  const parsed = new URL(valid);
  parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/traces`;
  return parsed.toString();
}

export function resolveOtlpMetricEndpoint(env: EnvRecord): string | undefined {
  const metricEndpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
  if (metricEndpoint) return validHttpUrl(metricEndpoint);
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (commonEndpoint) {
    const valid = validHttpUrl(commonEndpoint);
    if (!valid) return undefined;
    const parsed = new URL(valid);
    parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/metrics`;
    return parsed.toString();
  }
  // ARMS 的自定义 OTLP HTTP 接入点对 Trace/Metric 共用同一 URL；只有 traces 专用
  // 配置时沿用它，避免打包环境必须额外维护一套密钥和接入点。
  return resolveOtlpTraceEndpoint(env);
}

export function parseOtlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = safeDecode(pair.slice(0, separator).trim());
    const headerValue = safeDecode(pair.slice(separator + 1).trim());
    if (key && headerValue) headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export async function prepareModelTelemetryEnv(
  env: EnvRecord,
  _options: PrepareModelTelemetryOptions = {},
): Promise<EnvRecord> {
  // 本公开 fork 永久硬关闭模型遥测：忽略 OTLP endpoint 与 ZCODE_MODEL_TELEMETRY_ENABLED。
  // 见 docs/desktop/build-time-optional-capabilities.md。
  return env;
}

// 保留启动入口的生命周期 API；关闭态没有进程级 Owner。
export async function shutdownPreparedModelTelemetry(): Promise<void> {}

export function updatePreparedTelemetryIdentity(_snapshot: TelemetryIdentitySnapshot): void {}

export function normalizeTelemetryDeviceMid(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && TELEMETRY_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function validHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
