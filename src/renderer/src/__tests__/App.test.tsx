import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  openDroppedFile: vi.fn(),
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

  it('can hide and restore the sidebar', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '隐藏侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).toHaveClass('sidebar-hidden')

    await userEvent.click(screen.getByRole('button', { name: '显示侧边栏' }))
    expect(screen.getByLabelText('文档控制台').parentElement).not.toHaveClass('sidebar-hidden')
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
