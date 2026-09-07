import { spawn } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { childEnvironment, resolveShellEnvironment } from './environment.js'
import { terminateProcessTree } from './process-tree.js'
import { parseStartupUrl } from './startup-url.js'

/** Milliseconds allowed for the child to print and answer its Web URL. */
export const STARTUP_TIMEOUT_MS = 60_000

/** Running DSH child and the authenticated loopback URL it printed. */
export interface RuntimeHandle {
  readonly url: string
  /**
   * Terminate the spawned runtime process tree.
   * @returns resolves after the owned process tree exits.
   */
  stop(): Promise<void>
}

/** Spawn settings for the bundled Node + DSH web entry. */
export interface RuntimeOptions {
  readonly executable: string
  readonly entryWrapper: string
  readonly binJs: string
  readonly home: string
  readonly launchRoot: string
  readonly logPath: string
  readonly timeoutMs?: number
  readonly env?: NodeJS.ProcessEnv
  readonly probe?: (url: string) => Promise<void>
  readonly spawnImpl?: typeof spawn
}

/**
 * Probe a printed Web URL with a non-following GET.
 * @param url - authenticated loopback URL printed by `dsh web`.
 * @returns resolves when the status is 200–399.
 */
async function defaultProbe(url: string): Promise<void> {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`DSH runtime probe failed with status ${String(response.status)}`)
  }
}

/**
 * Append stream chunks to the harness log and deliver complete lines.
 * @param stream - child stdout or stderr.
 * @param logPath - file that receives raw stdout/stderr bytes as text.
 * @param onLine - complete-line callback; also invoked for a trailing partial line.
 * @returns resolves when the stream ends.
 */
async function consumeOutput(
  stream: AsyncIterable<unknown> | null | undefined,
  logPath: string,
  onLine: (line: string) => void,
): Promise<void> {
  if (stream === null || stream === undefined) return
  let buffer = ''
  for await (const chunk of stream) {
    const text = String(chunk)
    await appendFile(logPath, text)
    buffer += text
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }
  if (buffer !== '') onLine(buffer)
}

/**
 * Start the standalone DSH runtime and await its authenticated Web URL.
 * @param options - bundled Node executable, wrapper/entry paths, per-user directories, and startup settings.
 * @returns the tokenized Web URL and an idempotent runtime shutdown operation.
 */
export async function startRuntime(options: RuntimeOptions): Promise<RuntimeHandle> {
  await mkdir(options.home, { recursive: true })
  await mkdir(options.launchRoot, { recursive: true })
  const spawnImpl = options.spawnImpl ?? spawn
  const child = spawnImpl(options.executable, [
    options.entryWrapper,
    options.binJs,
    'web',
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: options.launchRoot,
    env: childEnvironment(options.env ?? resolveShellEnvironment(), { DSH_HOME: options.home }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stop = async (): Promise<void> => {
    await terminateProcessTree(child)
  }
  let settled = false
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const finish = (error: unknown, value?: string): void => {
        if (settled) return
        settled = true
        if (error !== undefined) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
        resolve(value as string)
      }
      const timeout = setTimeout(() => {
        finish(new Error('DSH runtime startup timed out'))
      }, options.timeoutMs ?? STARTUP_TIMEOUT_MS)
      const settle = (error: unknown, value?: string): void => {
        clearTimeout(timeout)
        finish(error, value)
      }
      child.once('error', error => settle(error))
      child.once('exit', code => settle(new Error(`DSH runtime exited during startup (code ${String(code)})`)))
      void consumeOutput(child.stdout, options.logPath, (line) => {
        try {
          const parsed = parseStartupUrl(line)
          if (parsed !== undefined) settle(undefined, parsed)
        } catch (error) {
          settle(error)
        }
      }).then(() => {
        settle(new Error('DSH runtime exited before printing its Web URL'))
      }, (error: unknown) => settle(error))
      void consumeOutput(child.stderr, options.logPath, () => undefined).catch((error: unknown) => {
        settle(error)
      })
    })
    await (options.probe ?? defaultProbe)(url)
    return { url, stop }
  } catch (error) {
    try {
      await stop()
    } catch {
      // Shutdown after a failed start is best-effort; the child may already be gone.
    }
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

/**
 * Resolve the child working directory so the runtime does not lock the install tree.
 * @param userData - Electron application data directory.
 * @returns directory used as `cwd` for the bundled Node spawn.
 */
export function defaultLaunchRoot(userData: string): string {
  return join(userData, 'launch-root')
}
