# Agent Note: Electron host for the DSH Web profile

Status: implemented

English | [中文](2026-09-04-dsh-desktop-host.zh.md)

<!-- dsh-translation-target:.agents/notes/implemented/architecture/2026-09-04-dsh-desktop-host.zh.md -->

## Problem

The Web profile needs a Windows desktop distribution that does not require Node.js or pnpm and can remain current while the DSH harness changes rapidly. Reimplementing its HTTP, cookie, RPC, WebSocket, or frontend behavior in a desktop shell would couple the client to internal DSH implementation details.

## Decision

`apps/desktop` is an Electron application that has no workspace dependency on a DSH package. Its main process starts the versioned standalone runtime with `web --no-open --host 127.0.0.1 --port 0`, assigns a per-user `DSH_HOME`, validates the tokenized `dsh web:` URL from stdout, and loads it in a BrowserWindow. The window enables context isolation and sandboxing, disables Node integration, permits navigation only to the active loopback origin, and denies new windows, permission requests, and downloads.

The Electron application carries the runtime executable and ripgrep sidecar as `extraResources`. On shutdown it uses Windows `taskkill /T /F` for the direct runtime process and its descendants. The runtime release workflow builds the installer after the runtime and uploads `DeepSeek-Harness-Setup-<version>-x64.exe` with both runtime files and `SHA256SUMS` to the commit-tagged prerelease.

## Alternatives considered

**A `file://` frontend with IPC transports** would require desktop-specific implementations for Web fetches, streams, bundle loading, and authentication, so it would track changes in the Web transport.

**Embedding DSH packages in Electron** would put the desktop application on the same source and dependency graph as the harness, defeating independently versioned host packaging.

**Opening the system browser** preserves the existing profile but does not provide the requested desktop client or application lifecycle ownership.

## Consequences

The desktop client treats DSH as a separately released local service and keeps its user-visible Web behavior unchanged. The desktop installer grows by the Electron shell and runtime payload, and Windows unsigned-install warnings remain until a signing certificate is configured. The host trusts only an authenticated URL printed by its own loopback runtime and preserves no token outside the initial navigation.
