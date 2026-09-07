import { join } from 'node:path'

const NODE_EXE = 'node.exe'
const ENTRY_WRAPPER = 'harness-node-entry.mjs'
const BIN_JS = join('node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Spawn paths for the bundled Node runtime payload. */
export interface DesktopRuntimePaths {
  readonly executable: string
  readonly entryWrapper: string
  readonly binJs: string
}

/**
 * Locate the bundled Node executable, entry wrapper, and DSH `bin.js`.
 *
 * Prefers a non-empty `configuredRoot` (`DSH_RUNTIME_PATH` as a directory),
 * then `resourcesPath/runtime` when `node.exe` exists, then the checkout
 * `dist-desktop-runtime` directory. Never uses `dist-exe`.
 *
 * @param input - optional configured runtime directory, Electron resource and app paths, and an existence probe.
 * @returns spawn paths for `startRuntime`.
 */
export function resolveDesktopRuntimePaths(input: {
  readonly configuredRoot?: string
  readonly resourcesPath: string
  readonly appPath: string
  readonly exists: (path: string) => boolean
}): DesktopRuntimePaths {
  const configured = input.configuredRoot?.trim()
  const packaged = join(input.resourcesPath, 'runtime')
  const checkout = join(input.appPath, '..', '..', 'dist-desktop-runtime')
  let root = checkout
  if (configured !== undefined && configured !== '') {
    root = configured
  } else if (input.exists(join(packaged, NODE_EXE))) {
    root = packaged
  }
  const executable = join(root, NODE_EXE)
  const entryWrapper = join(root, ENTRY_WRAPPER)
  const binJs = join(root, BIN_JS)
  for (const [label, path] of [
    [NODE_EXE, executable],
    [ENTRY_WRAPPER, entryWrapper],
    ['bin.js', binJs],
  ] as const) {
    if (!input.exists(path)) {
      throw new Error(`Missing ${label} in ${root}`)
    }
  }
  return { executable, entryWrapper, binJs }
}
