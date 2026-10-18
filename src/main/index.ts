import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import type {
  CloseDecision,
  MenuCommand,
  OpenedFile,
  SaveResult
} from '../shared/contracts'

const currentDir = dirname(fileURLToPath(import.meta.url))
const markdownExtensions = new Set(['.md', '.markdown', '.mdown'])

interface CloseState {
  waiting: boolean
  forceClose: boolean
}

const closeStates = new WeakMap<BrowserWindow, CloseState>()

function getCloseState(window: BrowserWindow): CloseState {
  let state = closeStates.get(window)
  if (!state) {
    state = { waiting: false, forceClose: false }
    closeStates.set(window, state)
  }
  return state
}

function isMarkdownPath(value: string): boolean {
  return markdownExtensions.has(extname(value).toLowerCase())
}

function getInitialFilePath(): string | undefined {
  return process.argv.slice(1).find((value) => {
    return !value.startsWith('-') && isAbsolute(value) && isMarkdownPath(value)
  })
}

function assertFilePayload(value: unknown): asserts value is { path: string; content: string } {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { path?: unknown }).path !== 'string' ||
    typeof (value as { content?: unknown }).content !== 'string' ||
    !isAbsolute((value as { path: string }).path)
  ) {
    throw new Error('文件参数无效')
  }
}

async function readOpenedFile(path: string): Promise<OpenedFile> {
  const content = await fs.readFile(path, 'utf8')
  return { path, name: basename(path), content }
}

async function openMarkdownFile(window: BrowserWindow): Promise<OpenedFile | null> {
  const result = await dialog.showOpenDialog(window, {
    title: '打开 Markdown 文件',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return readOpenedFile(result.filePaths[0])
}

function withMarkdownExtension(path: string): string {
  return extname(path) ? path : `${path}.md`
}

async function saveMarkdownFileAs(
  window: BrowserWindow,
  content: string,
  suggestedName: string
): Promise<OpenedFile | null> {
  const result = await dialog.showSaveDialog(window, {
    title: '另存为 Markdown 文件',
    defaultPath: suggestedName,
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  const targetPath = withMarkdownExtension(result.filePath)
  await fs.writeFile(targetPath, content, 'utf8')
  return { path: targetPath, name: basename(targetPath), content }
}

function isExternalWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      if (isExternalWebUrl(url)) {
        void shell.openExternal(url)
      }
    }
  })
}

function sendMenuCommand(target: WebContents, command: MenuCommand): void {
  target.send('menu:command', command)
}

function createApplicationMenu(): void {
  const sendToFocused = (command: MenuCommand) => {
    const window = BrowserWindow.getFocusedWindow()
    if (window) {
      sendMenuCommand(window.webContents, command)
    }
  }

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('open')
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('save')
        },
        {
          label: '另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToFocused('save-as')
        },
        { type: 'separator' },
        {
          label: '关闭窗口',
          accelerator: 'CmdOrCtrl+W',
          click: () => BrowserWindow.getFocusedWindow()?.close()
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ role: 'quit' as const, label: '退出' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    { role: 'windowMenu', label: '窗口' },
    {
      label: '帮助',
      submenu: [
        {
          label: 'Markdown 语法帮助',
          click: () => {
            void shell.openExternal('https://commonmark.org/help/')
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpcHandlers(): void {
  ipcMain.handle('file:open', async (event): Promise<OpenedFile | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return null
    }
    return openMarkdownFile(window)
  })

  ipcMain.handle('file:open-path', async (_event, path: unknown): Promise<OpenedFile | null> => {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error('文件路径无效')
    }
    return readOpenedFile(path)
  })

  ipcMain.handle('file:save', async (event, payload: unknown): Promise<SaveResult> => {
    assertFilePayload(payload)
    await fs.writeFile(payload.path, payload.content, 'utf8')
    return { path: payload.path, name: basename(payload.path) }
  })

  ipcMain.handle('file:save-as', async (event, payload: unknown): Promise<OpenedFile | null> => {
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof (payload as { content?: unknown }).content !== 'string' ||
      typeof (payload as { suggestedName?: unknown }).suggestedName !== 'string'
    ) {
      throw new Error('保存参数无效')
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return null
    }

    const savePayload = payload as { content: string; suggestedName: string }
    return saveMarkdownFileAs(window, savePayload.content, savePayload.suggestedName)
  })

  ipcMain.on('document:set-dirty', () => {
    // Dirty state is handled by the renderer's close flow; the event keeps the
    // preload contract ready for native close guards in future versions.
  })

  ipcMain.handle('window:request-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.on('window:close-resolved', (event, decision: CloseDecision) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) {
      return
    }

    const state = getCloseState(window)
    if (!state.waiting) {
      return
    }

    state.waiting = false
    if (decision === 'saved' || decision === 'discard') {
      state.forceClose = true
      window.close()
    }
  })
}

function createWindow(initialFilePath?: string): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : {
            color: '#e7e4dc',
            symbolColor: '#26312c',
            height: 36
          },
    backgroundColor: '#f4f2ec',
    title: 'SeerMarkdown',
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  getCloseState(window)
  configureWindowSecurity(window)
  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(true)
  }

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.on('did-finish-load', () => {
    if (!initialFilePath) {
      return
    }

    void readOpenedFile(initialFilePath)
      .then((file) => {
        if (!window.isDestroyed()) {
          window.webContents.send('app:initial-file', file)
        }
      })
      .catch((error: unknown) => {
        if (!window.isDestroyed()) {
          dialog.showErrorBox('无法打开文件', error instanceof Error ? error.message : String(error))
        }
      })
  })

  window.on('close', (event) => {
    const state = getCloseState(window)
    if (state.forceClose) {
      return
    }

    event.preventDefault()
    if (!state.waiting) {
      state.waiting = true
      window.webContents.send('app:close-requested')
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  registerIpcHandlers()
  createApplicationMenu()

  const initialFilePath = getInitialFilePath()
  createWindow(initialFilePath)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
