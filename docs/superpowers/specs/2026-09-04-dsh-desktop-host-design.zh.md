# DSH 桌面宿主设计

[English](2026-09-04-dsh-desktop-host-design.md) | 中文

## 目标

提供一个 Windows 桌面可执行文件，在嵌入式浏览器窗口中运行现有 DSH Web profile。桌面宿主与 DSH 保持为独立进程和发布单元。宿主不导入 DSH 包、不挂载 Cordis 插件，也不修改 Web 客户端。

## 已选架构

桌面宿主使用 Electron。主进程将捆绑的 Node.js 作为子进程启动，由该进程加载 hoist 后的 DSH 闭包并运行 `web --no-open --host 127.0.0.1 --port 0`。宿主读取已记录的 `dsh web:` 启动行，提取带 token 的 URL，探测该 URL，并将其加载到 `BrowserWindow` 中。既有 HTTP、浏览器会话认证、静态 bundle 加载和 `/api/remote.mux` WebSocket 通信保持不变。

该闭包与 [`scripts/build-exe-for-python-sdk.ts`](../../../scripts/build-exe-for-python-sdk.ts) 为 Python 运行时 node 载体生成的 deploy 树相同。桌面暂存步骤将该树、一份钉死的 Windows `node.exe` 和 `harness-node-entry.mjs` 复制到 `dist-desktop-runtime/`。Electron 将这些文件作为 `extraResources` 打包，并且只负责窗口、进程生命周期、诊断信息和安装程序。

宿主位于 [`apps/desktop`](../../../apps/desktop)。它不依赖任何 `@deepseek-ai/dsh-*` workspace。宿主与捆绑的 DSH 树共享同一份 checkout：合并上游 DSH 后，下一次桌面构建就会更新闭包。启动器输出和 Web 传输是宿主代码与 DSH 之间的兼容约定。

## 组件

### 主进程

- 安装后在 `process.resourcesPath/runtime` 下解析捆绑的 `node.exe`、`harness-node-entry.mjs` 和 `node/node_modules/@deepseek-ai/dsh/lib/bin.js`；开发态可以使用 `DSH_RUNTIME_PATH` 或 checkout 中已暂存的闭包。
- 将 `userData/dsh` 作为 `DSH_HOME`，将 `userData/launch-root` 作为子进程 cwd，避免进程锁住安装目录。
- Spawn `node.exe harness-node-entry.mjs <bin.js> web --no-open --host 127.0.0.1 --port 0`。
- 转发用户的 workspace 目录和已批准的环境变量，不将密钥复制到 renderer 全局变量中。
- 从 stdout 解析一个带 token 的启动 URL，拒绝格式错误或非 loopback 的 URL，然后在 `loadURL` 之前探测该 URL。
- 通过窄化的类型化 IPC 通道向 renderer 报告启动、运行时退出和 stderr 诊断信息。
- 将同样的诊断信息追加到 Electron `logs/harness.log`。
- 应用退出时，终止完整的子进程树，并在进程树退出后再退出。

### Renderer

- 只加载主进程提供的 URL。
- 禁用 Node 集成，并启用上下文隔离和 Chromium 沙箱。
- 只允许导航到活跃的 `http://127.0.0.1:<port>` 源。
- 拒绝未经请求的窗口创建、权限请求和外部导航；只通过明确的用户操作将外部链接交给操作系统打开。
- 不在 renderer 中实现 DSH 协议。DSH 的常规浏览器客户端负责 API 和 WebSocket 行为。

### 运行时负载

安装后的布局：

```text
DeepSeek Harness.exe
resources/
  app.asar
  runtime/
    node.exe
    harness-node-entry.mjs
    node/
      node_modules/@deepseek-ai/dsh/lib/bin.js
```

`app.asar` 只容纳桌面宿主。闭包保持为真实文件系统，因为 native addon、worker 文件和 ripgrep 都在其中。发行物不包含 pkg 可执行文件或 `-rg.exe` 伴随文件；`@vscode/ripgrep` 位于闭包内部。

### 打包

- 使用 `scripts/build-exe-for-python-sdk.ts --skip-pkg` 为 `node24-win-x64` deploy 闭包（校验、deploy、物化、暂存 native addon；不调用 pkg）。
- 运行 `scripts/stage-desktop-runtime.ts`，将 `@deepseek-ai/dsh-desktop` 钉死的 `node` devDependency 中的 `node.exe`、`harness-node-entry.mjs` 和闭包复制到 `dist-desktop-runtime/`；缺少输入时该命令失败。
- 生成只注册桌面可执行文件的 NSIS 安装程序；不安装 pnpm，也不要求系统安装 Node.js。
- 若 `win-unpacked/resources/runtime/node.exe` 或 `node/node_modules/@deepseek-ai/dsh/lib/bin.js` 不存在，则构建失败。
- 将 DSH profile 数据、凭据、会话和日志保存在宿主选择的每用户 Harness 主目录中。
- 只在 Windows x64 主机上构建 Windows x64 安装程序。

## 数据流

1. 宿主创建或解析 `DSH_HOME` 和 `launch-root`，然后用闭包入口启动捆绑的 Node。
2. DSH 绑定 loopback 端口 `0`，完成 Loader 启动，并打印认证后的根 URL。
3. 宿主验证 URL 的 authority 和 token，探测该端点，然后调用 `loadURL`。
4. 浏览器执行现有的 token 交换，并接收已签名的浏览器会话 cookie。
5. Web 客户端向 loopback DSH 服务器发送常规 HTTP RPC 请求和 WebSocket 流。
6. 关闭最后一个窗口时，请求 DSH 关闭，终止后代进程，并在进程树退出后关闭 Electron。

宿主不会伪造认证 cookie、改写 API 消息，或调用内部 Cordis 服务。

## Windows 环境

- 从子进程环境中去掉 `ELECTRON_RUN_AS_NODE`。
- 在 Windows 上按大小写不敏感的方式解析 `PATH`。
- 以 UTF-8 输出捕获用户 PowerShell profile 环境；丢弃含 U+FFFD 的值并回退到宿主进程的值，使 `TEMP` 仍指向真实目录。
- 以 `windowsHide: true` 进行 spawn。`harness-node-entry.mjs` 创建隐藏控制台，并将 `windowsHide` 应用到该进程树中后续的 `child_process` spawn。
- 不从 `app.asar` 内执行 `node.exe`。

## 失败处理

- 缺少 `node.exe` 或 `bin.js`：显示包含已解析路径的可操作诊断信息，然后退出。
- 运行时 spawn 失败：显示包含已解析运行时路径的可操作诊断信息。
- 在 60 秒启动超时前缺少启动 URL：显示捕获的 stderr 和最后几行 stdout。
- URL 格式错误或不是 loopback URL：拒绝加载并终止子进程。
- 在首次页面加载前子进程退出：显示退出码或信号，并提供重启选项。
- 就绪后子进程退出：保持窗口打开，显示重启或退出状态；不静默启动替代进程。
- 启动期间窗口关闭：取消启动，终止进程树，并抑制延迟到达的 URL 处理。
- 第二个实例：获取每用户的单实例锁，并聚焦现有窗口。

## 安全要求

- 始终传递 `--host 127.0.0.1`；不得将 Web 服务器暴露到 LAN 接口。
- 使用随机 DSH 端口（`--port 0`），且只接受同一子进程输出的认证 URL。
- 设置 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。
- 在主进程处使用类型化 schema 验证每条 IPC 消息。
- 不向 renderer 暴露文件系统或子进程 API。
- 当 Electron 提供该导航状态时，在重定向到干净根 URL 后，从 renderer 历史记录中清除带 token 的启动 URL。

## 上游同步与 GitHub Releases

该 fork 用 git 合并 `deepseek-ai/deepseek-harness`；不 vendor DSH tarball。`gh repo sync` 不是合并路径，因为它可能丢掉仅属于 fork 的桌面提交。

仅属于桌面的源文件留在 `apps/desktop`、桌面发布 workflow 和本 spec。桌面打包不为迁就运行时布局而修改 `packages/`。

该 fork 上的 GitHub Actions 构建 NSIS 安装程序，并发布到本仓库的 GitHub Releases。

| 触发 | GitHub Release |
| --- | --- |
| 推送到 `master`，或在非 tag ref 上 `workflow_dispatch` | prerelease tag `dsh-desktop-<12 位 sha>` |
| 推送 tag `desktop-v*` | Latest release；tag 版本必须等于根 `package.json` 的 `version` |

官方上游 DSH tag 为 `dsh-vX.Y.Z`。合并该上游 tag 后，对应的桌面 tag 为 `desktop-vX.Y.Z`。Release 资产为 NSIS 安装程序和 `SHA256SUMS`。prerelease 安装程序文件名包含 commit SHA。该 workflow 不上传 pkg 可执行文件。

## 构建流水线

1. 在启用 Windows Developer Mode 的情况下执行 `pnpm install --frozen-lockfile`，以便 deploy。
2. 以 `DSH_BUILD_CLIENT_PROFILE=official` 构建 workspace。
3. `pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg`。
4. `pnpm exec tsx scripts/stage-desktop-runtime.ts`。
5. `pnpm --filter @deepseek-ai/dsh-desktop dist`。
6. 校验未打包的 `resources/runtime` 文件，然后生成校验和并上传。

Python SDK 单文件可执行文件流水线仍是同一闭包 deploy 的独立消费者。桌面 CI 不调用 pkg，也不缓存 `~/.pkg-cache`。

钉死的 Node 24 x64 必须满足根目录 `engines.node`。该范围要求升级时再提高该钉死版本。

## 验证

- 对启动行解析、URL authority 验证、环境清理、超时、子进程退出分类和幂等进程树关闭进行单元测试。
- 对 `--skip-pkg`、extraResources 路径、双通道发布身份和未打包运行时存在性检查进行单元测试。
- 在 Windows CI 上对暂存比特做冒烟：用捆绑的 `node.exe` 运行闭包的 `web` 命令，解析 `dsh web:`，请求 loopback URL，然后终止进程树。
- 桌面宿主不得要求修改 DSH 会话快照。
- 验证打包后的安装程序可在仓库外运行，且无需 pnpm 或系统 Node 安装。

## 延后选项

`file:// + IPC` 被有意延后。客户端已提供用于自定义 fetch、流和 bundle 载体的 `__DSH_TRANSPORT__` 钩子，因此可以在后续将桌面传输添加为独立包。首次实现不包含它，因为它会拥有 loopback 浏览器路径已经处理的认证、cookie、WebSocket framing、下载和动态 bundle 加载。
