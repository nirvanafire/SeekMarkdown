import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NeuButton, NeuIconButton, NeuPanel, NeuStatus, NeuToggle } from '..'

describe('Neumorphism primitives', () => {
  it('renders button variants and press state', () => {
    const onClick = vi.fn()
    render(
      <NeuButton variant="primary" pressed onClick={onClick}>
        保存
      </NeuButton>
    )

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveClass('neu-button--primary', 'is-pressed')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps icon buttons accessible and titles their intent', () => {
    render(
      <NeuIconButton label="打开 Markdown 文件" title="打开 Markdown 文件">
        <svg aria-hidden="true" />
      </NeuIconButton>
    )

    const button = screen.getByRole('button', { name: '打开 Markdown 文件' })
    expect(button).toHaveAttribute('title', '打开 Markdown 文件')
    expect(button).toHaveClass('neu-icon-button')
  })

  it('renders panel surface levels', () => {
    render(
      <NeuPanel surface="inset" className="fixture-panel">
        <span>面板内容</span>
      </NeuPanel>
    )

    const panel = screen.getByText('面板内容').parentElement as HTMLElement
    expect(panel).toHaveClass('neu-panel--inset', 'fixture-panel')
  })

  it('renders status tones with visible labels', () => {
    render(<NeuStatus tone="dirty" label="未保存" />)

    expect(screen.getByText('未保存')).toBeInTheDocument()
    expect(screen.getByText('未保存').parentElement).toHaveClass('neu-status--dirty')
    expect(screen.getByText('未保存').parentElement).toHaveAttribute('data-tone', 'dirty')
  })
})

describe('NeuToggle', () => {
  it('reports checked changes and supports disabled state', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <NeuToggle checked={false} onCheckedChange={onCheckedChange} label="实时预览" />
    )

    const toggle = screen.getByRole('switch', { name: '实时预览' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    rerender(
      <NeuToggle checked disabled onCheckedChange={onCheckedChange} label="实时预览" />
    )
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toBeDisabled()
  })
})
