import { describe, expect, it } from 'vitest'
import {
  applyWindowsHide,
  enforceWindowsChildProcessHide,
} from '../src/windows-child-process-hide.mjs'
import { createHiddenConsole } from '../src/windows-hidden-console.mjs'

describe('applyWindowsHide', () => {
  it('defaults undefined options to windowsHide true', () => {
    expect(applyWindowsHide(undefined)).toEqual({ windowsHide: true })
  })

  it('preserves explicit windowsHide false', () => {
    expect(applyWindowsHide({ windowsHide: false })).toEqual({ windowsHide: false })
  })
})

describe('createHiddenConsole', () => {
  it('allocates a console and hides it through injectable load', () => {
    const hwnd = { handle: 1 }
    let shown: { hwnd: unknown; cmd: number } | undefined
    const load = (dll: string) => ({
      func: (_convention: string, name: string) => {
        if (name === 'GetConsoleWindow') return () => hwnd
        if (name === 'ShowWindow') {
          return (window: unknown, cmd: number) => {
            shown = { hwnd: window, cmd }
            return 1
          }
        }
        expect(dll).toBe('kernel32.dll')
        return () => 1
      },
    })
    expect(createHiddenConsole({ load })).toBe(true)
    expect(shown).toEqual({ hwnd, cmd: 0 })
  })

  it('returns false when load throws', () => {
    expect(createHiddenConsole({
      load: () => {
        throw new Error('koffi unavailable')
      },
    })).toBe(false)
  })
})

describe('enforceWindowsChildProcessHide', () => {
  it('patches spawn options and syncs ESM exports', () => {
    const spawned: unknown[] = []
    const childProcess = {
      spawn: (command: string, args: unknown, options: unknown) => {
        spawned.push([command, args, options])
      },
      spawnSync: () => undefined,
      exec: () => undefined,
      execFile: () => undefined,
      execFileSync: () => undefined,
      fork: () => undefined,
    }
    let synced = false
    enforceWindowsChildProcessHide(childProcess, () => {
      synced = true
    })
    childProcess.spawn('node', ['a.js'], { cwd: 'x' })
    expect(spawned[0]).toEqual(['node', ['a.js'], { cwd: 'x', windowsHide: true }])
    expect(synced).toBe(true)
  })
})
