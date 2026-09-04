# Agent Note: Automatic Windows runtime prereleases

Status: implemented

English | [中文](2026-09-04-dsh-runtime-release-workflow.zh.md)

<!-- dsh-translation-target:.agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.zh.md -->

## Problem

The desktop host needs a Windows DSH runtime that can be downloaded without installing Node.js or pnpm. Manual runtime builds do not provide a repeatable artifact for every update synchronized into the personal fork.

## Decision

The personal fork runs `.github/workflows/dsh-runtime-release.yml` on every push to `master` and on manual dispatch. The workflow runs on `windows-2025`, invokes `scripts/build-exe-for-python-sdk.ts` for `node24-win-x64`, and publishes the executable, its `-rg.exe` sidecar, and `SHA256SUMS` to a GitHub prerelease tagged `dsh-runtime-<commit-sha>`. Re-running the same commit updates the existing release assets with `--clobber`.

The workflow uses only the repository `GITHUB_TOKEN` with `contents: write`. It does not change package versions, commit generated files, or publish to npm/PyPI. The existing single-exe builder remains the source of runtime packaging behavior.

## Alternatives considered

**Manual release commands** leave each synchronized commit without a predictable downloadable runtime and depend on a developer machine.

**A third-party release action** would add a supply-chain dependency for a task the GitHub CLI already supports on the hosted runner.

**Publishing on every branch or pull request** would create noisy, unreviewed releases; the workflow is restricted to `master` pushes and explicit dispatch.

## Consequences

Each master commit has a unique, traceable prerelease and checksum manifest. Release storage grows with every pushed commit, and prereleases require consumers to select the desired commit-tagged version. Desktop installer assembly remains a separate workflow until the Electron host is added.
