import { app, BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultLaunchRoot, defaultRuntimeHome, startRuntime, type RuntimeHandle } from './runtime.js'
import { resolveDesktopRuntimePaths } from './runtime-paths.js'

let runtime: RuntimeHandle | undefined
let windowRef: BrowserWindow | undefined
let activeOrigin: string | undefined
let stopping: Promise<void> | undefined

function createWindow(): BrowserWindow {
  const result = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), 'lib', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  result.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  result.webContents.on('will-navigate', (event, url) => {
    if (activeOrigin === undefined || new URL(url).origin !== activeOrigin) event.preventDefault()
  })
  result.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  result.webContents.session.on('will-download', (_event, item) => item.cancel())
  result.webContents.on('did-fail-load', (_event, code, description) => {
    result.webContents.send('desktop-status', `DSH Web failed to load (${String(code)}): ${description}`)
  })
  result.once('ready-to-show', () => result.show())
  result.on('closed', () => { windowRef = undefined })
  return result
}

async function stopRuntime(): Promise<void> {
  if (stopping !== undefined) return stopping
  const current = runtime
  runtime = undefined
  if (current === undefined) return
  stopping = current.stop().finally(() => { stopping = undefined })
  return stopping
}

async function boot(): Promise<void> {
  windowRef = createWindow()
  const status = (message: string) => windowRef?.webContents.send('desktop-status', message)
  try {
    await windowRef.loadFile(join(app.getAppPath(), 'lib', 'renderer', 'index.html'))
    status('Starting DSH Web…')
    const userData = app.getPath('userData')
    const launchRoot = defaultLaunchRoot(userData)
    await mkdir(launchRoot, { recursive: true })
    const paths = resolveDesktopRuntimePaths({
      configuredRoot: process.env.DSH_RUNTIME_PATH,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      exists: existsSync,
    })
    runtime = await startRuntime({
      executable: paths.executable,
      entryWrapper: paths.entryWrapper,
      binJs: paths.binJs,
      home: defaultRuntimeHome(userData),
      launchRoot,
      logPath: join(app.getPath('logs'), 'harness.log'),
    })
    activeOrigin = new URL(runtime.url).origin
    status('Loading DSH Web…')
    await windowRef.loadURL(runtime.url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    status(`Unable to start DSH Web: ${message}`)
    await dialog.showMessageBox(windowRef, { type: 'error', title: 'DeepSeek Harness', message })
    await stopRuntime()
    app.quit()
  }
}

async function shutdown(): Promise<void> {
  await stopRuntime()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => windowRef?.show())
  app.whenReady().then(boot).catch((error) => {
    console.error(error)
    app.quit()
  })
  app.on('before-quit', (event) => {
    if (stopping !== undefined) {
      event.preventDefault()
      void stopping.then(() => app.quit())
      return
    }
    if (runtime !== undefined) {
      event.preventDefault()
      void shutdown().then(() => app.quit())
    }
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('will-quit', () => { void stopRuntime() })
}
