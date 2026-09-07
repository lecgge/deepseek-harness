import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STARTUP_TIMEOUT_MS,
  defaultLaunchRoot,
  defaultRuntimeHome,
  startRuntime,
} from '../src/runtime.js'

const { terminateProcessTree, resolveShellEnvironment } = vi.hoisted(() => ({
  terminateProcessTree: vi.fn(async () => undefined),
  resolveShellEnvironment: vi.fn((): NodeJS.ProcessEnv => ({
    ELECTRON_RUN_AS_NODE: '1',
    SHELL_CAPTURED: '1',
    PATH: '/bin',
  })),
}))

vi.mock('../src/process-tree.js', () => ({
  terminateProcessTree,
}))

vi.mock('../src/environment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/environment.js')>()
  return {
    ...actual,
    resolveShellEnvironment,
  }
})

const STARTUP_LINE = 'dsh web: http://127.0.0.1:43123/?token=abc\n'
const STARTUP_URL = 'http://127.0.0.1:43123/?token=abc'

function fakeChild(line: string): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    stdout: {
      async *[Symbol.asyncIterator]() {
        yield line
      },
    },
    stderr: {
      async *[Symbol.asyncIterator]() {},
    },
    pid: undefined,
  })
  return child
}

describe('startRuntime', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-'))
    terminateProcessTree.mockClear()
    resolveShellEnvironment.mockClear()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('spawns the bundled Node entry, probes the printed URL, and defaults to a 60s timeout', async () => {
    expect(STARTUP_TIMEOUT_MS).toBe(60_000)

    const home = join(root, 'dsh')
    const launchRoot = join(root, 'launch-root')
    const logPath = join(root, 'harness.log')
    const entryWrapper = join(root, 'harness-node-entry.mjs')
    const binJs = join(root, 'bin.js')
    const probed: string[] = []
    let spawned: { args: readonly string[]; options: SpawnOptions } | undefined

    const spawnImpl = ((_command: string, args: readonly string[], options: SpawnOptions) => {
      spawned = { args, options }
      return fakeChild(STARTUP_LINE)
    }) as typeof spawn

    const handle = await startRuntime({
      executable: join(root, 'node.exe'),
      entryWrapper,
      binJs,
      home,
      launchRoot,
      logPath,
      env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' },
      probe: async (url) => {
        probed.push(url)
      },
      spawnImpl,
    })

    expect(handle.url).toBe(STARTUP_URL)
    expect(probed).toEqual([STARTUP_URL])
    expect(spawned?.args.some(arg => arg.includes('harness-node-entry.mjs'))).toBe(true)
    expect(spawned?.args.some(arg => arg.includes('bin.js'))).toBe(true)
    expect(spawned?.args).toEqual([
      entryWrapper,
      binJs,
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
    expect(spawned?.options.cwd).toBe(launchRoot)
    expect(spawned?.options.windowsHide).toBe(true)
    expect(spawned?.options.env?.DSH_HOME).toBe(home)
    expect(spawned?.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(await readFile(logPath, 'utf8')).toContain(STARTUP_LINE.trim())

    await handle.stop()
    expect(terminateProcessTree).toHaveBeenCalled()
    expect(resolveShellEnvironment).not.toHaveBeenCalled()
  })

  it('uses resolveShellEnvironment when env is omitted', async () => {
    const home = join(root, 'dsh')
    const launchRoot = join(root, 'launch-root')
    let spawned: { options: SpawnOptions } | undefined
    const spawnImpl = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
      spawned = { options }
      return fakeChild(STARTUP_LINE)
    }) as typeof spawn

    const handle = await startRuntime({
      executable: join(root, 'node.exe'),
      entryWrapper: join(root, 'harness-node-entry.mjs'),
      binJs: join(root, 'bin.js'),
      home,
      launchRoot,
      logPath: join(root, 'harness.log'),
      probe: async () => undefined,
      spawnImpl,
    })

    expect(resolveShellEnvironment).toHaveBeenCalled()
    expect(spawned?.options.env?.DSH_HOME).toBe(home)
    expect(spawned?.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(spawned?.options.env?.SHELL_CAPTURED).toBe('1')

    await handle.stop()
  })

  it('rejects a non-loopback URL and stops the child', async () => {
    const spawnImpl = ((_command: string, _args: readonly string[], _options: SpawnOptions) => {
      return fakeChild('dsh web: http://localhost:43123/?token=abc\n')
    }) as typeof spawn

    await expect(startRuntime({
      executable: join(root, 'node.exe'),
      entryWrapper: join(root, 'harness-node-entry.mjs'),
      binJs: join(root, 'bin.js'),
      home: join(root, 'dsh'),
      launchRoot: join(root, 'launch-root'),
      logPath: join(root, 'harness.log'),
      probe: async () => undefined,
      spawnImpl,
    })).rejects.toThrow('dsh web startup URL must use http://127.0.0.1')

    expect(terminateProcessTree).toHaveBeenCalled()
  })
})

describe('default runtime paths', () => {
  it('places DSH_HOME and launch-root under userData', () => {
    const userData = join('Users', 'test')
    expect(defaultRuntimeHome(userData)).toBe(join(userData, 'dsh'))
    expect(defaultLaunchRoot(userData)).toBe(join(userData, 'launch-root'))
  })
})
