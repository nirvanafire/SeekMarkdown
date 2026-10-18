import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuCommand, OpenedFile, SeerMarkdownApi } from '../../../shared/contracts'
import App from '../App'
import '../styles.css'

vi.mock('../components/CodeEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')

  return {
    default: forwardRef<
      { execute(action: string): void; focus(): void },
      { value: string; onChange: (value: string) => void }
    >(function MockCodeEditor({ value, onChange }, ref) {
      useImperativeHandle(
        ref,
        () => ({
          execute(action) {
            onChange(`${value}\n<!--${action}-->`)
          },
          focus() {}
        }),
        [onChange, value]
      )

      return (
        <textarea
          aria-label="markdown-editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    })
  }
})

vi.mock('../components/Preview', () => ({
  default: ({ content }: { content: string }) => <div data-testid="preview-text">{content}</div>
}))

const api = {
  openFile: vi.fn(),
  getFileInfo: vi.fn(),
  selectFiles: vi.fn(),
  openDroppedFile: vi.fn(),
  openFileByPath: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
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
    expect(screen.queryByTestId('preview-text')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }))
    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 打开的文档')
    })
    expect(screen.getByText('notes.md')).toBeInTheDocument()
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

  it('switches between split preview and preview-only mode', async () => {
    render(<App />)

    expect(screen.getByRole('switch', { name: '实时预览' })).toHaveAttribute('aria-checked', 'false')

    await userEvent.type(screen.getByLabelText('markdown-editor'), '# 预览内容')
    fireEvent.click(screen.getByRole('switch', { name: '实时预览' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-text')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('markdown-editor')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '预览模式' }))
    expect(screen.getByTestId('preview-text')).toBeInTheDocument()
    expect(screen.queryByLabelText('markdown-editor')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出预览' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: '退出预览' }))
    expect(screen.getByLabelText('markdown-editor')).toBeInTheDocument()
  })

  it('collapses and restores the sidebar icon rail', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).toHaveClass('sidebar-collapsed')
    expect(screen.getByLabelText('文档控制台')).toBeVisible()
    expect(screen.queryByText('格式')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开 Markdown 文件' })).toBeVisible()
    expect(screen.getByRole('button', { name: '预览模式' })).toBeVisible()
    expect(screen.queryByText('未打开文件')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).not.toHaveClass('sidebar-collapsed')
    expect(screen.getByText('格式')).toBeVisible()
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
