import {
  Bold,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  FileDown,
  FileText,
  FolderOpen,
  Highlighter,
  History,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTree,
  ListTodo,
  ListVideo,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquareText,
  Percent,
  Plus,
  Quote,
  Redo2,
  Replace,
  Save,
  Search,
  SquareCode,
  Table2,
  Trash2,
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
  type DragEvent as ReactDragEvent
} from 'react'
import CodeEditor, { type CodeEditorHandle, type EditorPosition } from './components/CodeEditor'
import {
  NeuButton,
  NeuIconButton,
  NeuPanel,
  NeuStatus
} from './components/neumorphic'
import type { EditorAction } from './editor/markdownCommands'
import {
  defaultSearchOptions,
  findSearchMatches,
  replaceAllSearchMatches,
  replaceSearchMatch,
  type SearchOptions
} from './editor/search'
import { extractMarkdownOutline, type MarkdownOutlineItem } from './lib/markdownOutline'
import {
  createReadingMarkId,
  readAnnotations,
  readBookmarks,
  resolveBookmarkPosition,
  type DocumentAnnotation,
  type DocumentBookmark
} from './lib/readingMarks'
import type { FileInfo, OpenedFile } from '../../shared/contracts'

type SavePhase = 'idle' | 'saving'
type PromptKind = 'open' | 'close'
type PromptChoice = 'save' | 'discard' | 'cancel'
type NoticeTone = 'neutral' | 'success' | 'error'
type SearchDirection = 'next' | 'previous'

interface Notice {
  text: string
  tone: NoticeTone
}

interface FileHistoryEntry {
  path: string
  name: string
  openedAt: number
}

interface FileReadingPosition {
  editor: EditorPosition
  preview: {
    scrollRatio: number
  }
}

type PendingOpen =
  | { kind: 'dialog' }
  | { kind: 'path'; path: string }
  | { kind: 'drop'; file: File }

const historyStorageKey = 'seermarkdown.file-history'
const historyLimit = 20
const readingListStorageKey = 'seermarkdown.reading-list'
const positionStorageKey = 'seermarkdown.file-positions'
const bookmarkStorageKey = 'seermarkdown.bookmarks'
const annotationStorageKey = 'seermarkdown.annotations'

function formatReadingTime(minutes: number): string {
  if (minutes < 1) {
    return '不到 1 分钟'
  }
  return `${Math.ceil(minutes)} 分钟`
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(value, 1))
}

function readPositions(): Record<string, FileReadingPosition> {
  try {
    const raw = window.localStorage.getItem(positionStorageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const positions: Record<string, FileReadingPosition> = {}
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue
      }

      const candidate = value as {
        editor?: { cursor?: unknown; scrollRatio?: unknown }
        preview?: { scrollRatio?: unknown }
      }
      if (
        typeof candidate.editor?.cursor !== 'number' ||
        typeof candidate.editor?.scrollRatio !== 'number' ||
        typeof candidate.preview?.scrollRatio !== 'number'
      ) {
        continue
      }

      positions[path] = {
        editor: {
          cursor: Math.max(0, candidate.editor.cursor),
          scrollRatio: clampRatio(candidate.editor.scrollRatio)
        },
        preview: {
          scrollRatio: clampRatio(candidate.preview.scrollRatio)
        }
      }
    }
    return positions
  } catch {
    return {}
  }
}

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
  const [sourceMode, setSourceMode] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)
  const [history, setHistory] = useState<FileHistoryEntry[]>(readHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [readingList, setReadingList] = useState<FileInfo[]>(readReadingList)
  const [readingListOpen, setReadingListOpen] = useState(false)
  const [readingListDragActive, setReadingListDragActive] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(defaultSearchOptions)
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [bookmarks, setBookmarks] = useState<DocumentBookmark[]>(readBookmarks)
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>(readAnnotations)
  const [annotationDraft, setAnnotationDraft] = useState<{
    quote: string
    note: string
    position: number
  } | null>(null)
  const [readingProgress, setReadingProgress] = useState(0)
  const [currentHeading, setCurrentHeading] = useState<string | null>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const filePositionsRef = useRef<Record<string, FileReadingPosition>>(readPositions())
  const readingListItemRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreFrameRef = useRef<number | null>(null)
  const pendingOpenRef = useRef<PendingOpen | null>(null)
  const dragDepthRef = useRef(0)
  const readingListDragDepthRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)
  const pendingBookmarkRef = useRef<DocumentBookmark | null>(null)

  const dirty = useMemo(() => content !== savedContent, [content, savedContent])
  const characterCount = useMemo(() => countVisibleCharacters(content), [content])
  const outline = useMemo(() => extractMarkdownOutline(content), [content])
  const searchMatches = useMemo(
    () => findSearchMatches(content, searchQuery, searchOptions),
    [content, searchOptions, searchQuery]
  )
  const activeSearchRange = useMemo(() => {
    const match = searchMatches[activeSearchIndex]
    return match ? { start: match.start, end: match.end } : null
  }, [activeSearchIndex, searchMatches])
  const readingMinutes = useMemo(() => Math.max(1, characterCount / 420), [characterCount])
  const currentBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => bookmark.path === file?.path),
    [bookmarks, file?.path]
  )
  const currentAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.path === file?.path),
    [annotations, file?.path]
  )

  const saveCurrentPosition = useCallback(() => {
    const currentFile = file
    if (!currentFile) {
      return
    }

    const tracked =
      history.some((item) => item.path === currentFile.path) ||
      readingList.some((item) => item.path === currentFile.path)
    if (!tracked) {
      return
    }

    const position: FileReadingPosition = {
      editor: editorRef.current?.getPosition() ?? { cursor: 0, scrollRatio: 0 },
      preview: { scrollRatio: 0 }
    }
    filePositionsRef.current = {
      ...filePositionsRef.current,
      [currentFile.path]: position
    }

    try {
      window.localStorage.setItem(positionStorageKey, JSON.stringify(filePositionsRef.current))
    } catch {
      // Position remains available for this session when storage is unavailable.
    }
  }, [file, history, readingList])

  const restoreFilePosition = useCallback((path: string, contentLength: number) => {
    const position = filePositionsRef.current[path]
    if (!position) {
      return
    }

    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current)
    }
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null
      editorRef.current?.setPosition({
        cursor: Math.max(0, Math.min(position.editor.cursor, contentLength)),
        scrollRatio: clampRatio(position.editor.scrollRatio)
      })
    })
  }, [])

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

  const loadFile = useCallback(
    (nextFile: OpenedFile, restorePosition = false) => {
      saveCurrentPosition()
      pendingOpenRef.current = null
      rememberFile(nextFile)
      setFile(nextFile)
      setContent(nextFile.content)
      setSavedContent(nextFile.content)
      setPrompt(null)
      const pendingBookmark = pendingBookmarkRef.current
      if (pendingBookmark?.path === nextFile.path) {
        pendingBookmarkRef.current = null
        const cursor = resolveBookmarkPosition(pendingBookmark, nextFile.content)
        editorRef.current?.setPosition({ cursor, scrollRatio: 0 })
      } else if (restorePosition) {
        restoreFilePosition(nextFile.path, nextFile.content.length)
      }
      showNotice(`已打开 ${nextFile.name}`)
    },
    [rememberFile, restoreFilePosition, saveCurrentPosition, showNotice]
  )

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
          loadFile(nextFile, true)
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

      saveCurrentPosition()
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
  }, [content, file?.name, rememberFile, saveCurrentPosition, showNotice])

  const persistCurrent = useCallback(async (announce = true): Promise<boolean> => {
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
      if (announce) {
        showNotice(`已保存 ${result.name}`, 'success')
      }
      return true
    } catch (error) {
      setSavePhase('idle')
      showNotice(getErrorMessage(error), 'error')
      return false
    }
  }, [content, file, saveFileAs, showNotice])

  useEffect(() => {
    if (!file || content === savedContent) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistCurrent(false)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [content, file, persistCurrent, savedContent])

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


  const openSearch = useCallback((withReplace = false) => {
    setSearchOpen(true)
    setReplaceOpen(withReplace)
    window.requestAnimationFrame(() => {
      document.getElementById('markdown-find-input')?.focus()
    })
  }, [])

  const toggleSearch = useCallback(() => {
    if (searchOpen) {
      setSearchOpen(false)
      editorRef.current?.focus()
      return
    }
    openSearch(true)
  }, [openSearch, searchOpen])

  const navigateSearch = useCallback(
    (direction: SearchDirection) => {
      if (searchMatches.length === 0) {
        return
      }

      const nextIndex =
        direction === 'next'
          ? (activeSearchIndex + 1) % searchMatches.length
          : (activeSearchIndex - 1 + searchMatches.length) % searchMatches.length
      const match = searchMatches[nextIndex]
      setActiveSearchIndex(nextIndex)
      editorRef.current?.setSelection(match.start, match.end)
    },
    [activeSearchIndex, searchMatches]
  )

  const replaceCurrentMatch = useCallback(() => {
    const match = searchMatches[activeSearchIndex]
    if (!match) {
      return
    }

    const matchReplacement = replaceSearchMatch(
      match.text,
      { ...match, start: 0, end: match.text.length },
      replaceQuery,
      searchOptions,
      searchQuery
    )
    setContent(replaceSearchMatch(content, match, replaceQuery, searchOptions, searchQuery))
    editorRef.current?.replaceRange(match.start, match.end, matchReplacement)
  }, [activeSearchIndex, content, replaceQuery, searchMatches, searchOptions, searchQuery])

  const replaceEveryMatch = useCallback(() => {
    if (searchMatches.length === 0) {
      return
    }

    const replacement = replaceAllSearchMatches(content, searchQuery, replaceQuery, searchOptions)
    setContent(replacement)
    editorRef.current?.replaceAll(
      searchMatches.map((match) => ({
        from: match.start,
        to: match.end,
        text: replaceSearchMatch(
          match.text,
          { ...match, start: 0, end: match.text.length },
          replaceQuery,
          searchOptions,
          searchQuery
        )
      }))
    )
    setActiveSearchIndex(0)
    showNotice(`已替换 ${searchMatches.length} 处内容`, 'success')
  }, [content, replaceQuery, searchMatches, searchOptions, searchQuery, showNotice])

  const jumpToOutlineItem = useCallback((item: MarkdownOutlineItem) => {
    setOutlineOpen(false)
    editorRef.current?.setSelection(item.start, item.end)
  }, [])

  const insertLocalImage = useCallback(async () => {
    if (!file) {
      showNotice('请先将文档保存到本地，再插入图片', 'error')
      return
    }

    try {
      const image = await window.seerMarkdown.selectImage(file.path)
      if (image) {
        editorRef.current?.insertText(`![${image.name}](${image.markdownPath})`)
        showNotice(`已插入 ${image.name}`, 'success')
      }
    } catch (error) {
      showNotice(getErrorMessage(error), 'error')
    }
  }, [file, showNotice])

  const addBookmark = useCallback(() => {
    if (!file) {
      showNotice('打开文档后才能添加书签', 'error')
      return
    }

    const cursor = editorRef.current?.getPosition().cursor ?? 0
    const bookmark: DocumentBookmark = {
      id: createReadingMarkId('bookmark'),
      path: file.path,
      title: currentHeading ?? file.name,
      heading: currentHeading,
      cursor,
      excerpt: content.slice(Math.max(0, cursor - 24), cursor + 56).replace(/\s+/g, ' ').trim(),
      createdAt: Date.now()
    }
    setBookmarks((current) => [bookmark, ...current])
    showNotice('已添加书签', 'success')
  }, [content, currentHeading, file, showNotice])

  const startAnnotation = useCallback(() => {
    const quote = window.getSelection()?.toString().trim() ?? ''
    if (!file || !quote) {
      showNotice('请先在预览中选择要批注的文字', 'error')
      return
    }
    setAnnotationDraft({ quote, note: '', position: Math.max(0, content.indexOf(quote)) })
    setReviewOpen(true)
  }, [content, file, showNotice])

  const saveAnnotation = useCallback(() => {
    if (!file || !annotationDraft?.quote) {
      return
    }

    setAnnotations((current) => [
      {
        id: createReadingMarkId('annotation'),
        path: file.path,
        quote: annotationDraft.quote,
        note: annotationDraft.note.trim(),
        heading: currentHeading,
        position: annotationDraft.position,
        createdAt: Date.now()
      },
      ...current
    ])
    setAnnotationDraft(null)
    showNotice('已添加批注', 'success')
  }, [annotationDraft, currentHeading, file, showNotice])

  const jumpToBookmark = useCallback((bookmark: DocumentBookmark) => {
    setReviewOpen(false)
    if (bookmark.path === file?.path) {
      editorRef.current?.setPosition({ cursor: bookmark.cursor, scrollRatio: 0 })
      editorRef.current?.focus()
      return
    }
    pendingBookmarkRef.current = bookmark
    requestFileOpen(bookmark.path)
  }, [file?.path, requestFileOpen])

  const jumpToAnnotation = useCallback((annotation: DocumentAnnotation) => {
    setReviewOpen(false)
    editorRef.current?.setPosition({
      cursor: annotation.position,
      scrollRatio: 0
    })
    setSearchQuery(annotation.quote)
    openSearch(false)
  }, [openSearch])

  const handleEditorScroll = useCallback((progress: number, heading: string | null) => {
    setReadingProgress(progress)
    setCurrentHeading(heading)
  }, [])

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      navigateSearch(event.shiftKey ? 'previous' : 'next')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setSearchOpen(false)
      editorRef.current?.focus()
    }
  }

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveSearchIndex(0)
      return
    }
    setActiveSearchIndex((index) => Math.min(index, searchMatches.length - 1))
  }, [searchMatches.length])

  useEffect(() => {
    try {
      window.localStorage.setItem(bookmarkStorageKey, JSON.stringify(bookmarks))
    } catch {
      // Bookmarks remain available for this session when storage is unavailable.
    }
  }, [bookmarks])

  useEffect(() => {
    try {
      window.localStorage.setItem(annotationStorageKey, JSON.stringify(annotations))
    } catch {
      // Annotations remain available for this session when storage is unavailable.
    }
  }, [annotations])

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier || event.key.toLowerCase() !== 'f') {
        return
      }
      event.preventDefault()
      openSearch(false)
    }
    const handleReplaceShortcut = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier || event.key.toLowerCase() !== 'h') {
        return
      }
      event.preventDefault()
      openSearch(true)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setOutlineOpen(false)
      }
    }

    window.addEventListener('keydown', handleSearchShortcut)
    window.addEventListener('keydown', handleReplaceShortcut)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleSearchShortcut)
      window.removeEventListener('keydown', handleReplaceShortcut)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [openSearch])

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
          saveCurrentPosition()
          window.seerMarkdown.completeClose('saved')
        } else {
          await continuePendingOpen()
        }
        return
      }

      setPrompt(null)
      if (activePrompt === 'close') {
        pendingOpenRef.current = null
        saveCurrentPosition()
        window.seerMarkdown.completeClose('discard')
      } else {
        await continuePendingOpen()
      }
    },
    [continuePendingOpen, prompt, persistCurrent, saveCurrentPosition]
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
    if (!readingListOpen || !file) {
      return
    }

    readingListItemRefs.current.get(file.path)?.scrollIntoView({
      block: 'nearest'
    })
  }, [file, readingList, readingListOpen])

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
      saveCurrentPosition()
      if (dirty) {
        setPrompt('close')
      } else {
        window.seerMarkdown.completeClose('discard')
      }
    })
  }, [dirty, saveCurrentPosition])

  useEffect(() => {
    window.addEventListener('beforeunload', saveCurrentPosition)
    return () => {
      window.removeEventListener('beforeunload', saveCurrentPosition)
    }
  }, [saveCurrentPosition])

  useEffect(() => {
    return () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current)
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  const executeEditorAction = useCallback((action: EditorAction) => {
    editorRef.current?.execute(action)
  }, [])

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

        {!sidebarCollapsed && (
        <section className="sidebar-section" aria-labelledby="tool-tools-title">
          <h2 id="tool-tools-title">工具</h2>
          <div className="sidebar-actions" role="toolbar" aria-label="写作与阅读工具">
            <NeuIconButton
              label="查找和替换"
              title="查找和替换"
              aria-pressed={searchOpen}
              onClick={toggleSearch}
            >
              <Search aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              label="文档大纲"
              title="文档大纲"
              aria-pressed={outlineOpen}
              onClick={() => setOutlineOpen((value) => !value)}
            >
              <ListTree aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="书签和批注" title="书签和批注" onClick={() => setReviewOpen(true)}>
              <Bookmark aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="插入本地图片" title="插入本地图片" onClick={() => void insertLocalImage()}>
              <ImagePlus aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton
              label="源码模式"
              title={sourceMode ? '退出源码模式' : '源码模式'}
              aria-pressed={sourceMode}
              onClick={() => setSourceMode((value) => !value)}
            >
              <FileCode2 aria-hidden="true" />
            </NeuIconButton>
          </div>
        </section>
        )}

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

      <main className="workspace workspace--single-panel">
        <NeuPanel
          as="section"
          surface="raised"
          className="editor-panel unified-editor-panel"
          aria-label="内容编辑区"
        >
          <div className="panel-heading">
            <div>
              <span className="panel-index">{sourceMode ? 'MD' : '01'}</span>
              <h2>{sourceMode ? '源码' : '内容'}</h2>
            </div>
            <div className="reading-instrument" aria-label="阅读进度">
              <span><Percent aria-hidden="true" /> {Math.round(readingProgress * 100)}%</span>
              <span>剩余 {formatReadingTime(readingMinutes * (1 - readingProgress))}</span>
              <span title={currentHeading ?? '文档开头'}>{currentHeading ?? '文档开头'}</span>
              <i aria-hidden="true"><b style={{ width: `${Math.round(readingProgress * 100)}%` }} /></i>
            </div>
          </div>
          <div className="panel-body">
            <CodeEditor
              ref={editorRef}
              value={content}
              onChange={setContent}
              renderMode={sourceMode ? 'source' : 'unified'}
              documentPath={file?.path}
              searchQuery={searchQuery}
              searchOptions={searchOptions}
              activeSearchRange={activeSearchRange}
              onScrollChange={handleEditorScroll}
            />
          </div>
        </NeuPanel>
      </main>


      {searchOpen && (
        <NeuPanel surface="raised" className={`search-console ${replaceOpen ? 'search-console--replace' : ''}`} role="search">
          <div className="search-console-heading">
            <div>
              <p className="eyebrow">FIND IN DOCUMENT</p>
              <strong>查找和替换</strong>
            </div>
            <NeuIconButton label="关闭查找" title="关闭查找" onClick={() => setSearchOpen(false)}>
              <X aria-hidden="true" />
            </NeuIconButton>
          </div>
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              id="markdown-find-input"
              value={searchQuery}
              placeholder="查找内容"
              aria-label="查找内容"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <span>{searchMatches.length === 0 ? '0/0' : `${activeSearchIndex + 1}/${searchMatches.length}`}</span>
          </label>
          {replaceOpen && (
            <label className="search-field">
              <Replace aria-hidden="true" />
              <input
                value={replaceQuery}
                placeholder="替换为"
                aria-label="替换为"
                onChange={(event) => setReplaceQuery(event.target.value)}
              />
            </label>
          )}
          <div className="search-options" aria-label="搜索选项">
            <NeuButton
              size="sm"
              variant={searchOptions.caseSensitive ? 'primary' : 'ghost'}
              pressed={searchOptions.caseSensitive}
              onClick={() => setSearchOptions((value) => ({ ...value, caseSensitive: !value.caseSensitive }))}
            >
              Aa
            </NeuButton>
            <NeuButton
              size="sm"
              variant={searchOptions.wholeWord ? 'primary' : 'ghost'}
              pressed={searchOptions.wholeWord}
              onClick={() => setSearchOptions((value) => ({ ...value, wholeWord: !value.wholeWord }))}
            >
              整词
            </NeuButton>
            <NeuButton
              size="sm"
              variant={searchOptions.regex ? 'primary' : 'ghost'}
              pressed={searchOptions.regex}
              onClick={() => setSearchOptions((value) => ({ ...value, regex: !value.regex }))}
            >
              .*
            </NeuButton>
            <span className="search-spacer" />
            <NeuIconButton label="上一个结果" title="上一个结果" onClick={() => navigateSearch('previous')}>
              <ChevronLeft aria-hidden="true" />
            </NeuIconButton>
            <NeuIconButton label="下一个结果" title="下一个结果" onClick={() => navigateSearch('next')}>
              <ChevronRight aria-hidden="true" />
            </NeuIconButton>
          </div>
          {replaceOpen && (
            <div className="search-replace-actions">
              <NeuButton size="sm" disabled={!searchMatches.length} onClick={replaceCurrentMatch}>
                替换当前
              </NeuButton>
              <NeuButton size="sm" variant="primary" disabled={!searchMatches.length} onClick={replaceEveryMatch}>
                全部替换
              </NeuButton>
            </div>
          )}
        </NeuPanel>
      )}

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
              <div className="reading-list-actions">
                <NeuButton
                  variant="danger"
                  size="sm"
                  disabled={readingList.length === 0}
                  onClick={() => {
                    setReadingList([])
                    showNotice('已清空阅读列表', 'success')
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  清空列表
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
            </div>

            {readingList.length > 0 ? (
              <ol className="history-list reading-list">
                {readingList.map((entry, index) => {
                  const active = entry.path === file?.path
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        ref={(element) => {
                          if (element) {
                            readingListItemRefs.current.set(entry.path, element)
                          } else {
                            readingListItemRefs.current.delete(entry.path)
                          }
                        }}
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


      {outlineOpen && (
        <div className="modal-backdrop">
          <NeuPanel
            as="section"
            surface="raised"
            className="history-dialog outline-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="outline-title"
          >
            <div className="history-heading">
              <div>
                <p className="eyebrow">DOCUMENT MAP</p>
                <h2 id="outline-title">文档大纲</h2>
              </div>
              <NeuIconButton label="关闭文档大纲" title="关闭文档大纲" onClick={() => setOutlineOpen(false)}>
                <X aria-hidden="true" />
              </NeuIconButton>
            </div>
            {outline.length > 0 ? (
              <nav className="outline-list" aria-label="Markdown 标题目录">
                {outline.map((item) => (
                  <button
                    key={`${item.id}-${item.start}`}
                    type="button"
                    className={`outline-item outline-level-${item.level}`}
                    onClick={() => jumpToOutlineItem(item)}
                  >
                    <span>H{item.level}</span>
                    <strong>{item.text}</strong>
                    <small>{item.line}</small>
                  </button>
                ))}
              </nav>
            ) : (
              <div className="history-empty">
                <ListTree aria-hidden="true" />
                <p>当前文档还没有标题</p>
              </div>
            )}
          </NeuPanel>
        </div>
      )}

      {reviewOpen && (
        <div className="modal-backdrop">
          <NeuPanel
            as="section"
            surface="raised"
            className="history-dialog review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <div className="history-heading">
              <div>
                <p className="eyebrow">READING MARKS</p>
                <h2 id="review-title">书签和批注</h2>
              </div>
              <NeuIconButton label="关闭书签和批注" title="关闭书签和批注" onClick={() => setReviewOpen(false)}>
                <X aria-hidden="true" />
              </NeuIconButton>
            </div>

            <div className="review-actions">
              <NeuButton size="sm" variant="primary" onClick={addBookmark}>
                <BookmarkPlus aria-hidden="true" />
                添加书签
              </NeuButton>
              <NeuButton size="sm" onClick={startAnnotation}>
                <Highlighter aria-hidden="true" />
                批注所选文字
              </NeuButton>
            </div>

            {annotationDraft && (
              <div className="annotation-draft">
                <p>“{annotationDraft.quote}”</p>
                <textarea
                  value={annotationDraft.note}
                  aria-label="批注内容"
                  placeholder="写下这条批注（可选）"
                  onChange={(event) =>
                    setAnnotationDraft({ ...annotationDraft, note: event.target.value })
                  }
                />
                <div className="dialog-actions">
                  <NeuButton size="sm" variant="ghost" onClick={() => setAnnotationDraft(null)}>
                    取消
                  </NeuButton>
                  <NeuButton size="sm" variant="primary" onClick={saveAnnotation}>
                    保存批注
                  </NeuButton>
                </div>
              </div>
            )}

            <div className="review-columns">
              <section aria-labelledby="bookmarks-title">
                <h3 id="bookmarks-title"><Bookmark aria-hidden="true" /> 书签</h3>
                {currentBookmarks.length > 0 ? (
                  <ol className="mark-list">
                    {currentBookmarks.map((bookmark) => (
                      <li key={bookmark.id}>
                        <button type="button" className="mark-item" onClick={() => jumpToBookmark(bookmark)}>
                          <strong>{bookmark.title}</strong>
                          <span>{bookmark.excerpt || '空文档位置'}</span>
                        </button>
                        <NeuIconButton
                          label={`删除书签 ${bookmark.title}`}
                          title={`删除书签 ${bookmark.title}`}
                          onClick={() => setBookmarks((items) => items.filter((item) => item.id !== bookmark.id))}
                        >
                          <Trash2 aria-hidden="true" />
                        </NeuIconButton>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mark-empty">当前文档暂无书签</p>
                )}
              </section>

              <section aria-labelledby="annotations-title">
                <h3 id="annotations-title"><MessageSquareText aria-hidden="true" /> 批注</h3>
                {currentAnnotations.length > 0 ? (
                  <ol className="mark-list">
                    {currentAnnotations.map((annotation) => (
                      <li key={annotation.id}>
                        <button type="button" className="mark-item" onClick={() => jumpToAnnotation(annotation)}>
                          <strong>“{annotation.quote}”</strong>
                          <span>{annotation.note || '高亮标记'}</span>
                        </button>
                        <NeuIconButton
                          label={`删除批注 ${annotation.quote}`}
                          title={`删除批注 ${annotation.quote}`}
                          onClick={() => setAnnotations((items) => items.filter((item) => item.id !== annotation.id))}
                        >
                          <Trash2 aria-hidden="true" />
                        </NeuIconButton>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mark-empty">当前文档暂无批注</p>
                )}
              </section>
            </div>
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
