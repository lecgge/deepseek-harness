# DSH Desktop

English | [中文](README.zh.md)

`@deepseek-ai/dsh-desktop` is an Electron host for the existing DSH Web profile. It launches the standalone DSH runtime as a child process on `127.0.0.1`, reads the authenticated `dsh web:` URL, and embeds that URL without importing DSH packages or changing Web code.

## Development

Build the runtime first, then set `DSH_RUNTIME_PATH` when the executable is outside the default checkout location:

```powershell
$env:DSH_RUNTIME_PATH = "..\..\dist-exe\deepseek-harness-sdk-runtime-win-x64.exe"
pnpm --filter @deepseek-ai/dsh-desktop start
```

Create the Windows installer after the runtime artifacts exist:

```powershell
pnpm --filter @deepseek-ai/dsh-desktop dist
```

The installer is self-contained and includes the runtime executable and ripgrep sidecar. The app stores its DSH profile under the Electron per-user data directory and terminates the runtime process tree on exit.
