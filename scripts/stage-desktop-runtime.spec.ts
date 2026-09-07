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
    .map((name) => {
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
