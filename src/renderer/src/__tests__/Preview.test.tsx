import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Preview from '../components/Preview'

describe('Preview', () => {
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
