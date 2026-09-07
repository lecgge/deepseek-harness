/**
 * Smoke the staged Windows desktop runtime without launching Electron.
 *
 * Spawns `node.exe harness-node-entry.mjs <bin.js> web --no-open --host 127.0.0.1 --port 0`
 * from `dist-desktop-runtime/`, parses `dsh web:` with `parseStartupUrl`, fetches the URL,
 * then `taskkill /T /F`s the process tree. Times out after 60s.
 *
 * Skips (exit 0) off win32, and when the staged payload is missing locally.
 * GitHub Actions fails if the payload is absent.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parseStartupUrl } from '../apps/desktop/src/startup-url.ts'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const DESTINATION = 'dist-desktop-runtime'
const TIMEOUT_MS = 60_000
const REQUIRED_FILES = [
  'node.exe',
  'harness-node-entry.mjs',
  join('node', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
] as const

function payloadReady(runtimeDir: string): boolean {
  return REQUIRED_FILES.every(relative => existsSync(join(runtimeDir, relative)))
}

async function killTree(pid: number): Promise<void> {
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } catch {
    // taskkill fails when the PID is already gone.
  }
}

/**
 * Read stdout until `parseStartupUrl` accepts a `dsh web:` line.
 * @param child - spawned bundled-Node process.
 * @param timeoutMs - milliseconds allowed before failing.
 * @returns the authenticated loopback URL.
 */
function waitForStartupUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let buffer = ''
    let settled = false
    const finish = (error: unknown, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      resolveUrl(url as string)
    }
    const timer = setTimeout(() => {
      finish(new Error(`smoke-desktop-runtime: timed out after ${String(timeoutMs)}ms waiting for dsh web:`))
    }, timeoutMs)
    child.once('error', error => finish(error))
    child.once('exit', (code) => {
      finish(new Error(`smoke-desktop-runtime: runtime exited during smoke (code ${String(code)})`))
    })
    const onChunk = (chunk: Buffer | string): void => {
      buffer += String(chunk)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const parsed = parseStartupUrl(line)
          if (parsed !== undefined) finish(undefined, parsed)
        } catch (error) {
          finish(error)
        }
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', (chunk: Buffer | string) => {
      process.stderr.write(chunk)
    })
    child.stdout?.once('end', () => {
      if (buffer !== '') onChunk('\n')
      finish(new Error('smoke-desktop-runtime: runtime exited before printing its Web URL'))
    })
  })
}

async function runSmoke(runtimeDir: string): Promise<void> {
  const executable = join(runtimeDir, 'node.exe')
  const entryWrapper = join(runtimeDir, 'harness-node-entry.mjs')
  const binJs = join(runtimeDir, REQUIRED_FILES[2])
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-home-'))
  const launchRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-cwd-'))
  const child = spawn(executable, [
    entryWrapper,
    binJs,
    'web',
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: launchRoot,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pid = child.pid
  try {
    const url = await waitForStartupUrl(child, TIMEOUT_MS)
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`smoke-desktop-runtime: probe failed with status ${String(response.status)}`)
    }
    console.log('smoke-desktop-runtime: ok')
  } finally {
    if (pid !== undefined) await killTree(pid)
    try {
      await rm(home, { recursive: true, force: true })
    } catch {
      // Temp DSH_HOME may still be locked after taskkill.
    }
    try {
      await rm(launchRoot, { recursive: true, force: true })
    } catch {
      // Temp cwd may still be locked after taskkill.
    }
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log(`smoke-desktop-runtime: skipped (not win32, got ${process.platform})`)
    process.exit(0)
  }
  const runtimeDir = join(root, DESTINATION)
  if (!payloadReady(runtimeDir)) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(`smoke-desktop-runtime: missing staged payload at ${runtimeDir}`)
    }
    console.log(`smoke-desktop-runtime: skipped (missing staged payload at ${runtimeDir})`)
    process.exit(0)
  }
  await runSmoke(runtimeDir)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
