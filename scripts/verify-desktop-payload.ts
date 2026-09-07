/**
 * Fail the desktop dist if the unpacked `resources/runtime` tree is incomplete.
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_FILES = [
  'node.exe',
  'harness-node-entry.mjs',
  'windows-hidden-console.mjs',
  'windows-child-process-hide.mjs',
  join('node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
] as const

/**
 * Throw unless `unpackedResourcesDir` contains the staged Node runtime files.
 * @param unpackedResourcesDir - unpacked `resources/runtime` directory under win-unpacked.
 */
export function verifyDesktopPayload(unpackedResourcesDir: string): void {
  for (const relative of REQUIRED_FILES) {
    const path = join(unpackedResourcesDir, relative)
    let isFile = false
    try {
      isFile = statSync(path).isFile()
    } catch {
      // Missing path: report the required basename below.
    }
    if (!isFile) {
      throw new Error(`verify-desktop-payload: missing ${relative} at ${path}`)
    }
  }
}

function main(): void {
  const runtimeDir = process.argv[2]
  if (runtimeDir === undefined || runtimeDir === '') {
    throw new Error('verify-desktop-payload: pass the unpacked resources/runtime directory')
  }
  verifyDesktopPayload(runtimeDir)
}

if (import.meta.main) {
  main()
}
