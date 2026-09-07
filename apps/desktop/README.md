# DSH Desktop

English | [中文](README.zh.md)

`@deepseek-ai/dsh-desktop` is an Electron host for the existing DSH Web profile. It launches the standalone DSH runtime as a child process on `127.0.0.1`, reads the authenticated `dsh web:` URL, and embeds that URL without importing DSH packages or changing Web code.

## Development

Build and stage the runtime first, then set `DSH_RUNTIME_PATH` when the directory is outside the default checkout location:

```powershell
pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg
pnpm exec tsx scripts/stage-desktop-runtime.ts
$env:DSH_RUNTIME_PATH = "..\..\dist-desktop-runtime"
pnpm --filter @deepseek-ai/dsh-desktop start
```

Create the Windows installer after the runtime artifacts exist. The `dist` script stages the runtime itself:

```powershell
pnpm --filter @deepseek-ai/dsh-desktop dist
```

The installer is self-contained and includes bundled Node.js and the DSH closure, not a pkg executable or a `-rg.exe` sidecar. The app stores its DSH profile under the Electron per-user data directory and terminates the runtime process tree on exit.
