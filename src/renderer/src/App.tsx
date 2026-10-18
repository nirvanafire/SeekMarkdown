import {
  Bold,
  Check,
  CircleAlert,
  Code2,
  Columns2,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
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
import type { OpenedFile } from '../../shared/contracts'

type SavePhase = 'idle' | 'saving'
type PromptKind = 'open' | 'close'
type PromptChoice = 'save' | 'discard' | 'cancel'
type NoticeTone = 'neutral' | 'success' | 'error'

interface Notice {
  text: string
  tone: NoticeTone
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
  const workspaceRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const draggingSplitRef = useRef(false)
  const pendingDroppedFileRef = useRef<File | null>(null)
  const dragDepthRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  const dirty = useMemo(() => content !== savedContent, [content, savedContent])
  const characterCount = useMemo(() => countVisibleCharacters(content), [content])

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
    pendingDroppedFileRef.current = null
    setFile(nextFile)
    setContent(nextFile.content)
    setSavedContent(nextFile.content)
    setPrompt(null)
    showNotice(`已打开 ${nextFile.name}`)
  }, [showNotice])

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
      setSavedContent(contentToSave)
      setSavePhase('idle')
      showNotice(`已保存到 ${savedFile.name}`, 'success')
      return true
    } catch (error) {
      setSavePhase('idle')
      showNotice(getErrorMessage(error), 'error')
      return false
    }
  }, [content, file?.name, showNotice])

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
    pendingDroppedFileRef.current = null
    if (dirty) {
      setPrompt('open')
      return
    }
    void performOpen()
  }, [dirty, performOpen])

  const requestDroppedFile = useCallback(
    (droppedFile: File) => {
      if (dirty) {
        pendingDroppedFileRef.current = droppedFile
        setPrompt('open')
        return
      }
      void openDroppedFile(droppedFile)
    },
    [dirty, openDroppedFile]
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
        pendingDroppedFileRef.current = null
        setPrompt(null)
        if (activePrompt === 'close') {
          window.seerMarkdown.completeClose('cancelled')
        }
        return
      }

      const droppedFile = pendingDroppedFileRef.current
      pendingDroppedFileRef.current = null

      if (choice === 'save') {
        const saved = await persistCurrent()
        if (!saved) {
          pendingDroppedFileRef.current = droppedFile
          return
        }

        setPrompt(null)
        if (activePrompt === 'close') {
          window.seerMarkdown.completeClose('saved')
        } else if (droppedFile) {
          await openDroppedFile(droppedFile)
        } else {
          await performOpen()
        }
        return
      }

      setPrompt(null)
      if (activePrompt === 'close') {
        window.seerMarkdown.completeClose('discard')
      } else if (droppedFile) {
        await openDroppedFile(droppedFile)
      } else {
        await performOpen()
      }
    },
    [openDroppedFile, performOpen, prompt, persistCurrent]
  )

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
              Seer<span>Markdown</span>
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
