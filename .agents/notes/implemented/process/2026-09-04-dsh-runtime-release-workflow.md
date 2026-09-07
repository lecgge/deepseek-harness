# Agent Note: Automatic Windows desktop installer releases

Status: implemented

English | [中文](2026-09-04-dsh-runtime-release-workflow.zh.md)

<!-- dsh-translation-target:.agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.zh.md -->

## Problem

The desktop host needs a Windows installer that a user can download without installing Node.js or pnpm. Manual installer builds do not provide a repeatable artifact for every master update or an official Latest release whose version matches the repository.

## Decision

The personal fork runs `.github/workflows/dsh-desktop-release.yml` on every push to `master`, on `desktop-v*` tags, and on manual dispatch. The workflow runs on `windows-2025`, deploys the node carrier with `scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg`, then builds the Electron NSIS installer with `pnpm --filter @deepseek-ai/dsh-desktop dist`. It publishes the installer and `SHA256SUMS` to GitHub Releases and does not upload pkg executables or a `-rg.exe` sidecar.

A `master` push or a dispatch on a non-tag ref creates a prerelease tagged `dsh-desktop-<12-char-sha>`. A `desktop-v*` tag creates a Latest release whose tag suffix must equal the root `package.json` version; that create path does not pass `--prerelease`. Re-running the same ref updates existing release assets with `--clobber`.

The workflow uses only the repository `GITHUB_TOKEN` with `contents: write`. It does not change package versions, commit generated files, or publish to npm/PyPI. Desktop CI does not invoke pkg and does not cache `~/.pkg-cache`. The Python SDK single-file executable pipeline remains a separate consumer of the same closure deploy.

The closure builder marks its nested pnpm commands as CI so lefthook leaves the checkout untouched, and it sets `pnpm_config_verify_deps_before_run=false`. The explicit pnpm setting prevents a nested command from reconciling dependencies with a production install before it deploys the carrier.

The workflow reads pnpm's JavaScript entrypoint after dependency installation and exports it as `npm_execpath` for the closure builder. Windows nested processes use that entrypoint through Node.js instead of a command wrapper.

## Alternatives considered

**Manual release commands** leave each synchronized commit without a predictable downloadable installer and depend on a developer machine.

**A third-party release action** would add a supply-chain dependency for a task the GitHub CLI already supports on the hosted runner.

**Publishing on every branch or pull request** would create noisy, unreviewed releases; the workflow is restricted to `master` pushes, `desktop-v*` tags, and explicit dispatch.

**Master-only SHA prereleases** cannot publish an official Latest installer whose version matches `package.json`; the `desktop-v*` channel exists for that.

## Consequences

Each master commit has a unique, traceable prerelease installer and checksum. Official `desktop-v*` tags produce a Latest release only when the tag suffix equals the root package version. Release storage grows with every pushed master commit, and prerelease consumers must select the desired commit-tagged installer. Closure deploys use the dependency tree installed by the workflow instead of changing it during packaging. The installer carries the bundled Node closure rather than a pkg executable.
