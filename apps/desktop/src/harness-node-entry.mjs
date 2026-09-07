/**
 * Bundled-Node entry that hides Windows consoles, then loads the DSH `bin.js` CLI.
 *
 * Argv: `node harness-node-entry.mjs <dshEntryPath> ...dshArguments`.
 * This host uses bundled Node, not an Electron utility process — do not set `ELECTRON_RUN_AS_NODE`.
 */

import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { enforceWindowsChildProcessHide } from './windows-child-process-hide.mjs'
import { createHiddenConsole } from './windows-hidden-console.mjs'

console.log(`runtime node=${process.versions.node}`)
console.log(`execPath=${process.execPath}`)
console.log(`cwd=${process.cwd()}`)
console.log(`DSH_HOME=${process.env.DSH_HOME ?? ''}`)

if (process.platform === 'win32') {
  createHiddenConsole({})
  enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports)
}

const dshEntryPath = process.argv[2]
if (dshEntryPath === undefined || dshEntryPath === '') {
  console.error('missing DSH entry path')
  process.exit(1)
}

process.argv = [process.execPath, dshEntryPath, ...process.argv.slice(3)]

try {
  await import(pathToFileURL(dshEntryPath).href)
} catch (error) {
  console.error('DSH entry failed:', error)
  process.exit(1)
}
