import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopRuntimePaths } from '../src/runtime-paths.js'

function filesUnder(root: string): (path: string) => boolean {
  const required = new Set([
    join(root, 'node.exe'),
    join(root, 'harness-node-entry.mjs'),
    join(root, 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ])
  return path => required.has(path)
}

function expectResolved(root: string, paths: ReturnType<typeof resolveDesktopRuntimePaths>): void {
  expect(paths.executable).toBe(join(root, 'node.exe'))
  expect(paths.entryWrapper).toBe(join(root, 'harness-node-entry.mjs'))
  expect(paths.binJs).toBe(join(root, 'node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
}

describe('resolveDesktopRuntimePaths', () => {
  it('prefers a packaged runtime directory', () => {
    const packaged = join('/res', 'runtime')
    const paths = resolveDesktopRuntimePaths({
      resourcesPath: '/res',
      appPath: '/app',
      exists: path => path.startsWith(packaged),
    })
    expect(paths.executable).toBe(join(packaged, 'node.exe'))
    expectResolved(packaged, paths)
  })

  it('prefers DSH_RUNTIME_PATH as a runtime directory', () => {
    const configured = join('/custom', 'runtime')
    const paths = resolveDesktopRuntimePaths({
      configuredRoot: configured,
      resourcesPath: '/res',
      appPath: '/app',
      exists: filesUnder(configured),
    })
    expectResolved(configured, paths)
  })

  it('does not fall back when DSH_RUNTIME_PATH is set but incomplete', () => {
    const configured = join('/custom', 'runtime')
    expect(() => resolveDesktopRuntimePaths({
      configuredRoot: configured,
      resourcesPath: '/res',
      appPath: '/app',
      exists: filesUnder(join('/res', 'runtime')),
    })).toThrow(configured)
  })

  it('falls back to the staged checkout runtime', () => {
    const checkout = join('/app', '..', '..', 'dist-desktop-runtime')
    const paths = resolveDesktopRuntimePaths({
      resourcesPath: '/res',
      appPath: '/app',
      exists: filesUnder(checkout),
    })
    expectResolved(checkout, paths)
  })

  it('does not use dist-exe', () => {
    expect(() => resolveDesktopRuntimePaths({
      resourcesPath: '/res',
      appPath: '/app',
      exists: () => false,
    })).toThrow('node.exe')
    try {
      resolveDesktopRuntimePaths({
        resourcesPath: '/res',
        appPath: '/app',
        exists: () => false,
      })
      expect.unreachable()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain(join('/app', '..', '..', 'dist-desktop-runtime'))
      expect(message).not.toContain('dist-exe')
    }
  })

  it('throws when harness-node-entry.mjs is missing', () => {
    const packaged = join('/res', 'runtime')
    expect(() => resolveDesktopRuntimePaths({
      resourcesPath: '/res',
      appPath: '/app',
      exists: path => path === join(packaged, 'node.exe'),
    })).toThrow('harness-node-entry.mjs')
  })

  it('throws when bin.js is missing', () => {
    const packaged = join('/res', 'runtime')
    expect(() => resolveDesktopRuntimePaths({
      resourcesPath: '/res',
      appPath: '/app',
      exists: path => path === join(packaged, 'node.exe') || path === join(packaged, 'harness-node-entry.mjs'),
    })).toThrow('bin.js')
  })
})
