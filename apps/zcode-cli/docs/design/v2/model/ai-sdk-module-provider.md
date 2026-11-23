# AI SDK Module Provider

> 状态：当前有效设计（与 `tasks/plans/ai-sdk-module-provider.md` 对齐）

## 目标

Personal Provider 可将模型执行交给 Worker 进程内加载的 AI SDK `ProviderV3` 模块，而不是 HTTP
线协议。模块路径写在 `provider_config.json`；ZCode 调用 `languageModel(modelId)`，经现有 runner
跑 `LanguageModelV3`。不启动独立 daemon / sidecar。

## 模块合同

```ts
type CreateProvider = (
  options: unknown,
  context: { providerId: string },
) => ProviderV3 | Promise<ProviderV3>;
```

- 命名导出默认 `createProvider`（可用 `api.export` 覆盖）。
- 返回对象必须有 `languageModel(modelId): LanguageModelV3`，且
  `specificationVersion: "v3"`；否则 typed `module-invalid-provider`。
- 仅支持 plain Node ESM（显式扩展名或单文件 bundle）。Bun/ bundler-only 无扩展名相对导入会
  `ERR_MODULE_NOT_FOUND`。
- ZCode 只传入 `options` 与 `{ providerId }`；不注入凭据、Endpoint 或额外环境变量。
- 信任级别与可写 `provider_config.json` 的主体相同（与 plugin hooks 同级）。

## Loader

`ModuleProviderLoader`（adapters 层）拥有文件 IO 与缓存：

1. `module` 必须是绝对路径或 `file:` URL；解析为 file URL。
2. 读取入口文件计算 SHA-256，再 `import()`。入口摘要按文件 URL 固定，独立于 Provider 实例。
3. Provider 实例缓存键：`(providerId, file URL, export, options digest)`。同一入口的不同 Provider 各自创建实例。
   ESM 不可卸载；使用其他 export、options 或 Provider ID 也不能绕过入口变更检测。运行中 hash 变化返回
   `module-changed-restart-required`。
4. 同一 Provider 的并发首次加载共享同一 pending；实例创建失败不缓存，下次重试。同一入口的文件路径与普通
   `file:` URL 使用相同身份；模块 URL 不允许 query 或 fragment。
5. 错误码：`module-not-found`、`module-export-missing`、`module-invalid-provider`、
   `module-load-failed`、`module-changed-restart-required`。

## 执行装配

- `AiSdkProviderKind` 增加 `"module"`。`toAiSdkProviderConfig` 映射
  `ai-sdk-module` → `{ kind: "module", module, exportName, options, access, providerOptions }`，
  无 `baseURL`。
- `createFactory` 的 `module` 分支返回同步构造的 `ModuleLanguageModel`。首次读取 `supportedUrls` 或调用
  `doGenerate` / `doStream` 才启动加载；加载异常由实际请求处理。跳过 HTTP transport
  链；runner 的 retry / idle timeout / telemetry / Model IO / failure classification 保持不变。
- Option Map 合并到 call options `{ maxOutputTokens?, providerOptions? }`；根键之外拒绝。

## Config

见 Registry
[`configuration.md`](../../../../../../docs/working-memory/provider-refactor/design/registry/configuration.md)
与
[`model-creation.md`](../../../../../../docs/working-memory/provider-refactor/design/registry/model-creation.md)。
`access.type: "none"` 与 `api.type: "ai-sdk-module"` 双向绑定。
