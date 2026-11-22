# 公开 fork：关闭启动强制登录入口

## 目标

本公开 fork **永久关闭**桌面启动时因「未登录且无可用模型 provider」而强制弹出的
WelcomeScreen / z.ai 登录入口（`welcomeScreenOpenReason === "startup-provider-required"`）。

用户仍可从下列入口主动打开登录：

- 手动 Login（`manual-login`）
- Settings / provider 连接请求（`provider-request`）
- JWT 过期（`session-expired`）
- 登出后无可用 provider（`logout-provider-required`）

## 状态所有者

| 状态 | 所有者 | 说明 |
| ---- | ------ | ---- |
| `welcomeScreenOpenReason` | `packages/ui/src/Root.tsx` | 唯一决定 WelcomeScreen 是否展示 |
| 启动 provider 可用性守卫开关 | `shouldEnableProviderAvailabilityLoginEntryGuard`（`packages/ui/src/lib/rootStartupGate.ts`） | 本 fork 恒为 `false` |
| 守卫实现 | `useProviderAvailabilityLoginEntryGuard` | `enabled=false` 时不调用 `setLoginEntryOpen(true)`，并立即完成启动检查 |

## 规则

1. `shouldEnableProviderAvailabilityLoginEntryGuard` 恒返回 `false`，忽略
   `isWebRemoteControlRoot`（远控本来也不启用该守卫）。
2. 不通过设置、环境变量或 private defaults 重新打开启动强制登录。
3. 不修改 OccupationOnboarding / 会话迁移弹窗的触发语义（本变更不覆盖）。

## 验收

1. 无 OAuth 用户、无可用 API Key/provider 时，冷启动进入工作区壳层，不自动弹出 WelcomeScreen。
2. 点击手动 Login 或 Settings 连接 provider 仍可打开 WelcomeScreen。
3. `pnpm typecheck` / `pnpm lint` 通过。
