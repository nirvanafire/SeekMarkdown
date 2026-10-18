export type MarkdownAction =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'
  | 'table'
  | 'horizontalRule'

export type EditorAction = MarkdownAction | 'undo' | 'redo'

export interface MarkdownEdit {
  text: string
  selectionStart: number
  selectionEnd: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function replaceRange(
  text: string,
  from: number,
  to: number,
  replacement: string,
  selectionStart = from + replacement.length,
  selectionEnd = selectionStart
): MarkdownEdit {
  return {
    text: `${text.slice(0, from)}${replacement}${text.slice(to)}`,
    selectionStart: clamp(selectionStart, 0, text.length - (to - from) + replacement.length),
    selectionEnd: clamp(selectionEnd, 0, text.length - (to - from) + replacement.length)
  }
}

function getLineStart(text: string, position: number): number {
  return text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
}

function getLineEnd(text: string, position: number): number {
  const end = text.indexOf('\n', position)
  return end === -1 ? text.length : end
}

function wrapSelection(
  text: string,
  from: number,
  to: number,
  before: string,
  after: string,
  placeholder: string
): MarkdownEdit {
  const selected = text.slice(from, to) || placeholder
  const selectionStart = from + before.length
  return replaceRange(
    text,
    from,
    to,
    `${before}${selected}${after}`,
    selectionStart,
    selectionStart + selected.length
  )
}

function applyHeading(
  text: string,
  from: number,
  to: number,
  level: 1 | 2 | 3
): MarkdownEdit {
  const start = getLineStart(text, from)
  const end = getLineEnd(text, to)
  const line = text.slice(start, end)
  const indentation = line.match(/^\s*/)?.[0] ?? ''
  const content = line.slice(indentation.length).replace(/^#{1,6}\s+/, '')
  const isSameHeading = new RegExp(`^\\s*#{${level}}\\s+`).test(line)
  const marker = isSameHeading ? '' : `${'#'.repeat(level)} `
  const replacement = `${indentation}${marker}${content}`
  const selectionStart = start + indentation.length + marker.length

  return replaceRange(
    text,
    start,
    end,
    replacement,
    selectionStart,
    selectionStart + content.length
  )
}

type PrefixKind = 'bulletList' | 'orderedList' | 'taskList' | 'quote'

function stripPrefix(line: string, kind: PrefixKind): string {
  if (kind === 'quote') {
    return line.replace(/^\s*>\s?/, '')
  }

  return line.replace(/^\s*(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
}

function hasPrefix(line: string, kind: PrefixKind): boolean {
  if (kind === 'quote') {
    return /^\s*>\s?/.test(line)
  }

  return /^\s*(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/.test(line)
}

function applyLinePrefix(
  text: string,
  from: number,
  to: number,
  kind: PrefixKind
): MarkdownEdit {
  const start = getLineStart(text, from)
  const end = getLineEnd(text, to)
  const block = text.slice(start, end)
  const lines = block.split('\n')
  const shouldRemove = lines.every((line) => hasPrefix(line, kind))

  const nextLines = lines.map((line, index) => {
    const content = stripPrefix(line, kind)
    if (shouldRemove) {
      return content
    }

    if (kind === 'orderedList') {
      return `${index + 1}. ${content}`
    }

    if (kind === 'taskList') {
      return `- [ ] ${content}`
    }

    return kind === 'quote' ? `> ${content}` : `- ${content}`
  })

  const replacement = nextLines.join('\n')
  return replaceRange(text, start, end, replacement, start, start + replacement.length)
}

function applyCodeBlock(text: string, from: number, to: number): MarkdownEdit {
  const selected = text.slice(from, to)
  const prefix = from > 0 && text[from - 1] !== '\n' ? '\n\n' : ''
  const suffix = to < text.length && text[to] !== '\n' ? '\n\n' : ''
  const replacement = `${prefix}\`\`\`\n${selected}\n\`\`\`${suffix}`
  const selectionStart = from + prefix.length + 4

  return replaceRange(
    text,
    from,
    to,
    replacement,
    selectionStart,
    selectionStart + selected.length
  )
}

function applyTable(text: string, from: number, to: number): MarkdownEdit {
  const prefix = from > 0 && text[from - 1] !== '\n' ? '\n\n' : ''
  const suffix = to < text.length && text[to] !== '\n' ? '\n\n' : ''
  const table = '| 列 1 | 列 2 |\n| --- | --- |\n|      |      |'
  const replacement = `${prefix}${table}${suffix}`
  const selectionStart = from + replacement.length

  return replaceRange(text, from, to, replacement, selectionStart, selectionStart)
}

function applyHorizontalRule(text: string, from: number, to: number): MarkdownEdit {
  const prefix = from > 0 && text[from - 1] !== '\n' ? '\n\n' : ''
  const suffix = to < text.length && text[to] !== '\n' ? '\n\n' : ''
  const replacement = `${prefix}---${suffix}`

  return replaceRange(text, from, to, replacement)
}

export function applyMarkdownAction(
  action: MarkdownAction,
  text: string,
  from: number,
  to: number
): MarkdownEdit {
  const start = clamp(Math.min(from, to), 0, text.length)
  const end = clamp(Math.max(from, to), 0, text.length)

  switch (action) {
    case 'heading1':
      return applyHeading(text, start, end, 1)
    case 'heading2':
      return applyHeading(text, start, end, 2)
    case 'heading3':
      return applyHeading(text, start, end, 3)
    case 'bold':
      return wrapSelection(text, start, end, '**', '**', '粗体文本')
    case 'italic':
      return wrapSelection(text, start, end, '*', '*', '斜体文本')
    case 'inlineCode':
      return wrapSelection(text, start, end, '`', '`', '代码')
    case 'link':
      return wrapSelection(text, start, end, '[', '](https://example.com)', '链接文字')
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
    case 'quote':
      return applyLinePrefix(text, start, end, action)
    case 'codeBlock':
      return applyCodeBlock(text, start, end)
    case 'table':
      return applyTable(text, start, end)
    case 'horizontalRule':
      return applyHorizontalRule(text, start, end)
  }
}
