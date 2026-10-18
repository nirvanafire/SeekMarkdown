import {
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  Columns2,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  History,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  ListVideo,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  SquareCode,
  Table2,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import CodeEditor, { type CodeEditorHandle } from './components/CodeEditor'
import Preview from './components/Preview'
import {
  NeuButton,
  NeuIconButton,
  NeuPanel,
  NeuStatus,
  NeuToggle
} from './components/neumorphic'
import type { EditorAction } from './editor/markdownCommands'
import type { FileInfo, OpenedFile } from '../../shared/contracts'

type SavePhase = 'idle' | 'saving'
type PromptKind = 'open' | 'close'
type PromptChoice = 'save' | 'discard' | 'cancel'
type NoticeTone = 'neutral' | 'success' | 'error'

interface Notice {
  text: string
  tone: NoticeTone
}

interface FileHistoryEntry {
  path: string
  name: string
  openedAt: number
}

type PendingOpen =
  | { kind: 'dialog' }
  | { kind: 'path'; path: string }
  | { kind: 'drop'; file: File }

const historyStorageKey = 'seermarkdown.file-history'
const historyLimit = 20
const readingListStorageKey = 'seermarkdown.reading-list'

function mergeReadingList(current: FileInfo[], additions: FileInfo[]): FileInfo[] {
  const merged = [...current]
  const paths = new Set(current.map((item) => item.path))

  for (const item of additions) {
    if (!paths.has(item.path)) {
      merged.push(item)
      paths.add(item.path)
    }
  }

  return merged
}

function readReadingList(): FileInfo[] {
  try {
    const raw = window.localStorage.getItem(readingListStorageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) {
      return []
    }

    const items = parsed.filter((item): item is FileInfo => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as FileInfo).path === 'string' &&
        typeof (item as FileInfo).name === 'string'
      )
    })
    return mergeReadingList([], items)
  } catch {
    return []
  }
}

function readHistory(): FileHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(historyStorageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is FileHistoryEntry => {
        return (
          !!item &&
          typeof item === 'object' &&
          typeof (item as FileHistoryEntry).path === 'string' &&
          typeof (item as FileHistoryEntry).name === 'string' &&
          typeof (item as FileHistoryEntry).openedAt === 'number'
        )
      })
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, historyLimit)
  } catch {
    return []
  }
}

function formatHistoryTime(openedAt: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(openedAt))
}

function countVisibleCharacters(value: string): number {
  return Array.from(value.replace(/\s/g, '')).length
}

function getErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export default function App(): JSX.Element {
  const [file, setFile] = useState<OpenedFile | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [savePhase, setSavePhase] = useState<SavePhase>('idle')
  const [prompt, setPrompt] = useState<PromptKind | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [splitPercent, setSplitPercent] = useState(50)
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [previewOnly, setPreviewOnly] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)
  const [history, setHistory] = useState<FileHistoryEntry[]>(readHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [readingList, setReadingList] = useState<FileInfo[]>(readReadingList)
  const [readingListOpen, setReadingListOpen] = useState(false)
  const [readingListDragActive, setReadingListDragActive] = useState(false)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const draggingSplitRef = useRef(false)
  const pendingOpenRef = useRef<PendingOpen | null>(null)
  const dragDepthRef = useRef(0)
  const readingListDragDepthRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  const dirty = useMemo(() => content !== savedContent, [content, savedContent])
  const characterCount = useMemo(() => countVisibleCharacters(content), [content])

  const rememberFile = useCallback((nextFile: OpenedFile) => {
    const entry: FileHistoryEntry = {
      path: nextFile.path,
      name: nextFile.name,
      openedAt: Date.now()
    }
    setHistory((current) => [
      entry,
      ...current.filter((item) => item.path !== entry.path)
    ].slice(0, historyLimit))
  }, [])

  const showNotice = useCallback((text: string, tone: NoticeTone = 'neutral') => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current)
    }

    setNotice({ text, tone })
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, 2600)
  }, [])

  const loadFile = useCallback((nextFile: OpenedFile) => {
    pendingOpenRef.current = null
    rememberFile(nextFile)
    setFile(nextFile)
    setContent(nextFile.content)
    setSavedContent(nextFile.content)
    setPrompt(null)
    showNotice(`已打开 ${nextFile.name}`)
  }, [rememberFile, showNotice])

  const performOpen = useCallback(async () => {
    try {
      const nextFile = await window.seerMarkdown.openFile()
      if (nextFile) {
        loadFile(nextFile)
      }
    } catch (error) {
      showNotice(getErrorMessage(error), 'error')
    }
  }, [loadFile, showNotice])

  const openDroppedFile = useCallback(
    async (droppedFile: File) => {
      try {
        const nextFile = await window.seerMarkdown.openDroppedFile(droppedFile)
        if (nextFile) {
          loadFile(nextFile)
        }
      } catch (error) {
        showNotice(getErrorMessage(error), 'error')
      }
    },
    [loadFile, showNotice]
  )

  const openFileByPath = useCallback(
    async (path: string) => {
      try {
        const nextFile = await window.seerMarkdown.openFileByPath(path)
        if (nextFile) {
          loadFile(nextFile)
        }
      } catch (error) {
        showNotice(getErrorMessage(error), 'error')
      }
    },
    [loadFile, showNotice]
  )

  const continuePendingOpen = useCallback(async () => {
    const pending = pendingOpenRef.current
    pendingOpenRef.current = null

    if (pending?.kind === 'drop') {
      await openDroppedFile(pending.file)
    } else if (pending?.kind === 'path') {
      await openFileByPath(pending.path)
    } else {
      await performOpen()
    }
  }, [openDroppedFile, openFileByPath, performOpen])

  const saveFileAs = useCallback(async (): Promise<boolean> => {
    const contentToSave = content
    setSavePhase('saving')

    try {
      const savedFile = await window.seerMarkdown.saveFileAs(
        contentToSave,
        file?.name ?? '未命名.md'
      )
      if (!savedFile) {
        setSavePhase('idle')
        return false
      }

      setFile(savedFile)
      rememberFile(savedFile)
      setSavedContent(contentToSave)
      setSavePhase('idle')
      showNotice(`已保存到 ${savedFile.name}`, 'success')
      return true
    } catch (error) {
      setSavePhase('idle')
      showNotice(getErrorMessage(error), 'error')
      return false
    }
  }, [content, file?.name, rememberFile, showNotice])

  const persistCurrent = useCallback(async (): Promise<boolean> => {
    if (!file) {
      return saveFileAs()
    }

    const contentToSave = content
    setSavePhase('saving')

    try {
      const result = await window.seerMarkdown.saveFile(file.path, contentToSave)
      setFile({ ...file, path: result.path, name: result.name })
      setSavedContent(contentToSave)
      setSavePhase('idle')
      showNotice(`已保存 ${result.name}`, 'success')
      return true
    } catch (error) {
      setSavePhase('idle')
      showNotice(getErrorMessage(error), 'error')
      return false
    }
  }, [content, file, saveFileAs, showNotice])

  const requestOpen = useCallback(() => {
    pendingOpenRef.current = { kind: 'dialog' }
    if (dirty) {
      setPrompt('open')
      return
    }
    pendingOpenRef.current = null
    void performOpen()
  }, [dirty, performOpen])

  const requestDroppedFile = useCallback(
    (droppedFile: File) => {
      if (dirty) {
        pendingOpenRef.current = { kind: 'drop', file: droppedFile }
        setPrompt('open')
        return
      }
      pendingOpenRef.current = null
      void openDroppedFile(droppedFile)
    },
    [dirty, openDroppedFile]
  )

  const requestFileOpen = useCallback(
    (path: string) => {
      if (dirty) {
        pendingOpenRef.current = { kind: 'path', path }
        setPrompt('open')
        return
      }
      pendingOpenRef.current = null
      void openFileByPath(path)
    },
    [dirty, openFileByPath]
  )

  const requestHistoryFile = useCallback(
    (path: string) => {
      setHistoryOpen(false)
      requestFileOpen(path)
    },
    [requestFileOpen]
  )

  const requestReadingFile = useCallback(
    (path: string) => {
      requestFileOpen(path)
    },
    [requestFileOpen]
  )

  const addReadingFiles = useCallback(async () => {
    try {
      const selectedFiles = await window.seerMarkdown.selectFiles()
      if (selectedFiles.length === 0) {
        return
      }

      setReadingList((current) => mergeReadingList(current, selectedFiles))
      requestReadingFile(selectedFiles[0].path)
    } catch (error) {
      showNotice(getErrorMessage(error), 'error')
    }
  }, [requestReadingFile, showNotice])

  const addDroppedReadingFiles = useCallback(
    (droppedFiles: File[]) => {
      try {
        const selectedFiles = droppedFiles
          .map((file) => window.seerMarkdown.getFileInfo(file))
          .filter((file) => file.path)

        if (selectedFiles.length === 0) {
          showNotice('无法读取拖入的文件位置', 'error')
          return
        }

        setReadingList((current) => mergeReadingList(current, selectedFiles))
        showNotice(`已添加 ${selectedFiles.length} 个文件到阅读列表`, 'success')
      } catch (error) {
        showNotice(getErrorMessage(error), 'error')
      }
    },
    [showNotice]
  )

  const requestSave = useCallback(() => {
    void persistCurrent()
  }, [persistCurrent])

  const requestSaveAs = useCallback(() => {
    void saveFileAs()
  }, [saveFileAs])

  const handlePromptChoice = useCallback(
    async (choice: PromptChoice) => {
      const activePrompt = prompt
      if (!activePrompt || choice === 'cancel') {
        pendingOpenRef.current = null
        setPrompt(null)
        if (activePrompt === 'close') {
          window.seerMarkdown.completeClose('cancelled')
        }
        return
      }

      const pending = pendingOpenRef.current

      if (choice === 'save') {
        const saved = await persistCurrent()
        if (!saved) {
          pendingOpenRef.current = pending
          return
        }

        setPrompt(null)
        if (activePrompt === 'close') {
          pendingOpenRef.current = null
          window.seerMarkdown.completeClose('saved')
        } else {
          await continuePendingOpen()
        }
        return
      }

      setPrompt(null)
      if (activePrompt === 'close') {
        pendingOpenRef.current = null
        window.seerMarkdown.completeClose('discard')
      } else {
        await continuePendingOpen()
      }
    },
    [continuePendingOpen, prompt, persistCurrent]
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(history))
    } catch {
      // History remains available for this session when storage is unavailable.
    }
  }, [history])

  useEffect(() => {
    try {
      window.localStorage.setItem(readingListStorageKey, JSON.stringify(readingList))
    } catch {
      // Reading list remains available for this session when storage is unavailable.
    }
  }, [readingList])

  useEffect(() => {
    window.seerMarkdown.setDirty(dirty)
  }, [dirty])

  useEffect(() => {
    return window.seerMarkdown.onInitialFile(loadFile)
  }, [loadFile])

  useEffect(() => {
    return window.seerMarkdown.onMenuCommand((command) => {
      if (command === 'open') {
        requestOpen()
      } else if (command === 'save') {
        requestSave()
      } else {
        requestSaveAs()
      }
    })
  }, [requestOpen, requestSave, requestSaveAs])

  useEffect(() => {
    return window.seerMarkdown.onCloseRequested(() => {
      if (dirty) {
        setPrompt('close')
      } else {
        window.seerMarkdown.completeClose('discard')
      }
    })
  }, [dirty])

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  const executeEditorAction = useCallback((action: EditorAction) => {
    editorRef.current?.execute(action)
  }, [])

  const handleSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingSplitRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current
    if (!draggingSplitRef.current || !workspace) {
      return
    }

    const bounds = workspace.getBoundingClientRect()
    const next = ((event.clientX - bounds.left) / bounds.width) * 100
    setSplitPercent(Math.min(72, Math.max(28, next)))
  }

  const handleSplitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingSplitRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const hasDraggedFiles = (event: ReactDragEvent<HTMLElement>): boolean => {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  const handleFileDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    dragDepthRef.current += 1
    setFileDragActive(true)
  }

  const handleFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleFileDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setFileDragActive(false)
    }
  }

  const handleReadingListDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    readingListDragDepthRef.current += 1
    setReadingListDragActive(true)
  }

  const handleReadingListDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleReadingListDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.stopPropagation()
    readingListDragDepthRef.current = Math.max(0, readingListDragDepthRef.current - 1)
    if (readingListDragDepthRef.current === 0) {
      setReadingListDragActive(false)
    }
  }

  const handleReadingListDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    readingListDragDepthRef.current = 0
    setReadingListDragActive(false)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length === 0) {
      showNotice('未检测到可添加的文件', 'error')
      return
    }
    addDroppedReadingFiles(droppedFiles)
  }

  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    dragDepthRef.current = 0
    setFileDragActive(false)

    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length !== 1) {
      showNotice('一次只能拖入一个文件', 'error')
      return
    }
    requestDroppedFile(droppedFiles[0])
  }

  const statusLabel = savePhase === 'saving' ? '正在保存' : dirty ? '未保存' : file ? '已保存' : '就绪'
  const statusTone = savePhase === 'saving' ? 'saving' : dirty ? 'dirty' : file ? 'saved' : 'idle'
  const formatDisabled = false
  const showSource = !previewOnly
  const showPreview = previewEnabled || previewOnly
  const splitView = showSource && showPreview
  const activeReadingIndex = file
    ? readingList.findIndex((item) => item.path === file.path)
    : -1
  const previousReadingItem = activeReadingIndex > 0 ? readingList[activeReadingIndex - 1] : null
  const nextReadingItem =
    activeReadingIndex >= 0 && activeReadingIndex < readingList.length - 1
      ? readingList[activeReadingIndex + 1]
      : null

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <div className="window-drag-region" aria-hidden="true" />

      <NeuPanel
        as="aside"
        surface="raised"
        className={`sidebar ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}
        aria-label="文档控制台"
      >
        <div className="sidebar-brand" aria-label="SeerMarkdown">
          <span className="brand-mark">S/M</span>
          {!sidebarCollapsed && (
            <span className="brand-name">
              Seer<span>Md</span>
            </span>
          )}
          <NeuIconButton
            className="sidebar-toggle-button"
            label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </NeuIconButton>
        </div>

        {!sidebarCollapsed && (
          <NeuPanel surface="inset" className="sidebar-document">
            <FileText aria-hidden="true" />
            <div className="document-copy">
              <strong>{file?.name ?? '未打开文件'}</strong>
              <span title={file?.path ?? ''}>{file?.path ?? '本地 Markdown 文档'}</span>
            </div>
          </NeuPanel>
        )}

        <section className="sidebar-section" aria-labelledby="file-tools-title">
          <h2 id="file-tools-title">文件</h2>
          <div className="sidebar-actions" role="toolbar" aria-label="文件操作">
            <NeuIconButton label="打开 Markdown 文件" title="打开 Markdown 文件" onClick={requestOpen}>
              <FolderOpen aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="保存" title="保存" onClick={requestSave}>
              <Save aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="另存为" title="另存为" onClick={requestSaveAs}>
              <FileDown aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="打开历史记录" title="打开历史记录" onClick={() => setHistoryOpen(true)}>
              <History aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              label="打开阅读列表"
              title="打开阅读列表"
              onClick={() => setReadingListOpen(true)}
            >
              <ListVideo aria-hidden="true" />
            </NeuIconButton>
          </div>
        </section>

        <section className="sidebar-section" aria-labelledby="view-tools-title">
          <h2 id="view-tools-title">视图</h2>
          <NeuToggle
            checked={previewEnabled}
            onCheckedChange={setPreviewEnabled}
            label="实时预览"
            description={previewOnly ? '预览模式' : previewEnabled ? '分栏显示' : '专注编辑'}
          />
          <NeuButton
            variant={previewOnly ? 'primary' : 'secondary'}
            size="sm"
            className="sidebar-wide-button"
            title={previewOnly ? '退出预览' : '预览模式'}
            aria-label={previewOnly ? '退出预览' : '预览模式'}
            pressed={previewOnly}
            onClick={() => setPreviewOnly((value) => !value)}
          >
            <Eye aria-hidden="true" />
            {previewOnly ? '退出预览' : '预览模式'}
          </NeuButton>
          <NeuButton
            variant="secondary"
            size="sm"
            className="sidebar-wide-button"
            title="重置分栏"
            aria-label="重置分栏"
            disabled={!splitView}
            onClick={() => setSplitPercent(50)}
          >
            <Columns2 aria-hidden="true" />
            重置分栏
          </NeuButton>
        </section>

        {!sidebarCollapsed && (
        <section className="sidebar-section format-section" aria-labelledby="format-tools-title">
          <h2 id="format-tools-title">格式</h2>
          <div className="format-grid" role="toolbar" aria-label="Markdown 格式工具">
            <NeuIconButton
              className="format-control format-text-control"
              label="一级标题"
              title="一级标题"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('heading1')}
            >
              <span>H1</span>
            </NeuIconButton>
            <NeuIconButton
              className="format-control format-text-control"
              label="二级标题"
              title="二级标题"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('heading2')}
            >
              <span>H2</span>
            </NeuIconButton>
            <NeuIconButton
              className="format-control format-text-control"
              label="三级标题"
              title="三级标题"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('heading3')}
            >
              <span>H3</span>
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="粗体"
              title="粗体"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('bold')}
            >
              <Bold aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="斜体"
              title="斜体"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('italic')}
            >
              <Italic aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="行内代码"
              title="行内代码"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('inlineCode')}
            >
              <Code2 aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="插入链接"
              title="插入链接"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('link')}
            >
              <Link2 aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="无序列表"
              title="无序列表"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('bulletList')}
            >
              <List aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="有序列表"
              title="有序列表"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('orderedList')}
            >
              <ListOrdered aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="任务列表"
              title="任务列表"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('taskList')}
            >
              <ListTodo aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="引用"
              title="引用"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('quote')}
            >
              <Quote aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="代码块"
              title="代码块"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('codeBlock')}
            >
              <SquareCode aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="插入表格"
              title="插入表格"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('table')}
            >
              <Table2 aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="水平分隔线"
              title="水平分隔线"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('horizontalRule')}
            >
              <Minus aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="撤销"
              title="撤销"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('undo')}
            >
              <Undo2 aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              className="format-control"
              label="重做"
              title="重做"
              disabled={formatDisabled}
              onClick={() => executeEditorAction('redo')}
            >
              <Redo2 aria-hidden="true" />
            </NeuIconButton>
          </div>
        </section>
        )}

        <NeuPanel surface="inset" className="sidebar-status">
          {!sidebarCollapsed && (
            <div className="sidebar-status-heading">
              <span>文档状态</span>
              <span>UTF-8</span>
            </div>
          )}
          <NeuStatus
            className={`dirty-indicator ${statusTone}`}
            tone={statusTone}
            label={statusLabel}
            compact={sidebarCollapsed}
          />
          {!sidebarCollapsed && (
            <div className="sidebar-metrics">
              <span>{characterCount} 字符</span>
              <span>{content.split(/\r?\n/).length} 行</span>
            </div>
          )}
        </NeuPanel>
      </NeuPanel>

      <main
        className={`workspace ${splitView ? '' : 'workspace--single-panel'}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: splitView
            ? `${splitPercent}fr 10px ${100 - splitPercent}fr`
            : 'minmax(0, 1fr)'
        }}
      >
        {showSource && (
        <NeuPanel
          as="section"
          surface="raised"
          className="editor-panel"
          aria-label="Markdown 编辑器"
        >
          <div className="panel-heading">
            <div>
              <span className="panel-index">01</span>
              <h2>源码</h2>
            </div>
            <span>Markdown</span>
          </div>
          <div className="panel-body">
            <CodeEditor ref={editorRef} value={content} onChange={setContent} />
          </div>
        </NeuPanel>
        )}

        {splitView && (
          <div
            className="split-handle"
            role="separator"
            aria-label="调整编辑器与预览宽度"
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitPercent)}
            aria-valuemin={28}
            aria-valuemax={72}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerUp}
            onPointerCancel={handleSplitPointerUp}
          >
            <i aria-hidden="true" />
          </div>
        )}

        {showPreview && (
          <NeuPanel
            as="section"
            surface="raised"
            className="preview-panel"
            aria-label="Markdown 预览"
          >
            <div className="panel-heading preview-heading">
              <div>
                <span className="panel-index">02</span>
                <h2>预览</h2>
              </div>
              <span>{file || content ? '实时渲染' : '等待内容'}</span>
            </div>
            <div className="panel-body preview-scroll">
              {content ? (
                <Preview content={content} />
              ) : (
                <div className="preview-empty">
                  <RefreshCw aria-hidden="true" />
                  <p>预览会随着源码输入即时更新</p>
                </div>
              )}
            </div>
          </NeuPanel>
        )}
      </main>

      {fileDragActive && (
        <div className="drop-overlay" role="status">
          <Upload aria-hidden="true" />
          <strong>松开以打开文件</strong>
          <span>一次只能打开一个文件</span>
        </div>
      )}

      {readingListOpen && (
        <div className="modal-backdrop">
          <NeuPanel
            as="section"
            surface="raised"
            className={`history-dialog reading-list-dialog ${readingListDragActive ? 'is-dragging' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-list-title"
            onDragEnter={handleReadingListDragEnter}
            onDragOver={handleReadingListDragOver}
            onDragLeave={handleReadingListDragLeave}
            onDrop={handleReadingListDrop}
          >
            {readingListDragActive && (
              <div className="reading-list-drop-overlay" role="status">
                <Upload aria-hidden="true" />
                <strong>松开以添加到阅读列表</strong>
                <span>可一次拖入多个文件</span>
              </div>
            )}
            <div className="history-heading">
              <div>
                <p className="eyebrow">READING LIST</p>
                <h2 id="reading-list-title">阅读列表</h2>
              </div>
              <NeuIconButton
                label="关闭阅读列表"
                title="关闭阅读列表"
                onClick={() => setReadingListOpen(false)}
              >
                <X aria-hidden="true" />
              </NeuIconButton>
            </div>

            <div className="reading-list-toolbar">
              <NeuButton variant="primary" size="sm" onClick={() => void addReadingFiles()}>
                <Plus aria-hidden="true" />
                添加文件
              </NeuButton>
              <div className="reading-list-navigation">
                <NeuButton
                  variant="secondary"
                  size="sm"
                  disabled={!previousReadingItem}
                  onClick={() => {
                    if (previousReadingItem) {
                      requestReadingFile(previousReadingItem.path)
                    }
                  }}
                >
                  <ChevronLeft aria-hidden="true" />
                  上一个
                </NeuButton>
                <NeuButton
                  variant="secondary"
                  size="sm"
                  disabled={!nextReadingItem}
                  onClick={() => {
                    if (nextReadingItem) {
                      requestReadingFile(nextReadingItem.path)
                    }
                  }}
                >
                  下一个
                  <ChevronRight aria-hidden="true" />
                </NeuButton>
              </div>
            </div>

            {readingList.length > 0 ? (
              <ol className="history-list reading-list">
                {readingList.map((entry, index) => {
                  const active = entry.path === file?.path
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`history-item reading-list-item ${active ? 'is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => requestReadingFile(entry.path)}
                      >
                        <span className="reading-list-index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <FileText aria-hidden="true" />
                        <span className="history-item-copy">
                          <strong>{entry.name}</strong>
                          <span title={entry.path}>{entry.path}</span>
                        </span>
                        {active && <span className="reading-list-current">当前</span>}
                      </button>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <div className="history-empty">
                <ListVideo aria-hidden="true" />
                <p>暂无阅读文件</p>
              </div>
            )}
          </NeuPanel>
        </div>
      )}

      {historyOpen && (
        <div className="modal-backdrop">
          <NeuPanel
            as="section"
            surface="raised"
            className="history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <div className="history-heading">
              <div>
                <p className="eyebrow">FILE HISTORY</p>
                <h2 id="history-title">打开历史</h2>
              </div>
              <NeuIconButton label="关闭历史记录" title="关闭历史记录" onClick={() => setHistoryOpen(false)}>
                <X aria-hidden="true" />
              </NeuIconButton>
            </div>
            {history.length > 0 ? (
              <ol className="history-list">
                {history.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="history-item"
                      onClick={() => requestHistoryFile(entry.path)}
                    >
                      <FileText aria-hidden="true" />
                      <span className="history-item-copy">
                        <strong>{entry.name}</strong>
                        <span title={entry.path}>{entry.path}</span>
                      </span>
                      <time dateTime={new Date(entry.openedAt).toISOString()}>
                        {formatHistoryTime(entry.openedAt)}
                      </time>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="history-empty">
                <History aria-hidden="true" />
                <p>暂无打开记录</p>
              </div>
            )}
          </NeuPanel>
        </div>
      )}

      {notice && (
        <NeuPanel surface="raised" className={`toast ${notice.tone}`} role="status">
          {notice.tone === 'error' ? <CircleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
          <span>{notice.text}</span>
          <NeuIconButton label="关闭提示" title="关闭提示" onClick={() => setNotice(null)}>
            <X aria-hidden="true" />
          </NeuIconButton>
        </NeuPanel>
      )}

      {prompt && (
        <div className="modal-backdrop">
          <NeuPanel
            as="section"
            surface="raised"
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="dialog-accent" aria-hidden="true" />
            <p className="eyebrow">UNSAVED DOCUMENT</p>
            <h2 id="confirm-title">保留这次修改吗？</h2>
            <p>
              {prompt === 'close'
                ? '当前文档还有未保存的内容。关闭前可以先保存，或直接放弃修改。'
                : '打开另一个文件前，可以先保存当前内容，或直接放弃修改。'}
            </p>
            <div className="dialog-actions">
              <NeuButton variant="ghost" onClick={() => handlePromptChoice('cancel')}>
                取消
              </NeuButton>
              <NeuButton
                variant="danger"
                disabled={savePhase === 'saving'}
                onClick={() => handlePromptChoice('discard')}
              >
                放弃修改
              </NeuButton>
              <NeuButton
                variant="primary"
                size="sm"
                disabled={savePhase === 'saving'}
                onClick={() => handlePromptChoice('save')}
              >
                <Save aria-hidden="true" />
                保存
              </NeuButton>
            </div>
          </NeuPanel>
        </div>
      )}
    </div>
  )
}
