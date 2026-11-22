# 公开 fork：Desktop GitHub Releases

## 目标

`oakimov/ZCode` 通过 `.github/workflows/release-desktop.yml` 构建桌面安装包，并上传到
GitHub Releases。本 fork 的遥测 / ARMS / OTEL / 自动更新永久硬关闭，见
[build-time-optional-capabilities.md](./build-time-optional-capabilities.md)。

## 触发

- 推送 `v*` tag
- `workflow_dispatch`（可选 `tag`、`os`：`mac` / `win` / `linux` / `all`）
- 手动运行时，未填写 tag 则使用触发的 tag，或在从分支运行时使用 `desktop-<commit SHA>`。已有 tag 必须指向本次构建的 commit，新 tag 也从该 commit 创建。

## 流水线

1. `scripts/assert-telemetry-hard-disabled.mjs` fail-closed
2. `pnpm bootstrap`
3. `pnpm bundle:desktop -- --os <os> --arch <arch>`（默认未签名 macOS；Windows/Linux 用对应 runner）
4. 再次跑 telemetry 门禁
5. 将 `packages/desktop/dist` 产物发布到 GitHub Release

| 平台        | 发布文件                        |
| ----------- | ------------------------------- |
| macOS arm64 | DMG、ZIP                        |
| Windows x64 | NSIS EXE                        |
| Linux x64   | AppImage、DEB、RPM、PKG.TAR.ZST |

构建任务使用只读仓库权限，发布任务单独持有写权限。针对同一 tag 的发布任务串行运行。

## 本地预检

```bash
node scripts/assert-telemetry-hard-disabled.mjs
node --test scripts/test/build-time-config.test.mjs
```

未签名 macOS 包首次打开若被拦截：

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode.app
```
