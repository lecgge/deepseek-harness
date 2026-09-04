# Agent Note: Electron host for the DSH Web profile

Status: implemented

[English](2026-09-04-dsh-desktop-host.md) | 中文

## Problem

Web profile 需要一个不依赖 Node.js 或 pnpm 的 Windows 桌面发行版，并且能在 DSH harness 高速迭代时保持更新。在桌面壳中重做 HTTP、cookie、RPC、WebSocket 或前端行为，会使客户端耦合到 DSH 内部实现细节。

## Decision

`apps/desktop` 是一个不依赖任何 DSH workspace 包的 Electron 应用。主进程通过 `web --no-open --host 127.0.0.1 --port 0` 启动带版本的独立 runtime，分配每用户 `DSH_HOME`，从 stdout 验证带 token 的 `dsh web:` URL，并在 BrowserWindow 中加载它。窗口启用 context isolation 和 sandbox，禁用 Node integration，仅允许跳转到活动 loopback origin，并拒绝新窗口、权限请求和下载。

Electron 应用将 runtime 可执行文件和 ripgrep sidecar 作为 `extraResources` 打包。退出时，它通过 Windows `taskkill /T /F` 终止直接 runtime 进程及其后代。runtime 发布 workflow 会在构建 runtime 后构建安装程序，并把 `DeepSeek-Harness-Setup-<version>-x64.exe`、两个 runtime 文件和 `SHA256SUMS` 上传到以提交标识的 prerelease。

## Alternatives considered

**使用 `file://` 前端和 IPC transport** 需要为 Web fetch、stream、bundle loading 和认证提供桌面专用实现，因此会跟随 Web transport 的变化。

**在 Electron 中嵌入 DSH 包** 会让桌面应用与 harness 使用同一源码和依赖图，无法保持独立版本化的宿主打包。

**打开系统浏览器** 可以保留现有 profile，但无法提供所需的桌面客户端和应用生命周期管理。

## Consequences

桌面客户端将 DSH 视为独立发布的本地服务，并保持现有 Web 用户行为不变。桌面安装程序会增加 Electron shell 和 runtime payload；在配置签名证书前，Windows 会继续显示未签名安装警告。宿主只信任由其 loopback runtime 输出的认证 URL，并且不会在初次跳转之外保留 token。
