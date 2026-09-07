/**
 * Force `windowsHide` on `child_process` so Harness descendants do not flash a console.
 */

/**
 * True when `value` is a spawn/exec options object rather than an argv array.
 * @param value - a candidate `args` or `options` argument.
 * @returns whether hide should be applied to this value as options.
 */
function isOptionsObject(value) {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Force `windowsHide` on spawn-like options unless the caller set it to false.
 * @param options - child_process options, or undefined when the caller omitted them.
 * @returns options with `windowsHide: true`, or the original object when it is already `false`.
 */
export function applyWindowsHide(options) {
  if (options === undefined || options === null) return { windowsHide: true }
  if (typeof options !== 'object') return options
  if (options.windowsHide === false) return options
  return { ...options, windowsHide: true }
}

/**
 * Wrap spawn/fork/execFileSync so the options object always passes through {@link applyWindowsHide}.
 * @param original - the original child_process method.
 * @returns a drop-in replacement that hides Windows consoles by default.
 */
function patchSpawnLike(original) {
  return function spawnLike(command, args, options) {
    if (isOptionsObject(args) && options === undefined) {
      return original.call(this, command, applyWindowsHide(args))
    }
    return original.call(this, command, args, applyWindowsHide(options))
  }
}

/**
 * Wrap `exec` so a callback in the options slot is not treated as options.
 * @param original - the original `child_process.exec`.
 * @returns a drop-in replacement that hides Windows consoles by default.
 */
function patchExec(original) {
  return function exec(command, options, callback) {
    if (typeof options === 'function') {
      return original.call(this, command, applyWindowsHide(undefined), options)
    }
    return original.call(this, command, applyWindowsHide(options), callback)
  }
}

/**
 * Wrap `execFile` overloads that mix argv arrays, options objects, and callbacks.
 * @param original - the original `child_process.execFile`.
 * @returns a drop-in replacement that hides Windows consoles by default.
 */
function patchExecFile(original) {
  return function execFile(file, args, options, callback) {
    if (typeof args === 'function') {
      return original.call(this, file, applyWindowsHide(undefined), args)
    }
    if (isOptionsObject(args)) {
      return original.call(this, file, applyWindowsHide(args), options)
    }
    if (typeof options === 'function') {
      return original.call(this, file, args, applyWindowsHide(undefined), options)
    }
    return original.call(this, file, args, applyWindowsHide(options), callback)
  }
}

/**
 * Patch child_process spawn methods so descendants inherit a hidden Windows console.
 * @param childProcess - the `node:child_process` module object to mutate.
 * @param syncBuiltinESMExports - Node's `syncBuiltinESMExports` so ESM named exports match.
 * @returns after the methods are wrapped and ESM exports are synced.
 */
export function enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports) {
  childProcess.spawn = patchSpawnLike(childProcess.spawn)
  childProcess.spawnSync = patchSpawnLike(childProcess.spawnSync)
  childProcess.exec = patchExec(childProcess.exec)
  childProcess.execFile = patchExecFile(childProcess.execFile)
  childProcess.execFileSync = patchSpawnLike(childProcess.execFileSync)
  childProcess.fork = patchSpawnLike(childProcess.fork)
  syncBuiltinESMExports()
}
