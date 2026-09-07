# DSH 桌面端

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是现有 DSH Web profile 的 Electron 宿主。它在 `127.0.0.1` 启动独立 DSH runtime，读取带认证 token 的 `dsh web:` URL，并在受限窗口中加载该地址；宿主不导入 DSH 包，也不修改 Web 代码。

## 开发

先构建并暂存 runtime。如果该目录不在默认路径，可设置 `DSH_RUNTIME_PATH`：

```powershell
pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg
pnpm exec tsx scripts/stage-desktop-runtime.ts
$env:DSH_RUNTIME_PATH = "..\..\dist-desktop-runtime"
pnpm --filter @deepseek-ai/dsh-desktop start
```

在 runtime 产物存在后构建 Windows 安装程序。`dist` 脚本会自行暂存 runtime：

```powershell
pnpm --filter @deepseek-ai/dsh-desktop dist
```

安装程序包含捆绑的 Node.js 和 DSH 闭包，不包含 pkg 可执行文件或 `-rg.exe` 伴随文件，不需要额外安装 Node.js 或 pnpm。应用将 DSH profile 保存到 Electron 用户数据目录，并在退出时终止 runtime 进程树。
