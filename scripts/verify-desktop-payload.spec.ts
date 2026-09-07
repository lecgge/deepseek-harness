import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { verifyDesktopPayload } from './verify-desktop-payload.ts'

describe('verifyDesktopPayload', () => {
  it('accepts the spec layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
    const bin = join(root, 'runtime', 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(join(root, 'runtime', 'node.exe'), 'x')
    writeFileSync(join(root, 'runtime', 'harness-node-entry.mjs'), 'x')
    writeFileSync(join(root, 'runtime', 'windows-hidden-console.mjs'), 'x')
    writeFileSync(join(root, 'runtime', 'windows-child-process-hide.mjs'), 'x')
    writeFileSync(bin, 'x')
    expect(() => verifyDesktopPayload(join(root, 'runtime'))).not.toThrow()
  })

  it('rejects a runtime missing windows-hidden-console.mjs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
    const runtime = join(root, 'runtime')
    const bin = join(runtime, 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(join(runtime, 'node.exe'), 'x')
    writeFileSync(join(runtime, 'harness-node-entry.mjs'), 'x')
    writeFileSync(join(runtime, 'windows-child-process-hide.mjs'), 'x')
    writeFileSync(bin, 'x')
    expect(() => verifyDesktopPayload(runtime)).toThrow('windows-hidden-console.mjs')
  })

  it('rejects a runtime missing windows-child-process-hide.mjs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
    const runtime = join(root, 'runtime')
    const bin = join(runtime, 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(join(runtime, 'node.exe'), 'x')
    writeFileSync(join(runtime, 'harness-node-entry.mjs'), 'x')
    writeFileSync(join(runtime, 'windows-hidden-console.mjs'), 'x')
    writeFileSync(bin, 'x')
    expect(() => verifyDesktopPayload(runtime)).toThrow('windows-child-process-hide.mjs')
  })

  it('rejects a resources tree that only has app.asar', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-payload-'))
    writeFileSync(join(root, 'app.asar'), 'x')
    expect(() => verifyDesktopPayload(join(root, 'runtime'))).toThrow('node.exe')
  })
})

describe('electron-builder extraResources', () => {
  it('packs dist-desktop-runtime and does not pack dist-exe', () => {
    const ymlPath = resolve(import.meta.dirname, '../apps/desktop/electron-builder.yml')
    const config = yaml.load(readFileSync(ymlPath, 'utf8')) as {
      extraResources: Array<{ from: string; to: string }>
    }
    const fromPaths = config.extraResources.map(entry => entry.from).join('\n')
    expect(fromPaths).toContain('dist-desktop-runtime')
    expect(fromPaths).not.toContain('dist-exe')
  })
})
