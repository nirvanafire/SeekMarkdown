import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Preview from '../components/Preview'

describe('Preview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders common Markdown and GFM structures', () => {
    const content = [
      '# 项目说明',
      '',
      '- 第一项',
      '- [x] 已完成',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 编辑器 | 可用 |',
      '',
      '```ts',
      'const ready = true',
      '```'
    ].join('\n')

    const { container } = render(<Preview content={content} />)

    expect(screen.getByRole('heading', { level: 1, name: '项目说明' })).toBeInTheDocument()
    expect(screen.getByText('第一项')).toBeInTheDocument()
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelector('pre code')).toHaveTextContent('const ready = true')
  })

  it('sanitizes active HTML and unsafe links', () => {
    const content = [
      '<script>window.compromised = true</script>',
      '<img src="x" onerror="window.compromised = true">',
      '',
      '[bad](javascript:alert(1))',
      '[good](https://example.com)'
    ].join('\n')

    const { container } = render(<Preview content={content} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.getByText('bad')).toHaveClass('unsafe-link')

    const safeLink = screen.getByRole('link', { name: 'good' })
    expect(safeLink).toHaveAttribute('href', 'https://example.com')
    expect(safeLink).toHaveAttribute('target', '_blank')
    expect(safeLink).toHaveAttribute('rel', 'noreferrer noopener')
    expect('compromised' in window).toBe(false)
  })

  it('does not render unsupported local images as active resources', () => {
    const { container } = render(<Preview content="![本地图片](./private.png)" />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/图片不可用/)).toBeInTheDocument()
  })
})


  it('loads local images only through the restricted document bridge', async () => {
    const readLocalImage = vi.fn().mockResolvedValue('data:image/png;base64,dGVzdA==')
    Object.defineProperty(window, 'seerMarkdown', {
      value: { readLocalImage },
      configurable: true
    })

    const { container } = render(
      <Preview
        content="![本地图片](./assets/picture.png)"
        documentPath="/tmp/document.md"
      />
    )

    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,dGVzdA==')
    })
    expect(readLocalImage).toHaveBeenCalledWith('/tmp/document.md', './assets/picture.png')
  })

  it('highlights search results and saved annotations', () => {
    const { container } = render(
      <Preview
        content="needle and needle"
        searchTerm="needle"
        searchOptions={{ caseSensitive: false, wholeWord: false, regex: false }}
        activeSearchIndex={0}
        annotations={[{ id: 'annotation-1', quote: 'needle', note: 'note' }]}
      />
    )

    expect(container.querySelectorAll('mark.search-hit')).toHaveLength(2)
    expect(container.querySelector('mark.search-hit')).toHaveClass('is-active')
    expect(container.querySelector('mark.annotation-mark')).toBeInTheDocument()
  })
