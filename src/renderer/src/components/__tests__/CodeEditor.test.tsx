import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import CodeEditor, { type CodeEditorHandle } from '../CodeEditor'

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
