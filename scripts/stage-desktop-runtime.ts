/**
 * Copy the pinned Windows Node binary, desktop wrapper modules, and the Python
 * node carrier into `dist-desktop-runtime/` for electron-builder extraResources.
 */

import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PYTHON_NODE_CARRIER = 'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node'
const DESTINATION = 'dist-desktop-runtime'
const CLOSURE_BIN = join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const DESKTOP_WRAPPERS = [
  'harness-node-entry.mjs',
  'windows-hidden-console.mjs',
  'windows-child-process-hide.mjs',
] as const

/** Inputs for copying the Windows desktop runtime payload. */
export interface StageDesktopRuntimeOptions {
  readonly sourceClosure: string
  readonly nodeExecutable: string
  readonly wrappers: readonly string[]
  readonly destination: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

/**
 * Replace `destination` with `node.exe`, wrapper basenames, and the closure under `node/`.
 * @param options - closure, Node executable, wrappers, destination, and optional host platform/arch.
 * @returns after the destination tree is written.
 */
export async function stageDesktopRuntime(options: StageDesktopRuntimeOptions): Promise<void> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(`stage-desktop-runtime: requires Windows x64, got ${platform}-${arch}.`)
  }
  if (!existsSync(options.nodeExecutable)) {
    throw new Error(`stage-desktop-runtime: missing node.exe at ${options.nodeExecutable}.`)
  }
  const binJs = join(options.sourceClosure, CLOSURE_BIN)
  if (!existsSync(binJs)) {
    throw new Error(`stage-desktop-runtime: missing bin.js at ${binJs}.`)
  }
  await rm(options.destination, { recursive: true, force: true })
  await mkdir(options.destination, { recursive: true })
  await copyFile(options.nodeExecutable, join(options.destination, 'node.exe'))
  for (const wrapper of options.wrappers) {
    await copyFile(wrapper, join(options.destination, basename(wrapper)))
  }
  await cp(options.sourceClosure, join(options.destination, 'node'), { recursive: true })
}

function defaultNodeExecutable(): string {
  const require = createRequire(join(root, 'apps/desktop/package.json'))
  return join(require.resolve('node/package.json'), '..', 'bin', 'node.exe')
}

async function main(): Promise<void> {
  const desktopSrc = join(root, 'apps/desktop/src')
  await stageDesktopRuntime({
    sourceClosure: join(root, PYTHON_NODE_CARRIER),
    nodeExecutable: defaultNodeExecutable(),
    wrappers: DESKTOP_WRAPPERS.map(name => join(desktopSrc, name)),
    destination: join(root, DESTINATION),
  })
}

if (import.meta.main) {
  await main()
}
