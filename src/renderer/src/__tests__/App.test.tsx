import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuCommand, OpenedFile, SeerMarkdownApi } from '../../../shared/contracts'
import App from '../App'
import '../styles.css'

vi.mock('../components/CodeEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')

  return {
    default: forwardRef<
      {
        execute(action: string): void
        focus(): void
        getPosition(): { cursor: number; scrollRatio: number }
        setPosition(position: { cursor: number; scrollRatio: number } | null): void
        setSelection(from: number, to?: number): void
        replaceRange(from: number, to: number, text: string, selectStart?: number, selectEnd?: number): void
        replaceAll(replacements: { from: number; to: number; text: string }[]): void
        insertText(text: string): void
      },
      { value: string; onChange: (value: string) => void }
    >(function MockCodeEditor({ value, onChange }, ref) {
      useImperativeHandle(
        ref,
        () => ({
          execute(action) {
            onChange(`${value}\n<!--${action}-->`)
          },
          focus() {},
          getPosition() {
            return { cursor: value.length, scrollRatio: 0.25 }
          },
          setSelection(from, to) {
            document.querySelector('[data-testid="editor-position"]')?.setAttribute('data-position', `${from}:${to ?? from}`)
          },
          replaceRange(from, to, text) {
            onChange(`${value.slice(0, from)}${text}${value.slice(to)}`)
          },
          replaceAll(replacements) {
            const next = [...replacements]
              .sort((a, b) => b.from - a.from)
              .reduce((current, item) => `${current.slice(0, item.from)}${item.text}${current.slice(item.to)}`, value)
            onChange(next)
          },
          insertText(text) {
            onChange(`${value}${text}`)
          },
          setPosition(position) {
            document
              .querySelector('[data-testid="editor-position"]')
              ?.setAttribute('data-position', JSON.stringify(position))
          }
        }),
        [onChange, value]
      )

      return (
        <>
          <textarea
            aria-label="markdown-editor"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <span data-testid="editor-position" />
        </>
      )
    })
  }
})

const api = {
  openFile: vi.fn(),
  getFileInfo: vi.fn(),
  selectFiles: vi.fn(),
  openDroppedFile: vi.fn(),
  openFileByPath: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
  selectImage: vi.fn(),
  readLocalImage: vi.fn(),
  setDirty: vi.fn(),
  requestClose: vi.fn(),
  completeClose: vi.fn(),
  onInitialFile: vi.fn(),
  onMenuCommand: vi.fn(),
  onCloseRequested: vi.fn()
} satisfies SeerMarkdownApi

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    Object.defineProperty(window, 'seerMarkdown', {
      value: api,
      configurable: true
    })
    api.onInitialFile.mockReturnValue(() => undefined)
    api.onMenuCommand.mockReturnValue(() => undefined)
    api.onCloseRequested.mockReturnValue(() => undefined)
  })

  it('starts in edit mode with an empty editor and opens files from the sidebar', async () => {
    const openedFile: OpenedFile = {
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 打开的文档'
    }
    api.openFile.mockResolvedValue(openedFile)
    render(<App />)

    expect(screen.getByLabelText('markdown-editor')).toHaveValue('')

    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 打开的文档')
    })
    expect(screen.getAllByText('notes.md').length).toBeGreaterThan(0)
  })

  it('shows file history in reverse chronological order and opens an entry', async () => {
    const storedHistory = [
      { path: '/tmp/new.md', name: 'new.md', openedAt: 2000 },
      ...Array.from({ length: 20 }, (_, index) => ({
        path: `/tmp/old-${index}.md`,
        name: `old-${index}.md`,
        openedAt: 1000 - index
      }))
    ]
    window.localStorage.setItem('seermarkdown.file-history', JSON.stringify(storedHistory))
    api.openFileByPath.mockResolvedValue({
      path: '/tmp/new.md',
      name: 'new.md',
      content: '# 历史文档'
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开历史记录' }))
    const historyDialog = screen.getByRole('dialog', { name: '打开历史' })
    const historyItems = within(historyDialog).getAllByRole('button').filter((button) => {
      return button.getAttribute('class') === 'history-item'
    })
    expect(historyItems).toHaveLength(20)
    expect(historyItems[0]).toHaveTextContent('new.md')
    expect(historyItems[1]).toHaveTextContent('old-0.md')
    expect(historyItems.at(-1)).not.toHaveTextContent('old-19.md')

    await userEvent.click(historyItems[0])
    await waitFor(() => {
      expect(api.openFileByPath).toHaveBeenCalledWith('/tmp/new.md')
    })
    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 历史文档')
    })
  })

  it('adds selected files to the persistent reading list and opens the first file', async () => {
    window.localStorage.setItem(
      'seermarkdown.reading-list',
      JSON.stringify([{ path: '/tmp/existing-2.md', name: 'existing-2.md' }])
    )
    api.selectFiles.mockResolvedValue([
      { path: '/tmp/new-1.md', name: 'new-1.md' },
      { path: '/tmp/existing-2.md', name: 'existing-2.md' },
      { path: '/tmp/new-3.md', name: 'new-3.md' }
    ])
    api.openFileByPath.mockResolvedValue({
      path: '/tmp/new-1.md',
      name: 'new-1.md',
      content: '# 第一篇'
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))
    await userEvent.click(screen.getByRole('button', { name: '添加文件' }))

    const readingDialog = screen.getByRole('dialog', { name: '阅读列表' })
    const readingItems = within(readingDialog)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('reading-list-item'))
    expect(readingItems).toHaveLength(3)
    expect(readingItems[0]).toHaveTextContent('existing-2.md')
    expect(readingItems[1]).toHaveTextContent('new-1.md')
    expect(readingItems[2]).toHaveTextContent('new-3.md')

    await waitFor(() => {
      expect(api.openFileByPath).toHaveBeenCalledWith('/tmp/new-1.md')
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 第一篇')
    })
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('seermarkdown.reading-list') ?? '[]')
      expect(stored).toHaveLength(3)
    })
  })

  it('clears the persistent reading list', async () => {
    window.localStorage.setItem(
      'seermarkdown.reading-list',
      JSON.stringify([
        { path: '/tmp/one.md', name: 'one.md' },
        { path: '/tmp/two.md', name: 'two.md' }
      ])
    )
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))
    expect(screen.getByRole('button', { name: /one\.md/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '清空列表' }))
    expect(screen.getByText('暂无阅读文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空列表' })).toBeDisabled()
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('seermarkdown.reading-list') ?? '[]')).toEqual([])
    })
  })

  it('adds dropped files to the reading list without opening them', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))

    const droppedFiles = [
      new File(['# 第一篇'], 'dropped-1.md'),
      new File(['# 第二篇'], 'dropped-2.md')
    ]
    api.getFileInfo.mockImplementation((file) => ({
      path: `/tmp/${file.name}`,
      name: file.name
    }))
    const dataTransfer = {
      types: ['Files'],
      files: {
        0: droppedFiles[0],
        1: droppedFiles[1],
        length: 2,
        item: (index: number) => droppedFiles[index] ?? null
      },
      dropEffect: 'none'
    } as unknown as DataTransfer

    const readingDialog = screen.getByRole('dialog', { name: '阅读列表' })
    fireEvent.dragEnter(readingDialog, { dataTransfer })
    expect(screen.getByText('松开以添加到阅读列表')).toBeInTheDocument()

    fireEvent.drop(readingDialog, { dataTransfer })
    expect(screen.getByRole('button', { name: /dropped-1\.md/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dropped-2\.md/ })).toBeInTheDocument()
    expect(api.openFileByPath).not.toHaveBeenCalled()
    expect(api.openDroppedFile).not.toHaveBeenCalled()
  })

  it('scrolls the reading list to the current file when opened', async () => {
    window.localStorage.setItem(
      'seermarkdown.reading-list',
      JSON.stringify([
        { path: '/tmp/one.md', name: 'one.md' },
        { path: '/tmp/two.md', name: 'two.md' }
      ])
    )
    api.openFileByPath.mockResolvedValue({
      path: '/tmp/one.md',
      name: 'one.md',
      content: '# one'
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))
    await userEvent.click(screen.getByRole('button', { name: /one\.md/ }))
    await waitFor(() => {
      expect(vi.mocked(Element.prototype.scrollIntoView)).toHaveBeenCalledWith({
        block: 'nearest'
      })
    })
    expect(screen.getByRole('button', { name: /one\.md/ })).toHaveAttribute('aria-current', 'page')
  })

  it('saves the previous file position and restores positions from list entries', async () => {
    window.localStorage.setItem(
      'seermarkdown.file-history',
      JSON.stringify([
        { path: '/tmp/one.md', name: 'one.md', openedAt: 1000 },
        { path: '/tmp/two.md', name: 'two.md', openedAt: 2000 }
      ])
    )
    window.localStorage.setItem(
      'seermarkdown.reading-list',
      JSON.stringify([
        { path: '/tmp/one.md', name: 'one.md' },
        { path: '/tmp/two.md', name: 'two.md' }
      ])
    )
    window.localStorage.setItem(
      'seermarkdown.file-positions',
      JSON.stringify({
        '/tmp/two.md': {
          editor: { cursor: 99, scrollRatio: 0.8 },
          preview: { scrollRatio: 0.65 }
        }
      })
    )
    api.openFileByPath.mockImplementation(async (path: string) => ({
      path,
      name: path.split('/').at(-1) ?? path,
      content: path.endsWith('two.md') ? 'second' : 'first'
    }))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开历史记录' }))
    await userEvent.click(screen.getByRole('button', { name: /two\.md/ }))
    await waitFor(() => {
      expect(screen.getByTestId('editor-position')).toHaveAttribute(
        'data-position',
        JSON.stringify({ cursor: 6, scrollRatio: 0.8 })
      )
    })

    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))
    await userEvent.click(screen.getByRole('button', { name: /one\.md/ }))
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('seermarkdown.file-positions') ?? '{}')
      expect(stored['/tmp/two.md'].editor).toEqual({ cursor: 6, scrollRatio: 0.25 })
      expect(stored['/tmp/two.md'].preview.scrollRatio).toBe(0)
    })
  })

  it('does not restore cached positions when opening from the normal file dialog', async () => {
    window.localStorage.setItem(
      'seermarkdown.file-positions',
      JSON.stringify({
        '/tmp/plain.md': {
          editor: { cursor: 8, scrollRatio: 0.5 },
          preview: { scrollRatio: 0.4 }
        }
      })
    )
    api.openFile.mockResolvedValue({
      path: '/tmp/plain.md',
      name: 'plain.md',
      content: 'plain'
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('plain')
    })
    expect(screen.getByTestId('editor-position')).not.toHaveAttribute('data-position')
  })

  it('navigates the reading list and protects dirty content when switching', async () => {
    window.localStorage.setItem(
      'seermarkdown.reading-list',
      JSON.stringify([
        { path: '/tmp/one.md', name: 'one.md' },
        { path: '/tmp/two.md', name: 'two.md' },
        { path: '/tmp/three.md', name: 'three.md' }
      ])
    )
    api.openFileByPath.mockImplementation(async (path: string) => ({
      path,
      name: path.split('/').at(-1) ?? path,
      content: path
    }))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开阅读列表' }))
    const previousButton = screen.getByRole('button', { name: '上一个' })
    const nextButton = screen.getByRole('button', { name: '下一个' })
    expect(previousButton).toBeDisabled()
    expect(nextButton).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /one\.md/ }))
    await waitFor(() => {
      expect(api.openFileByPath).toHaveBeenCalledWith('/tmp/one.md')
    })
    expect(screen.getByRole('button', { name: /one\.md/ })).toHaveAttribute('aria-current', 'page')
    expect(previousButton).toBeDisabled()
    expect(nextButton).toBeEnabled()

    await userEvent.click(nextButton)
    await waitFor(() => {
      expect(api.openFileByPath).toHaveBeenCalledWith('/tmp/two.md')
    })

    await userEvent.type(screen.getByLabelText('markdown-editor'), ' 未保存')
    await userEvent.click(screen.getByRole('button', { name: '下一个' }))
    expect(await screen.findByRole('dialog', { name: '保留这次修改吗？' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(api.openFileByPath).not.toHaveBeenCalledWith('/tmp/three.md')
  })

  it('uses a unified content editor and toggles source mode', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: '实时预览' })).not.toBeInTheDocument()
    const editor = screen.getByRole('region', { name: '内容编辑区' })
    expect(editor).toBeVisible()
    expect(within(editor).getByRole('toolbar', { name: 'Markdown 格式工具' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Markdown 预览' })).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('markdown-editor'), '# 统一编辑内容')
    const sourceButton = screen.getByRole('button', { name: '源码模式' })
    await userEvent.click(sourceButton)
    expect(sourceButton).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(sourceButton)
    expect(sourceButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapses and restores the sidebar icon rail', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).toHaveClass('sidebar-collapsed')
    expect(screen.getByLabelText('文档控制台')).toBeVisible()
    expect(screen.queryByText('格式')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开 Markdown 文件' })).toBeVisible()
    expect(screen.getByRole('button', { name: '源码模式' })).toBeVisible()
    expect(screen.queryByText('未打开文件')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).not.toHaveClass('sidebar-collapsed')
    expect(screen.queryByText('格式')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '源码模式' })).toBeVisible()
  })

  it('tracks dirty state and saves through the file bridge', async () => {
    api.openFile.mockResolvedValue({
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 原始内容'
    })
    api.saveFile.mockResolvedValue({ path: '/tmp/notes.md', name: 'notes.md' })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    const editor = await screen.findByLabelText('markdown-editor')

    await userEvent.clear(editor)
    await userEvent.type(editor, '# 修改后的内容')
    expect(screen.getByText('未保存')).toBeInTheDocument()
    expect(api.setDirty).toHaveBeenLastCalledWith(true)

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(api.saveFile).toHaveBeenCalledWith('/tmp/notes.md', '# 修改后的内容')
    })
    await waitFor(() => {
      expect(screen.getByText('已保存')).toBeInTheDocument()
    })
  })

  it('opens a dropped file through the preload bridge', async () => {
    const droppedFile = new File(['# 拖入的文档'], 'dropped.md')
    api.openDroppedFile.mockResolvedValue({
      path: '/tmp/dropped.md',
      name: 'dropped.md',
      content: '# 拖入的文档'
    })
    render(<App />)

    const dataTransfer = {
      types: ['Files'],
      files: {
        0: droppedFile,
        length: 1,
        item: (index: number) => (index === 0 ? droppedFile : null)
      },
      dropEffect: 'none'
    } as unknown as DataTransfer
    fireEvent.drop(screen.getByLabelText('文档控制台').parentElement as HTMLElement, {
      dataTransfer
    })

    await waitFor(() => {
      expect(api.openDroppedFile).toHaveBeenCalledWith(droppedFile)
    })
    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 拖入的文档')
    })
  })

  it('uses Save As when no file path exists', async () => {
    api.saveFileAs.mockResolvedValue({
      path: '/tmp/未命名.md',
      name: '未命名.md',
      content: ''
    })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '另存为' }))
    await waitFor(() => {
      expect(api.saveFileAs).toHaveBeenCalledWith('', '未命名.md')
    })
  })

  it('protects unsaved work when the window requests a close', async () => {
    let closeListener = () => undefined
    api.onCloseRequested.mockImplementation((listener) => {
      closeListener = listener
      return () => undefined
    })
    render(<App />)

    await userEvent.type(screen.getByLabelText('markdown-editor'), '# 未保存')
    closeListener()

    expect(await screen.findByRole('dialog')).toHaveTextContent('保留这次修改吗？')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(api.completeClose).toHaveBeenCalledWith('cancelled')
  })

  it('routes native menu commands to file actions', async () => {
    let menuListener: (command: MenuCommand) => void = () => undefined
    api.onMenuCommand.mockImplementation((listener) => {
      menuListener = listener
      return () => undefined
    })
    render(<App />)

    menuListener('save-as')
    await waitFor(() => {
      expect(api.saveFileAs).toHaveBeenCalled()
    })
  })
})

describe('App writing and reading tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    Object.defineProperty(window, 'seerMarkdown', {
      value: api,
      configurable: true
    })
    api.onInitialFile.mockReturnValue(() => undefined)
    api.onMenuCommand.mockReturnValue(() => undefined)
    api.onCloseRequested.mockReturnValue(() => undefined)
  })

  it('finds and replaces text with result count', async () => {
    render(<App />)
    const editor = screen.getByLabelText('markdown-editor')
    fireEvent.change(editor, { target: { value: '# title\n\ntitle again' } })

    await userEvent.click(screen.getByRole('button', { name: '查找和替换' }))
    await userEvent.type(screen.getByLabelText('查找内容'), 'title')
    expect(screen.getByText('1/2')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('替换为'), { target: { value: 'chapter' } })
    await userEvent.click(screen.getByRole('button', { name: '全部替换' }))
    expect(screen.getByLabelText('markdown-editor')).toHaveValue('# chapter\n\nchapter again')
  })

  it('toggles the floating search panel from the sidebar', async () => {
    render(<App />)
    const button = screen.getByRole('button', { name: '查找和替换' })
    await userEvent.click(button)
    expect(screen.getByRole('search')).toHaveClass('search-console')
    await userEvent.click(button)
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
  })

  it('toggles the outline content in the right sidebar', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('markdown-editor'), {
      target: { value: '# Outline\n\n## Child' }
    })

    const button = screen.getByRole('button', { name: '文档大纲' })
    const editor = screen.getByRole('region', { name: '内容编辑区' })
    const editorToolbar = within(editor).getByRole('toolbar', { name: 'Markdown 格式工具' })
    expect(editorToolbar.querySelector('.editor-toolbar-format')).toBeInTheDocument()
    expect(editorToolbar.querySelector('.editor-toolbar-actions')).toBeInTheDocument()
    expect(within(editorToolbar).getByRole('button', { name: '插入本地图片' })).toBeInTheDocument()
    expect(screen.queryByLabelText('大纲与工具')).not.toBeInTheDocument()
    expect(document.querySelector('.app-shell')).not.toHaveClass('has-inspector')

    await userEvent.click(button)
    const inspector = screen.getByLabelText('大纲与工具')
    expect(document.querySelector('.app-shell')).toHaveClass('has-inspector')
    expect(within(inspector).getByRole('region', { name: '大纲' })).toBeInTheDocument()
    expect(within(inspector).getByRole('tree', { name: '文档大纲树' })).toBeInTheDocument()

    await userEvent.click(button)
    expect(screen.queryByRole('tree', { name: '文档大纲树' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('大纲与工具')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '关闭右侧边栏' }))
    expect(screen.queryByLabelText('大纲与工具')).not.toBeInTheDocument()
    expect(document.querySelector('.app-shell')).not.toHaveClass('has-inspector')
  })

  it('shows a nested outline tree and jumps to a heading', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('markdown-editor'), {
      target: { value: '# Overview\n\n## Details\n\n### Detail' }
    })

    await userEvent.click(screen.getByRole('button', { name: '文档大纲' }))
    const tree = screen.getByRole('tree', { name: '文档大纲树' })
    expect(tree).toBeInTheDocument()
    expect(within(tree).getByRole('treeitem', { name: /Overview/ })).toHaveAttribute('aria-level', '1')
    expect(within(tree).getByRole('treeitem', { name: /Details/ })).toHaveAttribute('aria-level', '2')
    const treeItems = within(tree).getAllByRole('treeitem')
    expect(treeItems[2]).toHaveAttribute('aria-level', '3')
    expect(treeItems[2]).toHaveTextContent('Detail')
    expect(within(tree).getAllByRole('group').length).toBeGreaterThan(0)
    const detailButton = treeItems[2]
    await userEvent.click(detailButton)
    expect(screen.getByTestId('editor-position')).toHaveAttribute('data-position')
  })

  it('closes and reopens the right sidebar', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('markdown-editor'), {
      target: { value: '# Outline\n\n## Child' }
    })

    await userEvent.click(screen.getByRole('button', { name: '文档大纲' }))
    const inspector = screen.getByLabelText('大纲与工具')
    expect(inspector).toBeVisible()
    await userEvent.click(within(inspector).getByRole('button', { name: '关闭右侧边栏' }))
    expect(screen.queryByLabelText('大纲与工具')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '文档大纲' }))
    expect(screen.getByLabelText('大纲与工具')).toBeVisible()
  })

  it('auto-saves an existing document after the debounce', async () => {
    vi.useFakeTimers()
    api.openFile.mockResolvedValue({ path: '/tmp/auto.md', name: 'auto.md', content: '# old' })
    api.saveFile.mockResolvedValue({ path: '/tmp/auto.md', name: 'auto.md' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(screen.getByLabelText('markdown-editor'), { target: { value: '# new' } })
    await act(async () => {
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(api.saveFile).toHaveBeenCalledWith('/tmp/auto.md', '# new')
    vi.useRealTimers()
  })

  it('inserts a copied local image path', async () => {
    api.openFile.mockResolvedValue({ path: '/tmp/notes.md', name: 'notes.md', content: '' })
    api.selectImage.mockResolvedValue({ markdownPath: 'assets/picture.png', name: 'picture.png' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    fireEvent.click(screen.getByRole('button', { name: '插入本地图片' }))
    expect(await screen.findByLabelText('markdown-editor')).toHaveValue(
      '![picture.png](assets/picture.png)'
    )
  })

  it('adds and deletes persistent bookmarks and annotations', async () => {
    api.openFile.mockResolvedValue({ path: '/tmp/notes.md', name: 'notes.md', content: '# note' })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    await userEvent.click(screen.getByRole('button', { name: '书签和批注' }))
    await userEvent.click(screen.getByRole('button', { name: '添加书签' }))
    expect(screen.getAllByText('notes.md').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: /删除书签/ }))
    expect(screen.getByText('当前文档暂无书签')).toBeInTheDocument()
  })
})
