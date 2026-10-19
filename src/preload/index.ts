import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  CloseDecision,
  MenuCommand,
  FileInfo,
  InsertedImage,
  OpenedFile,
  SaveResult,
  SeerMarkdownApi
} from '../shared/contracts'

const api: SeerMarkdownApi = {
  openFile: () => ipcRenderer.invoke('file:open'),
  getFileInfo: (file) => ({
    path: webUtils.getPathForFile(file),
    name: file.name
  }),
  selectFiles: (): Promise<FileInfo[]> => ipcRenderer.invoke('file:select'),
  openDroppedFile: (file) => {
    const path = webUtils.getPathForFile(file)
    return path ? ipcRenderer.invoke('file:open-path', path) : Promise.resolve(null)
  },
  openFileByPath: (path) => ipcRenderer.invoke('file:open-path', path),
  saveFile: (path, content) => ipcRenderer.invoke('file:save', { path, content }),
  saveFileAs: (content, suggestedName) =>
    ipcRenderer.invoke('file:save-as', { content, suggestedName }),
  selectImage: (documentPath): Promise<InsertedImage | null> =>
    ipcRenderer.invoke('image:select', documentPath),
  readLocalImage: (documentPath, relativePath): Promise<string | null> =>
    ipcRenderer.invoke('image:read-local', documentPath, relativePath),
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
