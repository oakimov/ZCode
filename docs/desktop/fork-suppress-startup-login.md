# 公开 fork：关闭启动强制登录入口

## 目标

本公开 fork 不因缺少 provider、退出登录、缓存会话过期或后台会话撤销而自动打开
WelcomeScreen / z.ai 登录入口。应用清理失效的会话并继续显示工作区。关闭营销投放的
后台查询、自动弹窗、横幅和交互上报。

用户仍可从下列入口主动打开登录：

- 手动 Login（`manual-login`）
- Settings / provider 连接请求（`provider-request`）

## 状态所有者

| 状态                         | 所有者                                                                                        | 说明                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `welcomeScreenOpenReason`    | `packages/ui/src/Root.tsx`                                                                    | 唯一决定 WelcomeScreen 是否展示                                        |
| 启动 provider 可用性守卫开关 | `shouldEnableProviderAvailabilityLoginEntryGuard`（`packages/ui/src/lib/rootStartupGate.ts`） | 本 fork 恒为 `false`                                                   |
| 守卫实现                     | `useProviderAvailabilityLoginEntryGuard`                                                      | `enabled=false` 时不调用 `setLoginEntryOpen(true)`，并立即完成启动检查 |
| 凭据失效                     | OAuth 服务和 `useRootOAuthEffects`                                                            | 服务清理凭据；根组件收到恢复结果或失效事件后更新账号展示               |
| 营销投放                     | Host 服务集合和 `Root`                                                                        | Host 不注册营销服务，根组件不启动营销控制器                            |

```text
OAuth 服务清理凭据 → 启动恢复结果或失效广播 → 根组件清空账号展示 → 工作区保留
主动选择登录或连接 provider → 根组件打开 WelcomeScreen
```

## 规则

1. `shouldEnableProviderAvailabilityLoginEntryGuard` 恒返回 `false`，忽略
   `isWebRemoteControlRoot`（远控本来也不启用该守卫）。
2. 不通过设置、环境变量或 private defaults 重新打开启动强制登录。
3. 已过期的缓存会话和撤销事件只更新仍然失效的登录态，保留已完成的新登录。
4. OccupationOnboarding / 会话迁移按各自的规则运行。

## 验收

1. 无 OAuth 用户、无可用 API Key/provider 时，冷启动进入工作区壳层，不自动弹出 WelcomeScreen。
2. 点击手动 Login 或 Settings 连接 provider 仍可打开 WelcomeScreen。
3. 过期 JWT 冷启动时清理凭据并进入工作区。主动选择登录仍显示 OAuth 渠道和地区切换。
4. 营销测试服务器配置弹窗与横幅后，匿名重启及触发 `online` 事件均不产生营销请求或界面。
