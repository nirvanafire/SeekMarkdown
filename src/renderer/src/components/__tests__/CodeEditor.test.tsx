import { act, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import CodeEditor, { type CodeEditorHandle } from '../CodeEditor'

describe('CodeEditor unified rendering', () => {
  it('loads local image widgets through the restricted image bridge', async () => {
    const readLocalImage = vi.fn().mockResolvedValue('data:image/png;base64,dGVzdA==')
    Object.defineProperty(window, 'seerMarkdown', { value: { readLocalImage }, configurable: true })

    render(
      <CodeEditor value={'\n\n![Picture](./assets/picture.png)'} onChange={vi.fn()} documentPath="/tmp/document.md" />
    )

    await waitFor(() => {
      expect(document.querySelector('.unified-image-widget img')).toHaveAttribute(
        'src',
        'data:image/png;base64,dGVzdA=='
      )
    })
    expect(readLocalImage).toHaveBeenCalledWith('/tmp/document.md', './assets/picture.png')
  })

  it('renders markdown blocks as unified layout while preserving source mode', () => {
    const content = [
      '# Unified heading',
      '',
      '**Bold text** with [link](https://example.com).',
      '',
      '- [x] Completed task',
      '',
      '```ts',
      'const ready = true',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| Editor | Ready |',
      '',
      '![Image](./assets/picture.png)'
    ].join('\n')

    render(<CodeEditor value={content} onChange={vi.fn()} />)
    expect(document.querySelector('.code-editor--unified')).toBeInTheDocument()
    expect(document.querySelector('.cm-unified-heading')).toBeInTheDocument()
    expect(document.querySelector('.unified-code-widget code')?.textContent).toBe('const ready = true')
    expect(document.querySelector('.unified-table-widget')).toBeInTheDocument()
    expect(document.querySelector('.unified-task-checkbox')).toBeInTheDocument()
    expect(document.querySelector('.cm-content')?.textContent).not.toContain('](')
  })

  it('keeps raw markdown visible in source mode', () => {
    render(<CodeEditor value="# Source heading" onChange={vi.fn()} renderMode="source" />)
    expect(document.querySelector('.code-editor--source')).toBeInTheDocument()
    expect(document.querySelector('.cm-unified-heading')).not.toBeInTheDocument()
    expect(document.querySelector('.cm-line')?.textContent).toContain('# Source heading')
  })
})

describe('CodeEditor position', () => {
  it('clamps restored cursor and scroll positions', () => {
    const ref = createRef<CodeEditorHandle>()
    render(<CodeEditor ref={ref} value="12345" onChange={vi.fn()} />)

    act(() => {
      ref.current?.setPosition({
        cursor: 99,
        scrollRatio: 2
      })
    })

    const position = ref.current?.getPosition()
    expect(position?.cursor).toBe(5)
    expect(position?.scrollRatio).toBeGreaterThanOrEqual(0)
    expect(position?.scrollRatio).toBeLessThanOrEqual(1)
  })
})
