# Agent Note: Automatic Windows desktop installer releases

Status: implemented

[English](2026-09-04-dsh-runtime-release-workflow.md) | 中文

## Problem

桌面宿主需要一个无需安装 Node.js 或 pnpm 即可下载的 Windows 安装程序。手动构建无法为每次 master 更新提供可重复获取的产物，也无法提供版本与仓库一致的正式 Latest release。

## Decision

个人 fork 通过 `.github/workflows/dsh-desktop-release.yml` 在每次 `master` push、`desktop-v*` tag 以及手动 dispatch 时运行。workflow 在 `windows-2025` 上用 `scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg` 部署 node 载体，再用 `pnpm --filter @deepseek-ai/dsh-desktop dist` 构建 Electron NSIS 安装程序。它把安装程序和 `SHA256SUMS` 发布到 GitHub Releases，不上传 pkg 可执行文件或 `-rg.exe` sidecar。

`master` push 或非 tag ref 上的 dispatch 会创建标签为 `dsh-desktop-<12-char-sha>` 的 prerelease。该路径会在校验和上传之前把 `DeepSeek-Harness-Setup-*-x64.exe` 重命名，把同一 12 位 SHA 插入文件名。`desktop-v*` tag 会创建 Latest release，其 tag 后缀必须等于根目录 `package.json` 的 version；该创建路径不传递 `--prerelease`，并保留仅含版本号的安装程序文件名。对同一 ref 重复运行时使用 `--clobber` 更新现有 release 资产。

workflow 只使用仓库的 `GITHUB_TOKEN` 和 `contents: write` 权限。它不会修改包版本、提交生成文件，也不会发布到 npm/PyPI。桌面 CI 不调用 pkg，也不缓存 `~/.pkg-cache`。Python SDK 单文件可执行文件流水线仍是同一闭包 deploy 的独立消费者。

闭包构建器将嵌套的 pnpm 命令标记为 CI，使 lefthook 不会改动工作区，并设置 `pnpm_config_verify_deps_before_run=false`。该显式 pnpm 设置防止嵌套命令在部署载体前通过 production 安装重整依赖。

workflow 在依赖安装后读取 pnpm 的 JavaScript 入口，并将其作为 `npm_execpath` 导出给闭包构建器。Windows 上的嵌套进程通过 Node.js 使用该入口，而不是使用命令包装器。

## Alternatives considered

**手动发布命令**无法为每个同步提交提供确定的可下载安装程序，并且依赖开发者机器。

**第三方 release action**会为 GitHub CLI 已能完成的任务增加供应链依赖。

**在所有分支或 pull request 上发布**会产生大量未经审核的 release；workflow 只接受 `master` push、`desktop-v*` tag 和显式 dispatch。

**仅在 master 上发布 SHA prerelease**无法提供版本与 `package.json` 一致的正式 Latest 安装程序；`desktop-v*` 通道正是为此存在。

## Consequences

每个 master 提交都会生成一个可追溯的 prerelease 安装程序（文件名包含 12 位 commit SHA）和校验清单。正式 `desktop-v*` tag 仅在 tag 后缀等于根目录包 version 时生成 Latest release。每次 master push 都会增加 release 存储用量，prerelease 使用者需要选择目标提交对应的安装程序。闭包部署使用 workflow 已安装的依赖树，不会在打包中改动它。安装程序携带捆绑的 Node 闭包，而不是 pkg 可执行文件。
