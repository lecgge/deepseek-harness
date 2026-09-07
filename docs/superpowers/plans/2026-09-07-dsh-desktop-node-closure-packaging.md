# DSH Desktop Node Closure Packaging Implementation Plan

English | [中文](2026-09-07-dsh-desktop-node-closure-packaging.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows NSIS installer whose Electron host starts bundled Node 24 plus the existing hoisted DSH `runtime/node` closure, then publish that installer from this fork's GitHub Actions to GitHub Releases.

**Architecture:** `apps/desktop` stays a thin Electron host with no `@deepseek-ai/dsh-*` workspace dependency. Desktop CI runs the existing closure deploy with `--skip-pkg`, stages `node.exe` + `harness-node-entry.mjs` + the closure into `dist-desktop-runtime/`, and electron-builder copies that tree to `resources/runtime/`. Master pushes create `dsh-desktop-<sha>` prereleases; `desktop-v*` tags create Latest releases.

**Tech Stack:** Electron 38, electron-builder 26, Node 24 win-x64 (`node` npm package), pnpm deploy of `dsh-python-runtime-closure`, GitHub Actions on `windows-2025`, vitest.

**Spec:** [docs/superpowers/specs/2026-09-04-dsh-desktop-host-design.md](../specs/2026-09-04-dsh-desktop-host-design.md)

## Global Constraints

- Host must not import `@deepseek-ai/dsh-*` packages, mount Cordis plugins, or change the Web client.
- Spawn argv is `node.exe harness-node-entry.mjs <bin.js> web --no-open --host 127.0.0.1 --port 0`.
- Always `--host 127.0.0.1`; accept only the tokenized `dsh web:` URL from the same child.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Windows x64 installers only, built on a Windows x64 host.
- Python SDK pkg pipeline remains a separate consumer of the same deploy; desktop CI must not invoke pkg.
- Do not patch `packages/` for desktop packaging.
- Discard the uncommitted `profile.ts` pkg-proxy `dsh.client` change; it is not part of this work.
- Client UI copy that already exists stays locale-owned; new host diagnostics may be English for this first Windows host.
- Files end with exactly one trailing newline.

## File map

| Path | Role |
| --- | --- |
| `scripts/build-exe-for-python-sdk.ts` | Add `--skip-pkg`: deploy + native pty, no pkg / no `dist-exe` products. |
| `scripts/stage-desktop-runtime.ts` | Copy `node.exe`, entry wrapper, and closure into `dist-desktop-runtime/`. |
| `scripts/verify-desktop-payload.ts` | Fail if unpacked `resources/runtime/node.exe` or `bin.js` is missing. |
| `apps/desktop/src/runtime-paths.ts` | Resolve bundled vs development runtime files. |
| `apps/desktop/src/environment.ts` | Child env: strip `ELECTRON_RUN_AS_NODE`, Windows PATH, UTF-8 profile capture. |
| `apps/desktop/src/harness-node-entry.mjs` | Load DSH entry; hide Windows consoles; log crashes. |
| `apps/desktop/src/windows-hidden-console.mjs` | `AllocConsole` + `SW_HIDE`. |
| `apps/desktop/src/windows-child-process-hide.mjs` | Force `windowsHide` on `child_process` spawns. |
| `apps/desktop/src/runtime.ts` | Spawn, parse URL, probe, log, 60s timeout. |
| `apps/desktop/src/main.ts` | Window, `DSH_HOME`, `launch-root`, shutdown. |
| `apps/desktop/electron-builder.yml` | `extraResources` from `dist-desktop-runtime/` → `runtime/`. |
| `.github/workflows/dsh-desktop-release.yml` | Dual-channel GitHub Release (replace `dsh-runtime-release.yml`). |

---

### Task 1: `--skip-pkg` on the closure builder

**Files:**
- Modify: `scripts/build-exe-for-python-sdk.ts`
- Test: `scripts/build-exe-for-python-sdk.spec.ts`

**Interfaces:**
- Consumes: existing `BuildCli.parse`, `SingleExeBuild.deployStaging`, private `prepareNativePty`
- Produces: `BuildCli.skipPkg: boolean`; `main()` returns after deploy + native pty when `skipPkg` is true; usage text includes `--skip-pkg`

- [ ] **Step 1: Write the failing test**

Add to `scripts/build-exe-for-python-sdk.spec.ts` inside `describe('Python runtime executable builder CLI')`:

```ts
it('skips pkg and dist-exe products when --skip-pkg is set', () => {
  const result = run(
    { npm_execpath: 'C:\\tools\\pnpm.cjs' },
    '--skip-build',
    '--skip-pkg',
    '--dry-run',
    '--targets=node24-win-x64',
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('dsh-python-runtime-closure deploy')
  expect(result.stdout).not.toContain('@yao-pkg/pkg@6.21.0')
  expect(result.stdout).not.toContain('injected pkg config')
})
```

Keep the existing dry-run test that still expects `dlx @yao-pkg/pkg@6.21.0` when `--skip-pkg` is absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/build-exe-for-python-sdk.spec.ts -t "skips pkg"`

Expected: FAIL (`unknown option '--skip-pkg'` or still contains pkg).

- [ ] **Step 3: Write minimal implementation**

In `BuildCli`:

```ts
private constructor(
  readonly targets: readonly Target[],
  readonly skipBuild: boolean,
  readonly dryRun: boolean,
  readonly skipPkg: boolean,
) {}
```

Parse `'skip-pkg': { type: 'boolean', default: false }`. Pass `values['skip-pkg']` into the constructor. Add to `usage()`:

```text
  --skip-pkg             deploy the node carrier and native addons; do not invoke pkg or write dist-exe/.
```

Change `main()` to:

```ts
async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new SingleExeBuild(cli)
  console.log(`build-exe-for-python-sdk: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`build-exe-for-python-sdk: staging: ${pipeline.staging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployStaging()
  if (cli.skipPkg) {
    for (const target of cli.targets) await pipeline.prepareNativeAddons(target)
    const entry = join(pipeline.staging, ENTRY_BIN)
    if (!cli.dryRun && !existsSync(entry)) {
      throw new Error(`build-exe-for-python-sdk: ${entry} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    return
  }
  await pipeline.injectPkgConfig()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
  await pipeline.syncToPythonRuntime(products)
}
```

Expose native staging without duplicating `pack()`: rename or wrap `prepareNativePty` as public `prepareNativeAddons(target: Target)` that calls the existing private method. `pack()` still calls it before pkg.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run scripts/build-exe-for-python-sdk.spec.ts`

Expected: PASS, including the existing pkg dry-run test.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-exe-for-python-sdk.ts scripts/build-exe-for-python-sdk.spec.ts
git commit -m "feat(build): add --skip-pkg for the desktop node carrier"
```

---

### Task 2: Stage `dist-desktop-runtime/`

**Files:**
- Create: `scripts/stage-desktop-runtime.ts`
- Create: `scripts/stage-desktop-runtime.spec.ts`
- Modify: `apps/desktop/package.json` (pin `node` devDependency `24.9.0`)
- Modify: `pnpm-workspace.yaml` (`allowBuilds.node: true`)

**Interfaces:**
- Consumes: closure at `python/sdk-runtime/src/deepseek_harness_runtime/runtime/node`
- Produces:

```ts
export interface StageDesktopRuntimeOptions {
  readonly sourceClosure: string
  readonly nodeExecutable: string
  readonly wrappers: readonly string[]
  readonly destination: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

export async function stageDesktopRuntime(options: StageDesktopRuntimeOptions): Promise<void>
```

Destination layout:

```text
dist-desktop-runtime/
  node.exe
  harness-node-entry.mjs
  windows-hidden-console.mjs
  windows-child-process-hide.mjs
  node/node_modules/@deepseek-ai/dsh/lib/bin.js
```

- [ ] **Step 1: Write the failing test**

`scripts/stage-desktop-runtime.spec.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stageDesktopRuntime } from './stage-desktop-runtime.ts'

function fixture(): { root: string; closure: string; nodeExe: string; wrappers: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stage-desktop-'))
  const closure = join(root, 'closure')
  const bin = join(closure, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  mkdirSync(join(bin, '..'), { recursive: true })
  writeFileSync(bin, 'export {}\n')
  const nodeExe = join(root, 'node.exe')
  writeFileSync(nodeExe, 'fake-node')
  const wrappers = ['harness-node-entry.mjs', 'windows-hidden-console.mjs', 'windows-child-process-hide.mjs']
    .map(name => {
      const path = join(root, name)
      writeFileSync(path, `// ${name}\n`)
      return path
    })
  return { root, closure, nodeExe, wrappers }
}

describe('stageDesktopRuntime', () => {
  it('copies node.exe, wrappers, and the closure bin', async () => {
    const { closure, nodeExe, wrappers, root } = fixture()
    const destination = join(root, 'out')
    await stageDesktopRuntime({
      sourceClosure: closure,
      nodeExecutable: nodeExe,
      wrappers,
      destination,
      platform: 'win32',
      arch: 'x64',
    })
    expect(readFileSync(join(destination, 'node.exe'), 'utf8')).toBe('fake-node')
    expect(existsSync(join(destination, 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))).toBe(true)
    expect(existsSync(join(destination, 'harness-node-entry.mjs'))).toBe(true)
  })

  it('rejects a non-Windows host', async () => {
    const { closure, nodeExe, wrappers, root } = fixture()
    await expect(stageDesktopRuntime({
      sourceClosure: closure,
      nodeExecutable: nodeExe,
      wrappers,
      destination: join(root, 'out'),
      platform: 'linux',
      arch: 'x64',
    })).rejects.toThrow('Windows x64')
  })

  it('fails when bin.js is missing', async () => {
    const { nodeExe, wrappers, root } = fixture()
    await expect(stageDesktopRuntime({
      sourceClosure: join(root, 'empty'),
      nodeExecutable: nodeExe,
      wrappers,
      destination: join(root, 'out'),
      platform: 'win32',
      arch: 'x64',
    })).rejects.toThrow('bin.js')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/stage-desktop-runtime.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`scripts/stage-desktop-runtime.ts`: `rm` destination, `mkdir`, copy `node.exe`, copy each wrapper basename, `cp` the closure to `destination/node`, throw if `bin.js` or `node.exe` is missing, throw unless `platform === 'win32' && arch === 'x64'`.

CLI `main()` (repo root): resolve wrappers from `apps/desktop/src/*.mjs` (files land in Task 5; until then tests pass wrappers explicitly). Default `nodeExecutable` from `createRequire(apps/desktop/package.json).resolve('node/package.json')` → `../bin/node.exe`. Default `sourceClosure` is the Python node carrier path. Default destination `dist-desktop-runtime/`.

Add to `apps/desktop/package.json` `devDependencies`: `"node": "24.9.0"`. Add `allowBuilds.node: true` in `pnpm-workspace.yaml` with a one-line comment that the package downloads the reviewed Node 24 win-x64 binary for the desktop extraResources payload. Run `pnpm install` so `pnpm-lock.yaml` updates.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run scripts/stage-desktop-runtime.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/stage-desktop-runtime.ts scripts/stage-desktop-runtime.spec.ts apps/desktop/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(desktop): stage bundled Node and the runtime closure"
```

---

### Task 3: electron-builder extraResources and unpacked payload check

**Files:**
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json` scripts
- Create: `scripts/verify-desktop-payload.ts`
- Create: `scripts/verify-desktop-payload.spec.ts`
- Modify: `apps/desktop/tests/workflow.spec.ts` (extraResources assertion only if still pointing at the yml)

**Interfaces:**
- Consumes: `dist-desktop-runtime/` from Task 2
- Produces: `verifyDesktopPayload(unpackedResourcesDir: string): void`; installer `dist` script runs stage + verify

- [ ] **Step 1: Write the failing tests**

`scripts/verify-desktop-payload.spec.ts`:

```ts
it('accepts the spec layout', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
  const bin = join(root, 'runtime', 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  mkdirSync(join(bin, '..'), { recursive: true })
  writeFileSync(join(root, 'runtime', 'node.exe'), 'x')
  writeFileSync(join(root, 'runtime', 'harness-node-entry.mjs'), 'x')
  writeFileSync(bin, 'x')
  expect(() => verifyDesktopPayload(join(root, 'runtime'))).not.toThrow()
})

it('rejects a resources tree that only has app.asar', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
  writeFileSync(join(root, 'app.asar'), 'x')
  expect(() => verifyDesktopPayload(join(root, 'runtime'))).toThrow('node.exe')
})
```

Also assert `apps/desktop/electron-builder.yml` `extraResources` contains `dist-desktop-runtime` and does not contain `dist-exe`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/verify-desktop-payload.spec.ts apps/desktop/tests/workflow.spec.ts`

Expected: FAIL (yml still points at `dist-exe`).

- [ ] **Step 3: Write minimal implementation**

`electron-builder.yml`:

```yaml
extraResources:
  - from: ../../dist-desktop-runtime
    to: runtime
```

`verifyDesktopPayload(runtimeDir)` throws unless these files exist as files:

- `node.exe`
- `harness-node-entry.mjs`
- `node/node_modules/@deepseek-ai/dsh/lib/bin.js`

`apps/desktop/package.json` scripts:

```json
"dist": "pnpm build && pnpm exec tsx ../../scripts/stage-desktop-runtime.ts && electron-builder --win nsis && pnpm exec tsx ../../scripts/verify-desktop-payload.ts ../../dist-desktop/win-unpacked/resources/runtime",
"dist:dir": "pnpm build && pnpm exec tsx ../../scripts/stage-desktop-runtime.ts && electron-builder --win dir && pnpm exec tsx ../../scripts/verify-desktop-payload.ts ../../dist-desktop/win-unpacked/resources/runtime"
```

CLI of `verify-desktop-payload.ts` takes one argv path (the unpacked `runtime` directory).

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run scripts/verify-desktop-payload.spec.ts apps/desktop/tests/workflow.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/package.json apps/desktop/tests/workflow.spec.ts scripts/verify-desktop-payload.ts scripts/verify-desktop-payload.spec.ts
git commit -m "fix(desktop): pack the node closure as extraResources"
```

---

### Task 4: Child environment sanitization

**Files:**
- Create: `apps/desktop/src/environment.ts`
- Create: `apps/desktop/tests/environment.spec.ts`

**Interfaces:**
- Produces:

```ts
export function stripElectronNodeMode(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function resolveEnvironmentPath(environment: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string
export function parseEnvOutput(output: string, lineSeparator: RegExp): NodeJS.ProcessEnv
export function withoutUndecodableValues(captured: NodeJS.ProcessEnv, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function childEnvironment(parent: NodeJS.ProcessEnv, extras: { DSH_HOME: string }): NodeJS.ProcessEnv
```

`resolveShellEnvironment()` may shell out; tests cover the pure helpers. Production `childEnvironment` uses `stripElectronNodeMode` on the captured-or-inherited env, then sets `DSH_HOME` and the case-correct `Path`/`PATH`.

- [ ] **Step 1: Write the failing test**

```ts
it('removes ELECTRON_RUN_AS_NODE', () => {
  expect(stripElectronNodeMode({ ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' })).toEqual({ FOO: 'bar' })
})

it('reads Path on Windows regardless of case', () => {
  expect(resolveEnvironmentPath({ path: 'C:\\bin' }, 'win32')).toBe('C:\\bin')
})

it('drops U+FFFD TEMP and falls back', () => {
  expect(withoutUndecodableValues(
    { TEMP: 'C:\\Users\\\uFFFD' },
    { TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp' },
  )).toEqual({ TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/environment.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Implement the five functions. `childEnvironment` must not copy secrets into a new renderer-visible object; it only returns a process env for `spawn`. JSDoc `@param`/`@returns` on each export.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run apps/desktop/tests/environment.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/environment.ts apps/desktop/tests/environment.spec.ts
git commit -m "feat(desktop): sanitize the Windows Harness environment"
```

---

### Task 5: Harness node entry and Windows hide wrappers

**Files:**
- Create: `apps/desktop/src/windows-child-process-hide.mjs`
- Create: `apps/desktop/src/windows-hidden-console.mjs`
- Create: `apps/desktop/src/harness-node-entry.mjs`
- Create: `apps/desktop/tests/windows-child-process-hide.spec.ts`

**Interfaces:**
- Consumes: Task 2 wrapper copy list (basenames must match)
- Produces: `applyWindowsHide(options)`, `enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports)`, `createHiddenConsole({ load })`

`harness-node-entry.mjs` argv: `node harness-node-entry.mjs <dshEntryPath> ...dshArguments`. It must not set `ELECTRON_RUN_AS_NODE` on Windows (bundled Node, not Electron). On `win32` it creates a hidden console and patches `child_process`. Then `import(pathToFileURL(dshEntryPath))`.

Load `koffi` from the staged closure via `createRequire(join(dirname(fileURLToPath(import.meta.url)), 'node', 'package.json'))` so the wrapper beside `runtime/node/` can see `koffi`. `createHiddenConsole` failures return `false` and must not throw.

- [ ] **Step 1: Write the failing test**

Test `applyWindowsHide`: undefined options become `{ windowsHide: true }`; explicit `windowsHide: false` is preserved.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/windows-child-process-hide.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Write the three modules**

`windows-child-process-hide.mjs`: patch `spawn`, `spawnSync`, `exec`, `execFile`, `execFileSync`, `fork`, then `syncBuiltinESMExports()`.

`windows-hidden-console.mjs`: `AllocConsole` + `GetConsoleWindow` + `ShowWindow(SW_HIDE=0)` through injectable `load`.

`harness-node-entry.mjs`: log `runtime node=`, `execPath`, `cwd`, `DSH_HOME`; on win32 enable hide; missing entry path exits 1; failed import writes `DSH entry failed:` to stderr.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run apps/desktop/tests/windows-child-process-hide.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/windows-child-process-hide.mjs apps/desktop/src/windows-hidden-console.mjs apps/desktop/src/harness-node-entry.mjs apps/desktop/tests/windows-child-process-hide.spec.ts
git commit -m "feat(desktop): hide Windows consoles for the Harness process tree"
```

---

### Task 6: Runtime spawn, URL probe, log, 60s timeout

**Files:**
- Modify: `apps/desktop/src/runtime.ts`
- Create: `apps/desktop/tests/runtime.spec.ts`
- Keep: `apps/desktop/src/startup-url.ts` (no behavior change)

**Interfaces:**
- Consumes: `parseStartupUrl`, `terminateProcessTree`, `childEnvironment`
- Produces:

```ts
export interface RuntimeHandle {
  readonly url: string
  stop(): Promise<void>
}

export interface RuntimeOptions {
  readonly executable: string
  readonly entryWrapper: string
  readonly binJs: string
  readonly home: string
  readonly launchRoot: string
  readonly logPath: string
  readonly timeoutMs?: number
  readonly env?: NodeJS.ProcessEnv
  readonly probe?: (url: string) => Promise<void>
  readonly spawnImpl?: typeof spawn
}

export async function startRuntime(options: RuntimeOptions): Promise<RuntimeHandle>
export function defaultRuntimeHome(userData: string): string
export function defaultLaunchRoot(userData: string): string
```

Default timeout `60_000`. Args: `[entryWrapper, binJs, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0']`. `cwd: launchRoot`. `windowsHide: true`. Probe default: `fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })` and throw unless status is 200–399. Append stdout/stderr lines to `logPath`.

- [ ] **Step 1: Write the failing test**

Fake `spawnImpl` that writes `dsh web: http://127.0.0.1:43123/?token=abc\n` on stdout. Inject `probe` that records the URL. Assert `startRuntime` returns that URL, used args contain `harness-node-entry.mjs` and `bin.js`, env has `DSH_HOME` and no `ELECTRON_RUN_AS_NODE`, and timeout default is 60s (pass a fake timer or assert the constant export `STARTUP_TIMEOUT_MS === 60_000`).

Add a test that a non-loopback URL rejects and calls stop.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/runtime.spec.ts`

Expected: FAIL (options still `{ executable, home }`).

- [ ] **Step 3: Write minimal implementation**

Rewrite `startRuntime` to the new options. `defaultLaunchRoot(userData)` returns `join(userData, 'launch-root')`. Create both directories. Keep `defaultRuntimeHome` as `join(userData, 'dsh')`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run apps/desktop/tests/runtime.spec.ts apps/desktop/tests/startup-url.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/runtime.ts apps/desktop/tests/runtime.spec.ts
git commit -m "feat(desktop): launch bundled Node and probe the Web URL"
```

---

### Task 7: Main-process path resolution and lifecycle

**Files:**
- Create: `apps/desktop/src/runtime-paths.ts`
- Create: `apps/desktop/tests/runtime-paths.spec.ts`
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**
- Consumes: `startRuntime`, `defaultRuntimeHome`, `defaultLaunchRoot`
- Produces:

```ts
export interface DesktopRuntimePaths {
  readonly executable: string
  readonly entryWrapper: string
  readonly binJs: string
}

export function resolveDesktopRuntimePaths(input: {
  readonly configuredRoot?: string
  readonly resourcesPath: string
  readonly appPath: string
  readonly exists: (path: string) => boolean
}): DesktopRuntimePaths
```

Resolution order: `DSH_RUNTIME_PATH` as a directory containing `node.exe`; else `join(resourcesPath, 'runtime')` when `node.exe` exists; else `join(appPath, '..', '..', 'dist-desktop-runtime')`. Throw if `node.exe`, `harness-node-entry.mjs`, or `bin.js` is missing (include the resolved directory in the message). Packaged builds must not fall back to `dist-exe`.

`main.ts` `boot()`: `mkdir` launch-root, `startRuntime` with `logPath: join(app.getPath('logs'), 'harness.log')`. Keep single-instance lock, navigation origin allowlist, process-tree shutdown.

- [ ] **Step 1: Write the failing test**

```ts
it('prefers a packaged runtime directory', () => {
  const paths = resolveDesktopRuntimePaths({
    resourcesPath: '/res',
    appPath: '/app',
    exists: path => path.startsWith('/res/runtime'),
  })
  expect(paths.executable).toBe(join('/res', 'runtime', 'node.exe'))
})

it('does not use dist-exe', () => {
  expect(() => resolveDesktopRuntimePaths({
    resourcesPath: '/res',
    appPath: '/app',
    exists: () => false,
  })).toThrow('node.exe')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/runtime-paths.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement paths and wire `main.ts`**

Replace `RUNTIME_EXE` / `runtimeExecutable()` with `resolveDesktopRuntimePaths`. Pass `process.env.DSH_RUNTIME_PATH`, `process.resourcesPath`, `app.getAppPath()`, `existsSync`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/runtime-paths.ts apps/desktop/src/main.ts apps/desktop/tests/runtime-paths.spec.ts
git commit -m "feat(desktop): resolve the bundled Node runtime payload"
```

---

### Task 8: Dual-channel GitHub Release workflow

**Files:**
- Delete: `.github/workflows/dsh-runtime-release.yml`
- Create: `.github/workflows/dsh-desktop-release.yml`
- Modify: `apps/desktop/tests/workflow.spec.ts`
- Modify: `.agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.md` and `.zh.md` + i18n (present-tense Decision: node closure installer, two channels)

**Interfaces:**
- Consumes: `desktop:dist` / filter dist from Task 3; `--skip-pkg` from Task 1
- Produces: prerelease `dsh-desktop-<12-char-sha>` on `master`; Latest `desktop-v*` when tag version equals root `package.json` version

- [ ] **Step 1: Write the failing workflow test**

Replace `apps/desktop/tests/workflow.spec.ts` to load `dsh-desktop-release.yml`:

- `on.push.tags` includes `desktop-v*`
- no `pkg-cache` step
- build step contains `--skip-pkg` and does not contain `pkg-fetch`
- installer step contains `dsh-desktop dist`
- upload contains `DeepSeek-Harness-Setup-*-x64.exe` and `SHA256SUMS` and does not contain `dist-exe/deepseek-harness-sdk-runtime`
- official tag path is not `--prerelease` when `github.ref_type == tag`
- a step compares `desktop-v` suffix to `require('./package.json').version`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/workflow.spec.ts`

Expected: FAIL (old workflow path / pkg assets).

- [ ] **Step 3: Write the workflow**

Triggers: `push.branches: [master]`, `push.tags: ['desktop-v*']`, `workflow_dispatch`.

`windows-2025`, `contents: write`, `DSH_TELEMETRY_DISABLED: '1'`. Keep Developer Mode, pnpm, Node 24, frozen install, `npm_execpath` export. Drop pkg cache.

Build:

```powershell
$env:DSH_BUILD_CLIENT_PROFILE = 'official'
pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg
pnpm --filter @deepseek-ai/dsh-desktop dist
```

`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.

Checksum only the installer + write `dist-desktop/SHA256SUMS`.

Identity:

- version = root `package.json` version
- if tag `desktop-v*`: require suffix === version; `tag=$GITHUB_REF_NAME`; `prerelease=false`; title `DSH Windows desktop $version`
- else: `tag=dsh-desktop-$shortSha`; `prerelease=true`; title `DSH Windows desktop $version ($shortSha)`

Upload installer glob + SHA256SUMS with `--clobber`. Use `--prerelease` only when `prerelease=true`.

Rewrite the Agent Note Decision/Consequences in present tense for this workflow. Re-record its pairing sidecar.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run apps/desktop/tests/workflow.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/dsh-desktop-release.yml .github/workflows/dsh-runtime-release.yml apps/desktop/tests/workflow.spec.ts .agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.md .agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.zh.md .agents/notes/implemented/process/2026-09-04-dsh-runtime-release-workflow.i18n.yaml
git commit -m "ci: publish Windows desktop installers on master and desktop-v tags"
```

---

### Task 9: Docs, README, and Windows smoke

**Files:**
- Modify: `apps/desktop/README.md`, `README.zh.md`, re-record `README.i18n.yaml`
- Create: `scripts/smoke-desktop-runtime.ts` (optional CI step after stage; skip off win32 when payload missing locally)
- Modify: `.github/workflows/dsh-desktop-release.yml` to run the smoke after staging / before or after `dist` using the staged tree (does not require the Electron GUI)

**Interfaces:**
- Consumes: staged `dist-desktop-runtime/`
- Produces: smoke that spawns `node.exe harness-node-entry.mjs <bin.js> web --no-open --host 127.0.0.1 --port 0`, parses `dsh web:`, `fetch`es the URL, then `taskkill /T /F`

- [ ] **Step 1: Update README pair**

Development:

```powershell
pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-win-x64 --skip-pkg
pnpm exec tsx scripts/stage-desktop-runtime.ts
$env:DSH_RUNTIME_PATH = "..\..\dist-desktop-runtime"
pnpm --filter @deepseek-ai/dsh-desktop start
```

Dist: `pnpm --filter @deepseek-ai/dsh-desktop dist` (script already stages). State that the installer includes bundled Node and the closure, not a pkg exe or `-rg.exe` sidecar.

- [ ] **Step 2: Re-record README pairing**

Run: `pnpm run verify-translation-pairing --write apps/desktop/README.md`

- [ ] **Step 3: Add smoke script and CI step**

`scripts/smoke-desktop-runtime.ts`: resolve `dist-desktop-runtime`, spawn as spec, reuse `parseStartupUrl` (import from `apps/desktop/src/startup-url.ts` via tsx), fetch, kill tree, exit non-zero on timeout 60s. Workflow step name `Smoke staged runtime` after stage/dist when files exist.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run apps/desktop/tests scripts/build-exe-for-python-sdk.spec.ts scripts/stage-desktop-runtime.spec.ts scripts/verify-desktop-payload.spec.ts`

Run: `pnpm run verify-translation-pairing apps/desktop/README.md docs/superpowers/specs/2026-09-04-dsh-desktop-host-design.md`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml scripts/smoke-desktop-runtime.ts .github/workflows/dsh-desktop-release.yml
git commit -m "docs(desktop): document the bundled Node closure installer"
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| Bundled Node + hoisted closure, no host DSH imports | 2, 6, 7 |
| Spawn argv, port 0, `dsh web:` parse, probe | 6 |
| Installed layout / extraResources / no `-rg.exe` | 2, 3 |
| `--skip-pkg`, Python pkg stays separate | 1, 8 |
| `DSH_HOME` / `launch-root` / harness.log | 6, 7 |
| Windows env, hidden console, `windowsHide` | 4, 5 |
| Failure table, 60s timeout, single-instance | 6, 7 |
| Security (loopback, sandbox, IPC) | already in `main.ts`; keep in Task 7 |
| Upstream git merge + `dsh-desktop-<sha>` / `desktop-v*` | 8 |
| Unpacked payload hard check | 3 |
| Windows CI smoke | 9 |
| Deferred `file:// + IPC` | no task |

## Notes for the executor

- Do not implement the uncommitted `packages/boot/app-boot/src/profile.ts` proxy client-metadata patch.
- Do not add `apps/*/package.json` to `verify-runtime-closure.ts` as part of this plan.
- `pnpm test` coverage 100% applies to `packages/*/*/src`, not `apps/desktop`.
- Full `pnpm --filter @deepseek-ai/dsh-desktop dist` is Windows-only and needs a prior `--skip-pkg` deploy; CI owns that, local reproduction follows the README.
