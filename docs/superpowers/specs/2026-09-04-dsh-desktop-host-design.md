# DSH Desktop Host Design

English | [中文](2026-09-04-dsh-desktop-host-design.zh.md)

## Objective

Provide a Windows desktop executable that runs the existing DSH Web profile in an embedded browser window. The desktop host and DSH remain separate processes and release units. The host does not import DSH packages, mount Cordis plugins, or change the Web client.

## Selected Architecture

The desktop host uses Electron. The main process starts bundled Node.js as a child process that loads the hoisted DSH closure and runs `web --no-open --host 127.0.0.1 --port 0`. The host reads the documented `dsh web:` startup line, extracts the tokenized URL, probes that URL, and loads it in a `BrowserWindow`. Existing HTTP, browser-session authentication, static bundle loading, and `/api/remote.mux` WebSocket traffic remain unchanged.

The closure is the same deploy tree produced by [`scripts/build-exe-for-python-sdk.ts`](../../../scripts/build-exe-for-python-sdk.ts) for the Python runtime node carrier. A desktop staging step copies that tree, a pinned Windows `node.exe`, and `harness-node-entry.mjs` into `dist-desktop-runtime/`. Electron packages those files as `extraResources` and owns only the window, process lifecycle, diagnostics, and installer.

The host lives in [`apps/desktop`](../../../apps/desktop). It has no workspace dependency on `@deepseek-ai/dsh-*`. The host and the bundled DSH tree share one checkout: merging upstream DSH updates the closure on the next desktop build. The launcher output and Web transport are the compatibility contract between host code and DSH.

## Components

### Main process

- Resolve bundled `node.exe`, `harness-node-entry.mjs`, and `node/node_modules/@deepseek-ai/dsh/lib/bin.js` under `process.resourcesPath/runtime` after install; development may use `DSH_RUNTIME_PATH` or the staged closure in the checkout.
- Create `userData/dsh` as `DSH_HOME` and `userData/launch-root` as the child cwd so the process does not lock the install directory.
- Spawn `node.exe harness-node-entry.mjs <bin.js> web --no-open --host 127.0.0.1 --port 0`.
- Forward the user's workspace directory and approved environment values without copying secrets into renderer globals.
- Parse one tokenized startup URL from stdout, reject malformed or non-loopback URLs, then probe the URL before `loadURL`.
- Report startup, runtime exit, and stderr diagnostics to the renderer through a narrow typed IPC channel.
- Append the same diagnostics to Electron `logs/harness.log`.
- On application shutdown, terminate the complete child process tree and await exit before quitting.

### Renderer

- Load only the URL supplied by the main process.
- Disable Node integration and enable context isolation and Chromium sandboxing.
- Permit navigation only to the active `http://127.0.0.1:<port>` origin.
- Deny unsolicited window creation, permission requests, and external navigation; hand external links to the operating system only through an explicit user action.
- Keep no DSH protocol implementation in the renderer. DSH's normal browser client owns API and WebSocket behavior.

### Runtime payload

Installed layout:

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

`app.asar` holds only the desktop host. The closure stays a real filesystem because native addons, worker files, and ripgrep live inside it. The distribution does not include a pkg executable or a `-rg.exe` sidecar; `@vscode/ripgrep` is inside the closure.

### Packaging

- Deploy the closure with `scripts/build-exe-for-python-sdk.ts --skip-pkg` for `node24-win-x64` (verify, deploy, materialize, stage native addons; do not invoke pkg).
- Run `scripts/stage-desktop-runtime.ts` to copy `node.exe` from the pinned `node` devDependency of `@deepseek-ai/dsh-desktop`, `harness-node-entry.mjs`, and the closure into `dist-desktop-runtime/`; missing inputs fail the command.
- Produce an NSIS installer that registers the desktop executable only; it does not install pnpm or require system Node.js.
- Fail the build if `win-unpacked/resources/runtime/node.exe` or `node/node_modules/@deepseek-ai/dsh/lib/bin.js` is absent.
- Keep DSH profile data, credentials, sessions, and logs under the per-user Harness home selected by the host.
- Build Windows x64 installers only on a Windows x64 host.

## Data Flow

1. The host creates or resolves `DSH_HOME` and `launch-root`, then starts bundled Node with the closure entry.
2. DSH binds loopback port `0`, completes Loader startup, and prints its authenticated root URL.
3. The host validates the URL authority and token, probes the endpoint, then calls `loadURL`.
4. The browser performs the existing token exchange and receives the signed browser-session cookie.
5. The Web client sends normal HTTP RPC requests and WebSocket streams to the loopback DSH server.
6. Closing the last window requests DSH shutdown, kills descendants, and exits Electron after the process tree is gone.

The host never fabricates an authentication cookie, rewrites API messages, or calls internal Cordis services.

## Windows Environment

- Strip `ELECTRON_RUN_AS_NODE` from the child environment.
- Resolve `PATH` case-insensitively on Windows.
- Capture the user PowerShell profile environment with UTF-8 output; drop values that contain U+FFFD and fall back to the host process value so `TEMP` remains a real directory.
- Spawn with `windowsHide: true`. `harness-node-entry.mjs` creates a hidden console and applies `windowsHide` to further `child_process` spawns in that tree.
- Do not execute `node.exe` from inside `app.asar`.

## Failure Handling

- Missing `node.exe` or `bin.js`: show an actionable diagnostic containing the resolved paths, then exit.
- Runtime spawn failure: show an actionable diagnostic containing the resolved runtime path.
- Missing startup URL before a 60s startup timeout: show captured stderr and the last stdout lines.
- Malformed or non-loopback URL: refuse to load it and terminate the child.
- Child exit before the first page load: show exit code or signal and offer restart.
- Child exit after readiness: keep the window open with a restart/quit state; do not silently start a replacement process.
- Window close during startup: cancel startup, terminate the process tree, and suppress late URL handling.
- A second instance: acquire a per-user single-instance lock and focus the existing window.

## Security Requirements

- Always pass `--host 127.0.0.1`; do not expose the Web server to LAN interfaces.
- Use a random DSH port (`--port 0`) and accept only the authenticated URL emitted by the same child process.
- Set `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Validate every IPC message with a typed schema at the main-process boundary.
- Do not expose filesystem or subprocess APIs to the renderer.
- Clear the tokenized startup URL from renderer history after the redirect to the clean root URL when Electron exposes that navigation state.

## Upstream Sync and GitHub Releases

The fork merges `deepseek-ai/deepseek-harness` with git; it does not vendor DSH tarballs. `gh repo sync` is not the merge path because it can drop fork-only desktop commits.

Desktop-only sources stay in `apps/desktop`, the desktop release workflow, and this spec. Desktop packaging does not patch `packages/` to work around runtime layout.

GitHub Actions on this fork builds the NSIS installer and publishes it to this repository's GitHub Releases.

| Trigger | GitHub Release |
| --- | --- |
| Push to `master`, or `workflow_dispatch` on a non-tag ref | Prerelease tag `dsh-desktop-<12-char-sha>` |
| Push of tag `desktop-v*` | Latest release; the tag version must equal root `package.json` `version` |

Official upstream DSH tags are `dsh-vX.Y.Z`. The matching desktop tag is `desktop-vX.Y.Z` after merging that upstream tag. Release assets are the NSIS installer and `SHA256SUMS`. Prerelease installer names include the commit SHA. The workflow does not upload pkg executables.

## Build Pipeline

1. `pnpm install --frozen-lockfile` with Windows Developer Mode enabled for deploy.
2. Build the workspace with `DSH_BUILD_CLIENT_PROFILE=official`.
3. `pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg`.
4. `pnpm exec tsx scripts/stage-desktop-runtime.ts`.
5. `pnpm --filter @deepseek-ai/dsh-desktop dist`.
6. Verify unpacked `resources/runtime` files, then checksum and upload.

The Python SDK single-file executable pipeline stays a separate consumer of the same closure deploy. Desktop CI does not invoke pkg and does not cache `~/.pkg-cache`.

Pinned Node 24 x64 must satisfy root `engines.node`. Raise the pin when that range requires it.

## Verification

- Unit-test startup-line parsing, URL authority validation, environment sanitization, timeout, child-exit classification, and idempotent process-tree shutdown.
- Unit-test `--skip-pkg`, extraResources paths, dual-channel release identity, and the unpacked-runtime presence check.
- On Windows CI, smoke the staged bits: spawn bundled `node.exe` with the closure `web` command, parse `dsh web:`, fetch the loopback URL, then terminate the process tree.
- Do not require modified DSH session snapshots for the desktop host.
- Verify that the packaged installer runs outside the repository without pnpm or a system Node installation.

## Deferred Option

`file:// + IPC` is intentionally deferred. The client already exposes `__DSH_TRANSPORT__` hooks for custom fetch, stream, and bundle carriers, so a later desktop transport can be added as a separate package. It is not part of the first implementation because it would own authentication, cookies, WebSocket framing, downloads, and dynamic bundle loading that the loopback browser path already handles.
