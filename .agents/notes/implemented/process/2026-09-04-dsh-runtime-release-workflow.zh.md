# Agent Note: Automatic Windows runtime prereleases

Status: implemented

[English](2026-09-04-dsh-runtime-release-workflow.md) | 中文

## Problem

桌面宿主需要一个无需安装 Node.js 或 pnpm 即可下载的 Windows DSH runtime。手动构建无法为同步到个人 fork 的每次更新提供可重复获取的产物。

## Decision

个人 fork 通过 `.github/workflows/dsh-runtime-release.yml` 在每次 `master` push 和手动 dispatch 时运行。workflow 在 `windows-2025` 上执行 `scripts/build-exe-for-python-sdk.ts` 的 `node24-win-x64` 构建，并将可执行文件、`-rg.exe` sidecar 和 `SHA256SUMS` 发布到标签为 `dsh-runtime-<commit-sha>` 的 GitHub prerelease。重复运行同一个提交时使用 `--clobber` 更新现有 release 资产。

workflow 只使用仓库的 `GITHUB_TOKEN` 和 `contents: write` 权限。它不会修改包版本、提交生成文件，也不会发布到 npm/PyPI。现有的单文件构建器仍然是 runtime 打包行为的来源。

## Alternatives considered

**手动发布命令**无法为每个同步提交提供确定的可下载 runtime，并且依赖开发者机器。

**第三方 release action**会为 GitHub CLI 已能完成的任务增加供应链依赖。

**在所有分支或 pull request 上发布**会产生大量未经审核的 release；workflow 只接受 `master` push 和显式 dispatch。

## Consequences

每个 master 提交都会生成一个可追溯的 prerelease 和校验清单。每次 push 都会增加 release 存储用量，使用者需要选择目标提交对应的 prerelease。Electron 宿主加入前，桌面安装包仍由单独 workflow 负责。
