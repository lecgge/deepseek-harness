import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseStartupUrl } from './startup-url.js'
import { terminateProcessTree } from './process-tree.js'

const STARTUP_TIMEOUT_MS = 30_000

export interface RuntimeHandle {
  readonly url: string
  stop(): Promise<void>
}

export interface RuntimeOptions {
  readonly executable: string
  readonly home: string
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}

/**
 * Start the standalone DSH runtime and await its authenticated Web URL.
 * @param options - runtime executable, per-user DSH directory, and startup settings.
 * @returns the tokenized Web URL and an idempotent runtime shutdown operation.
 */
export async function startRuntime(options: RuntimeOptions): Promise<RuntimeHandle> {
  await mkdir(options.home, { recursive: true })
  const child = spawn(options.executable, ['web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, DSH_HOME: options.home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let settled = false
  let output = ''
  const timeout = setTimeout(() => {
    if (!settled) child.emit('error', new Error('DSH runtime startup timed out'))
  }, options.timeoutMs ?? STARTUP_TIMEOUT_MS)
  const readLine = async (): Promise<string> => {
    for await (const chunk of child.stdout ?? []) {
      output += String(chunk)
      const lines = output.split(/\r?\n/)
      output = lines.pop() ?? ''
      for (const line of lines) {
        const url = parseStartupUrl(line)
        if (url !== undefined) return url
      }
    }
    throw new Error('DSH runtime exited before printing its Web URL')
  }
  try {
    const url = await Promise.race([
      readLine(),
      new Promise<never>((_resolve, reject) => child.once('error', reject)),
      new Promise<never>((_resolve, reject) => child.once('exit', code => reject(new Error(`DSH runtime exited during startup (code ${String(code)})`)))),
    ])
    settled = true
    clearTimeout(timeout)
    return {
      url: url as string,
      stop: async () => terminateProcessTree(child),
    }
  } catch (error) {
    settled = true
    clearTimeout(timeout)
    await terminateProcessTree(child).catch(() => undefined)
    throw error
  }
}

/**
 * Resolve a per-user profile directory for the runtime.
 * @param userData - Electron application data directory.
 * @returns persistent directory passed to the runtime as `DSH_HOME`.
 */
export function defaultRuntimeHome(userData: string): string {
  return join(userData, 'dsh')
}
