# 桌面构建期可选能力（本 fork：永久关闭）

## 目标

本公开 fork 将下列能力**永久硬关闭**：不能通过设置、环境变量或
`config/private/build-defaults.json` 重新打开。

| 能力                                       | 配置项                                          | 关闭时的行为                                                              |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| ARMS RUM 上报                              | `ZCODE_ARMS_RUM_ENDPOINT`                       | 主进程与渲染进程的 ARMS SDK 以 `enable: false` 初始化，不产生上报         |
| 事件上报（数仓）                           | `ZCODE_TELEMETRY_REPORT_ENDPOINT`               | 上报入口直接返回，不读取凭据或更新上报状态                                |
| 自动更新                                   | `ZCODE_AUTO_UPDATE`                             | 不检查、不下载更新                                                        |
| Packaged Agent OTLP                        | `ZCODE_PACKAGED_AGENT_OTEL_*`                   | Desktop 打包永不注入 OTEL 环境                                            |
| Desktop Renderer Action Trace / Local TTFT | OTLP endpoint、运行时开关和远端配置             | Main 不创建 exporter 或查询 trace rollout；Renderer 的 trace 配置保持关闭 |
| CLI 模型遥测                               | `ZCODE_MODEL_TELEMETRY_ENABLED` / OTLP endpoint | `prepareModelTelemetryEnv` 永久 no-op                                     |

## 配置来源（本 fork）

`scripts/build-time-config.mjs` 是唯一解析入口，但**固定返回空端点与
`autoUpdateEnabled: false`**，并忽略：

1. 构建进程环境变量（即使显式设置非空值）
2. `config/private/build-defaults.json`（即使文件存在）

`packages/shared/src/env.ts` 与运行时代码再做一层硬锁定，避免 define / 运行时
env 绕过。CI 通过 `scripts/assert-telemetry-hard-disabled.mjs` fail-closed。

## 所有者与数据流

```
scripts/build-time-config.mjs（硬返回关闭）
        ▼
desktop tsup / vite define（恒为空 / false）
        ▼
@zcode/shared env 常量（恒为空 / false，忽略 define）
        ▼
ARMS / telemetryCore / autoUpdater / packaged Agent OTEL / CLI model telemetry
均为 no-op
```

- 自动更新判定：`ZCODE_PRODUCT_FLAVOR === "production" && ZCODE_AUTO_UPDATE_ENABLED`；
  后者在本 fork 恒为 `false`。
- Agent OTLP：`resolveBuildPackagedAgentTelemetryEnv` 恒返回 `{}`，release/CI 也不再要求配置。

## 验收

1. 存在私有默认配置或非空遥测相关环境变量时，构建结果仍全部关闭。
2. `node --test scripts/test/build-time-config.test.mjs` 通过。
3. `node scripts/assert-telemetry-hard-disabled.mjs` 在 CI 与本地检查遥测环境和构建期定义。运行时关闭态由对应入口的回归验证覆盖。
4. 类型检查、Lint 与相关工程测试通过。
