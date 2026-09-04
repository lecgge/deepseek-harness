import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Terminate a process and every descendant owned by the desktop host.
 * @param child - direct runtime process spawned by the desktop host.
 * @returns resolves after the owned process tree exits.
 */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error
    }
    return
  }
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
  })
}
