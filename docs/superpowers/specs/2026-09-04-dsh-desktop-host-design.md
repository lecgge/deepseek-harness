# DSH Desktop Host Design

## Objective

Provide a Windows desktop executable that runs the existing DSH Web profile in an embedded browser window. The desktop host and DSH remain separate processes and release units. The host does not import DSH packages, mount Cordis plugins, or change the Web client.

## Selected Architecture

The desktop host uses Electron for the first implementation. Electron's main process starts the packaged DSH single-file runtime as a child process with `web --no-open --host 127.0.0.1 --port 0`. The host reads the documented `dsh web:` startup line, extracts the tokenized URL, and loads it in a `BrowserWindow`. Existing HTTP, browser-session authentication, static bundle loading, and `/api/remote.mux` WebSocket traffic remain unchanged.

The DSH executable is produced by the existing `scripts/build-exe-for-python-sdk.ts` pipeline. The desktop distribution carries the Windows runtime executable and its `-rg.exe` sidecar. Electron is responsible only for the window, process lifecycle, diagnostics, and installer packaging.

The host is placed in a separate `apps/desktop` application boundary. It has no workspace dependency on `@deepseek-ai/dsh-*`; a release build consumes a versioned runtime artifact. The desktop version and DSH runtime version may be released independently as long as the launcher output and Web transport remain compatible.

## Components

### Main process

- Resolve the bundled runtime path and a per-user `DSH_HOME` under Electron's `userData` directory.
- Spawn the runtime with `web`, `--no-open`, `--host 127.0.0.1`, and `--port 0`.
- Forward the user's workspace directory and approved environment values without copying secrets into renderer globals.
- Parse one tokenized startup URL from stdout and reject malformed or conflicting URLs.
- Report startup, runtime exit, and stderr diagnostics to the renderer through a narrow typed IPC channel.
- On application shutdown, terminate the complete child process tree and await exit before quitting.

### Renderer

- Load only the URL supplied by the main process.
- Disable Node integration and enable context isolation and Chromium sandboxing.
- Permit navigation only to the active `http://127.0.0.1:<port>` origin.
- Deny unsolicited window creation, permission requests, and external navigation; hand external links to the operating system only through an explicit user action.
- Keep no DSH protocol implementation in the renderer. DSH's normal browser client owns API and WebSocket behavior.

### Packaging

- Build the DSH runtime with the existing single-exe script for `node24-win-x64`.
- Copy the runtime executable and `-rg.exe` beside the Electron application payload.
- Produce an installer that registers the desktop executable only; it does not install pnpm or require system Node.js.
- Keep DSH profile data, credentials, sessions, and logs under the per-user Harness home selected by the host.

## Data Flow

1. The host creates or resolves `DSH_HOME` and starts the runtime.
2. DSH binds loopback port `0`, completes Loader startup, and prints its authenticated root URL.
3. The host validates the URL authority and token, then calls `loadURL`.
4. The browser performs the existing token exchange and receives the signed browser-session cookie.
5. The Web client sends normal HTTP RPC requests and WebSocket streams to the loopback DSH server.
6. Closing the last window requests DSH shutdown, kills descendants, and exits Electron after the process tree is gone.

The host never fabricates an authentication cookie, rewrites API messages, or calls internal Cordis services.

## Failure Handling

- Runtime spawn failure: show an actionable diagnostic containing the resolved runtime path.
- Missing startup URL before a bounded startup timeout: show captured stderr and the last stdout lines.
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

## Verification

- Unit-test startup-line parsing, URL authority validation, timeout, child-exit classification, and idempotent process-tree shutdown.
- Run a Windows host smoke test that starts the packaged runtime, loads the page, confirms the authenticated root redirect, opens one Remote WebSocket stream, and shuts down cleanly.
- Run the existing DSH Web smoke tests against the same runtime artifact; the desktop host must not require modified DSH snapshots.
- Verify that the packaged installer works outside the repository and without pnpm or a system Node installation.

## Deferred Option

`file:// + IPC` is intentionally deferred. The client already exposes `__DSH_TRANSPORT__` hooks for custom fetch, stream, and bundle carriers, so a later desktop transport can be added as a separate package. It is not part of the first implementation because it would own authentication, cookies, WebSocket framing, downloads, and dynamic bundle loading that the loopback browser path already handles.
