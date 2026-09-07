import { execFileSync } from 'node:child_process'

let resolvedShellEnvironment: NodeJS.ProcessEnv | undefined

/**
 * Drop `ELECTRON_RUN_AS_NODE` so a bundled Node child does not inherit Electron node-mode.
 * @param environment - parent process environment to copy.
 * @returns a new env object without `ELECTRON_RUN_AS_NODE`.
 */
export function stripElectronNodeMode(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...rest } = environment
  return rest
}

/**
 * Read PATH with Windows case-insensitive lookup; POSIX reads `PATH` exactly.
 * @param environment - env object whose PATH key casing may vary on Windows.
 * @param platform - platform that decides case sensitivity; defaults to `process.platform`.
 * @returns the PATH value, or an empty string when absent.
 */
export function resolveEnvironmentPath(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return environment.PATH ?? ''
  const direct = environment.Path ?? environment.PATH
  if (direct !== undefined) return direct
  for (const [name, value] of Object.entries(environment)) {
    if (/^path$/iu.test(name) && value !== undefined) return value
  }
  return ''
}

/**
 * Parse shell `NAME=VALUE` lines into an env object.
 * @param output - raw stdout from `env` or PowerShell `Get-ChildItem Env:`.
 * @param lineSeparator - line split regex (`/\n/` or `/\r?\n/`).
 * @returns env entries for lines that contain a non-empty name before `=`.
 */
export function parseEnvOutput(output: string, lineSeparator: RegExp): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const line of output.split(lineSeparator)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    env[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return env
}

/**
 * Replace captured values that contain U+FFFD with the inherited value, or drop them.
 * @param captured - environment reported by a shell whose stdout may mis-decode.
 * @param inherited - this process's own environment used as fallback.
 * @returns captured entries with undecodable values repaired or removed.
 */
export function withoutUndecodableValues(
  captured: NodeJS.ProcessEnv,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(captured)) {
    if (value === undefined || !value.includes('\uFFFD')) {
      result[name] = value
      continue
    }
    const fallback = inherited[name]
    if (fallback !== undefined) result[name] = fallback
  }
  return result
}

/**
 * Capture the user shell profile environment, or fall back to `process.env`.
 * @returns memoized env for Harness spawn; never throws.
 */
export function resolveShellEnvironment(): NodeJS.ProcessEnv {
  if (resolvedShellEnvironment !== undefined) return resolvedShellEnvironment

  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell',
        [
          '-NoLogo',
          '-NonInteractive',
          '-OutputFormat',
          'Text',
          '-Command',
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
          + '. $PROFILE 2>$null; Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }',
        ],
        {
          encoding: 'utf8',
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        },
      )
      resolvedShellEnvironment = withoutUndecodableValues(
        parseEnvOutput(output, /\r?\n/),
        process.env,
      )
    } else {
      const shell = process.env.SHELL ?? '/bin/sh'
      const output = execFileSync(shell, ['-l', '-i', '-c', 'env'], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      resolvedShellEnvironment = parseEnvOutput(output, /\n/)
    }
  } catch {
    // Shell capture failed — keep the inherited process environment.
    resolvedShellEnvironment = process.env
  }

  return resolvedShellEnvironment
}

/**
 * Build the sanitized env passed to the Harness Node spawn.
 * @param parent - captured-or-inherited env (not renderer-visible).
 * @param extras - per-user `DSH_HOME` directory for the child.
 * @returns spawn env with `ELECTRON_RUN_AS_NODE` removed, `DSH_HOME` set, and a single case-correct Path/PATH.
 */
export function childEnvironment(
  parent: NodeJS.ProcessEnv,
  extras: { DSH_HOME: string },
): NodeJS.ProcessEnv {
  const stripped = stripElectronNodeMode(parent)
  const pathValue = resolveEnvironmentPath(stripped)
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(stripped)) {
    if (/^path$/iu.test(name) || name === 'DSH_HOME') continue
    env[name] = value
  }
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = pathValue
  env.DSH_HOME = extras.DSH_HOME
  return env
}
