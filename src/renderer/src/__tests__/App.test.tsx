import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuCommand, OpenedFile, SeerMarkdownApi } from '../../../shared/contracts'
import App from '../App'

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

  it('opens a file from the empty state and loads its content', async () => {
    const openedFile: OpenedFile = {
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 打开的文档'
    }
    api.openFile.mockResolvedValue(openedFile)
    render(<App />)

    const emptyState = screen.getByText('LOCAL MARKDOWN WORKBENCH').closest('.empty-state') as HTMLElement
    await userEvent.click(within(emptyState).getByRole('button', { name: '打开 Markdown 文件' }))

    await waitFor(() => {
      expect(screen.getByLabelText('markdown-editor')).toHaveValue('# 打开的文档')
    })
    expect(screen.getByTestId('preview-text')).toHaveTextContent('# 打开的文档')
    expect(screen.getAllByText('notes.md').length).toBeGreaterThan(0)
  })

  it('toggles preview and routes Markdown shortcuts through the editor handle', async () => {
    api.openFile.mockResolvedValue({
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 原始内容'
    })
    render(<App />)

    const emptyState = screen.getByText('LOCAL MARKDOWN WORKBENCH').closest('.empty-state') as HTMLElement
    await userEvent.click(within(emptyState).getByRole('button', { name: '打开 Markdown 文件' }))
    const editor = await screen.findByLabelText('markdown-editor')

    expect(screen.getByRole('switch', { name: '实时预览' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('preview-text')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '二级标题' }))
    expect(editor).toHaveValue('# 原始内容\n<!--heading2-->')

    await userEvent.click(screen.getByRole('switch', { name: '实时预览' }))
    expect(screen.queryByTestId('preview-text')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Markdown 预览')).not.toBeInTheDocument()
  })

  it('tracks dirty state and saves through the file bridge', async () => {
    api.openFile.mockResolvedValue({
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 原始内容'
    })
    api.saveFile.mockResolvedValue({ path: '/tmp/notes.md', name: 'notes.md' })
    render(<App />)

    const emptyState = screen.getByText('LOCAL MARKDOWN WORKBENCH').closest('.empty-state') as HTMLElement
    await userEvent.click(within(emptyState).getByRole('button', { name: '打开 Markdown 文件' }))
    const editor = await screen.findByLabelText('markdown-editor')

    await userEvent.clear(editor)
    await userEvent.type(editor, '# 修改后的内容')
    expect(screen.getAllByText('未保存').length).toBeGreaterThan(0)
    expect(api.setDirty).toHaveBeenLastCalledWith(true)

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(api.saveFile).toHaveBeenCalledWith('/tmp/notes.md', '# 修改后的内容')
    })
    await waitFor(() => {
      expect(screen.getAllByText('已保存').length).toBeGreaterThan(0)
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
    api.openFile.mockResolvedValue({
      path: '/tmp/notes.md',
      name: 'notes.md',
      content: '# 原始内容'
    })
    let closeListener = () => undefined
    api.onCloseRequested.mockImplementation((listener) => {
      closeListener = listener
      return () => undefined
    })

    render(<App />)
    const emptyState = screen.getByText('LOCAL MARKDOWN WORKBENCH').closest('.empty-state') as HTMLElement
    await userEvent.click(within(emptyState).getByRole('button', { name: '打开 Markdown 文件' }))
    const editor = await screen.findByLabelText('markdown-editor')
    await userEvent.type(editor, ' 修改')

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
