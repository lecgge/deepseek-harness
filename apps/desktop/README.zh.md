# DSH 桌面端

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是现有 DSH Web profile 的 Electron 宿主。它在 `127.0.0.1` 启动独立 DSH runtime，读取带认证 token 的 `dsh web:` URL，并在受限窗口中加载该地址；宿主不导入 DSH 包，也不修改 Web 代码。

## 开发

先构建 runtime。如果可执行文件不在默认路径，可设置 `DSH_RUNTIME_PATH`：

```powershell
$env:DSH_RUNTIME_PATH = "..\..\dist-exe\deepseek-harness-sdk-runtime-win-x64.exe"
pnpm --filter @deepseek-ai/dsh-desktop start
```

在 runtime 产物存在后构建 Windows 安装程序：

```powershell
pnpm --filter @deepseek-ai/dsh-desktop dist
```

安装程序包含 runtime 可执行文件和 ripgrep sidecar，不需要额外安装 Node.js 或 pnpm。应用将 DSH profile 保存到 Electron 用户数据目录，并在退出时终止 runtime 进程树。
