import { describe, expect, it } from 'vitest'
import { applyMarkdownAction } from '../markdownCommands'

describe('applyMarkdownAction', () => {
  it('adds, changes, and removes headings', () => {
    expect(applyMarkdownAction('heading2', '标题', 0, 2)).toEqual({
      text: '## 标题',
      selectionStart: 3,
      selectionEnd: 5
    })

    expect(applyMarkdownAction('heading3', '# 标题', 0, 5).text).toBe('### 标题')
    expect(applyMarkdownAction('heading2', '## 标题', 0, 5).text).toBe('标题')
  })

  it('wraps selections and inserts placeholders', () => {
    expect(applyMarkdownAction('bold', 'hello', 0, 5)).toEqual({
      text: '**hello**',
      selectionStart: 2,
      selectionEnd: 7
    })

    expect(applyMarkdownAction('italic', 'text', 0, 4).text).toBe('*text*')
    expect(applyMarkdownAction('inlineCode', 'value', 0, 5).text).toBe('`value`')
    expect(applyMarkdownAction('link', '文档', 0, 2).text).toBe('[文档](https://example.com)')
    expect(applyMarkdownAction('bold', '', 0, 0).text).toBe('**粗体文本**')
  })

  it('toggles list and quote prefixes over multiple lines', () => {
    const source = '第一项\n第二项'

    const bullets = applyMarkdownAction('bulletList', source, 0, source.length)
    expect(bullets.text).toBe('- 第一项\n- 第二项')
    expect(applyMarkdownAction('bulletList', bullets.text, 0, bullets.text.length).text).toBe(source)

    expect(applyMarkdownAction('orderedList', source, 0, source.length).text).toBe('1. 第一项\n2. 第二项')
    expect(applyMarkdownAction('taskList', source, 0, source.length).text).toBe('- [ ] 第一项\n- [ ] 第二项')
    expect(applyMarkdownAction('quote', source, 0, source.length).text).toBe('> 第一项\n> 第二项')
  })

  it('inserts code blocks with a useful selection range', () => {
    const empty = applyMarkdownAction('codeBlock', '', 0, 0)
    expect(empty.text).toBe('```\n\n```')
    expect(empty.selectionStart).toBe(4)
    expect(empty.selectionEnd).toBe(4)

    const selected = applyMarkdownAction('codeBlock', 'const value = 1', 0, 15)
    expect(selected.text).toBe('```\nconst value = 1\n```')
    expect(selected.text.slice(selected.selectionStart, selected.selectionEnd)).toBe('const value = 1')
  })

  it('inserts tables and horizontal rules with surrounding line breaks', () => {
    const table = applyMarkdownAction('table', '正文', 2, 2)
    expect(table.text).toContain('正文\n\n| 列 1 | 列 2 |')
    expect(table.text).toContain('| --- | --- |')

    const rule = applyMarkdownAction('horizontalRule', '正文', 2, 2)
    expect(rule.text).toBe('正文\n\n---')
  })
})
