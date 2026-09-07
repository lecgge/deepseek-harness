/**
 * Allocate a Windows console and hide its window so GUI-spawned Node has a console without flashing.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SW_HIDE = 0

/**
 * Load a DLL through `koffi` resolved from the staged sibling `node/` closure.
 * @param name - Win32 DLL name, such as `kernel32.dll`.
 * @returns the koffi library object for `name`.
 */
function loadFromStagedClosure(name) {
  const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), 'node', 'package.json'))
  const koffi = require('koffi')
  return koffi.load(name)
}

/**
 * Allocate a console and hide its window. Failures are best-effort and never throw.
 * @param options - injectable `koffi.load`; omitted load uses koffi from the sibling `node/` closure.
 * @returns true when the hide calls completed; false when load or Win32 calls fail.
 */
export function createHiddenConsole({ load } = {}) {
  try {
    const loadLibrary = load ?? loadFromStagedClosure
    const kernel32 = loadLibrary('kernel32.dll')
    const user32 = loadLibrary('user32.dll')
    const AllocConsole = kernel32.func('__stdcall', 'AllocConsole', 'int', [])
    const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', [])
    const ShowWindow = user32.func('__stdcall', 'ShowWindow', 'int', ['void *', 'int'])
    AllocConsole()
    const hwnd = GetConsoleWindow()
    if (hwnd) ShowWindow(hwnd, SW_HIDE)
    return true
  } catch {
    // koffi missing from the staged closure, or a Win32 bind/call failed.
    return false
  }
}
