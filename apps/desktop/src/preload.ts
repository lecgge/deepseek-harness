import { contextBridge, ipcRenderer } from 'electron'

declare global {
  interface Window {
    dshDesktop?: {
      onStatus(callback: (message: string) => void): () => void
    }
  }
}

contextBridge.exposeInMainWorld('dshDesktop', {
  onStatus(callback: (message: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('desktop-status', listener)
    return () => ipcRenderer.removeListener('desktop-status', listener)
  },
})
