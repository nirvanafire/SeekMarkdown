import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  CloseDecision,
  MenuCommand,
  OpenedFile,
  SaveResult,
  SeerMarkdownApi
} from '../shared/contracts'

const api: SeerMarkdownApi = {
  openFile: () => ipcRenderer.invoke('file:open'),
  openDroppedFile: (file) => {
    const path = webUtils.getPathForFile(file)
    return path ? ipcRenderer.invoke('file:open-path', path) : Promise.resolve(null)
  },
  saveFile: (path, content) => ipcRenderer.invoke('file:save', { path, content }),
  saveFileAs: (content, suggestedName) =>
    ipcRenderer.invoke('file:save-as', { content, suggestedName }),
  setDirty: (dirty) => ipcRenderer.send('document:set-dirty', dirty),
  requestClose: () => ipcRenderer.invoke('window:request-close'),
  completeClose: (decision: CloseDecision) => ipcRenderer.send('window:close-resolved', decision),
  onInitialFile: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, file: OpenedFile) => listener(file)
    ipcRenderer.on('app:initial-file', handler)
    return () => ipcRenderer.removeListener('app:initial-file', handler)
  },
  onMenuCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.removeListener('menu:command', handler)
  },
  onCloseRequested: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('app:close-requested', handler)
    return () => ipcRenderer.removeListener('app:close-requested', handler)
  }
}

contextBridge.exposeInMainWorld('seerMarkdown', api)

export type { OpenedFile, SaveResult, SeerMarkdownApi }
