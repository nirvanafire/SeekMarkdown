import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Line,
  type Range
} from '@codemirror/state'
import type { SearchOptions } from './search'
import { findSearchMatches } from './search'

export interface UnifiedConfig {
  renderMode: 'unified' | 'source'
  documentPath?: string
  searchQuery: string
  searchOptions: SearchOptions
  activeSearchRange: { start: number; end: number } | null
}

interface BlockRange {
  from: number
  to: number
}

interface DecorationsResult {
  decorations: Array<Range<Decoration>>
  blocks: BlockRange[]
}

interface TableData {
  rows: string[][]
  from: number
  to: number
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function intersectsSelection(state: EditorState, from: number, to: number): boolean {
  const selection = state.selection.main
  return selection.from <= to && selection.to >= from
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly position: number
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked && this.position === other.position
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('span')
    checkbox.className = `unified-task-checkbox${this.checked ? ' is-checked' : ''}`
    checkbox.textContent = this.checked ? '✓' : ''
    checkbox.setAttribute('role', 'checkbox')
    checkbox.setAttribute('aria-checked', String(this.checked))
    checkbox.addEventListener('click', (event) => {
      event.preventDefault()
      view.dispatch({
        changes: { from: this.position, to: this.position + 1, insert: this.checked ? ' ' : 'x' },
        selection: { anchor: this.position },
        userEvent: 'input'
      })
      view.focus()
    })
    return checkbox
  }

  ignoreEvent(): boolean {
    return false
  }
}

class TableWidget extends WidgetType {
  constructor(private readonly rows: string[][]) {
    super()
  }

  eq(other: TableWidget): boolean {
    return JSON.stringify(this.rows) === JSON.stringify(other.rows)
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'unified-table-widget'
    wrapper.contentEditable = 'false'

    const table = document.createElement('table')
    this.rows.forEach((cells, rowIndex) => {
      const row = document.createElement('tr')
      cells.forEach((cell) => {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td')
        element.textContent = cell
        row.append(element)
      })
      table.append(row)
    })

    wrapper.append(table)
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrapper) } })
      view.focus()
    })
    return wrapper
  }

  ignoreEvent(): boolean {
    return false
  }
}

class CodeBlockWidget extends WidgetType {
  constructor(private readonly text: string, private readonly language: string) {
    super()
  }

  eq(other: CodeBlockWidget): boolean {
    return this.text === other.text && this.language === other.language
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'unified-code-widget'
    wrapper.contentEditable = 'false'
    if (this.language) {
      wrapper.dataset.language = this.language
    }

    const code = document.createElement('code')
    code.textContent = this.text
    wrapper.append(code)
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrapper) } })
      view.focus()
    })
    return wrapper
  }

  ignoreEvent(): boolean {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
    private readonly documentPath?: string
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      this.source === other.source &&
      this.alt === other.alt &&
      this.documentPath === other.documentPath
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('figure')
    wrapper.className = 'unified-image-widget'
    wrapper.contentEditable = 'false'

    const image = document.createElement('img')
    image.alt = this.alt
    image.loading = 'lazy'
    image.addEventListener('error', () => {
      wrapper.classList.add('has-error')
      image.remove()
      const fallback = document.createElement('span')
      fallback.className = 'unified-image-error'
      fallback.textContent = `图片不可用：${this.alt || this.source}`
      wrapper.append(fallback)
    })

    if (isHttpUrl(this.source)) {
      image.src = this.source
    } else if (this.documentPath) {
      void window.seerMarkdown
        .readLocalImage(this.documentPath, this.source)
        .then((dataUrl) => {
          if (dataUrl) {
            image.src = dataUrl
          } else {
            image.dispatchEvent(new Event('error'))
          }
        })
        .catch(() => image.dispatchEvent(new Event('error')))
    } else {
      image.dispatchEvent(new Event('error'))
    }

    wrapper.append(image)
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrapper) } })
      view.focus()
    })
    return wrapper
  }

  ignoreEvent(): boolean {
    return false
  }
}

function parseTable(lines: Array<{ text: string; from: number; to: number }>): TableData | null {
  if (lines.length < 3) {
    return null
  }

  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())

  const header = cells(lines[0].text)
  const delimiter = cells(lines[1].text)
  if (header.length < 1 || header.length !== delimiter.length || !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return null
  }

  return {
    rows: [header, ...lines.slice(2).map((line) => cells(line.text))],
    from: lines[0].from,
    to: lines[lines.length - 1].to
  }
}

function addInlineDecorations(
  state: EditorState,
  line: Line,
  result: DecorationsResult
): void {
  const inlinePattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)|(?<!_)_(?!_)([^_\n]+)_(?!_)/gu
  let match: RegExpExecArray | null

  while ((match = inlinePattern.exec(line.text))) {
    const start = line.from + match.index
    const end = start + match[0].length
    if (intersectsSelection(state, start, end)) {
      continue
    }

    if (match[5] !== undefined && match[6] !== undefined) {
      result.decorations.push(
        Decoration.replace({ inclusive: true }).range(start, start + 1),
        Decoration.replace({ inclusive: true }).range(start + match[5].length + 1, end)
      )
      continue
    }

    const markerLength = match[0].startsWith('~~') || match[0].startsWith('**') || match[0].startsWith('__') ? 2 : 1
    result.decorations.push(
      Decoration.replace({ inclusive: true }).range(start, start + markerLength),
      Decoration.replace({ inclusive: true }).range(end - markerLength, end)
    )
  }
}

function buildDecorations(state: EditorState, config: UnifiedConfig): DecorationSet {
  if (config.renderMode === 'source') {
    return Decoration.none
  }

  const result: DecorationsResult = { decorations: [], blocks: [] }
  const totalLines = state.doc.lines
  let fence: { marker: string; length: number } | null = null
  let codeFrom = 0
  let codeLanguage = ''

  for (let lineNumber = 1; lineNumber <= totalLines; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const fenceMatch = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      if (!fence) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length }
        codeFrom = line.from
        codeLanguage = fenceMatch[2].trim()
        result.decorations.push(Decoration.line({ class: 'cm-unified-code-fence' }).range(line.from))
        if (!intersectsSelection(state, line.from, line.to)) {
          result.decorations.push(
            Decoration.replace({ inclusive: true }).range(line.from, line.to)
          )
        }
      } else if (fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length) {
        const blockTo = line.to
        const fencedText = state.sliceDoc(codeFrom, blockTo)
        const text = fencedText.split('\n').slice(1, -1).join('\n')
        if (!intersectsSelection(state, codeFrom, blockTo)) {
          result.decorations.push(
            Decoration.replace({
              widget: new CodeBlockWidget(text, codeLanguage),
              block: true,
              inclusive: false
            }).range(codeFrom, blockTo)
          )
        } else {
          result.decorations.push(Decoration.line({ class: 'cm-unified-code-fence' }).range(line.from))
        }
        fence = null
      }
      continue
    }

    if (fence) {
      result.decorations.push(Decoration.line({ class: 'cm-unified-code-line' }).range(line.from))
      continue
    }

    const tableLines: Array<{ text: string; from: number; to: number }> = []
    if (line.text.includes('|')) {
      let cursor = lineNumber
      while (cursor <= totalLines) {
        const candidate = state.doc.line(cursor)
        if (!candidate.text.includes('|')) {
          break
        }
        tableLines.push(candidate)
        cursor += 1
      }

      const table = parseTable(tableLines)
      if (table) {
        if (!intersectsSelection(state, table.from, table.to)) {
          result.decorations.push(
            Decoration.replace({
              widget: new TableWidget(table.rows),
              block: true,
              inclusive: false
            }).range(table.from, table.to)
          )
        } else {
          for (const tableLine of tableLines) {
            result.decorations.push(Decoration.line({ class: 'cm-unified-table-source' }).range(tableLine.from))
          }
        }
        lineNumber = cursor - 1
        continue
      }
    }

    const imageMatch = line.text.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (imageMatch) {
      if (!intersectsSelection(state, line.from, line.to)) {
        result.decorations.push(
          Decoration.replace({
            widget: new ImageWidget(imageMatch[2], imageMatch[1], config.documentPath),
            block: true,
            inclusive: false
          }).range(line.from, line.to)
        )
      } else {
        result.decorations.push(Decoration.line({ class: 'cm-unified-image-source' }).range(line.from))
      }
      continue
    }

    const heading = line.text.match(/^( {0,3})(#{1,6})( +)(.*)$/)
    if (heading) {
      const level = heading[2].length
      const active = intersectsSelection(state, line.from, line.to)
      result.decorations.push(
        Decoration.line({ class: `cm-unified-heading cm-unified-h${level}` }).range(line.from)
      )
      if (!active) {
        const markerEnd = line.from + heading[1].length + heading[2].length + heading[3].length
        result.decorations.push(Decoration.replace({ inclusive: true }).range(line.from + heading[1].length, markerEnd))
        const closing = heading[4].match(/^(.*?)( {1,3}#+)?$/)
        if (closing?.[2]) {
          result.decorations.push(
            Decoration.replace({ inclusive: true }).range(markerEnd + closing[1].length, line.to)
          )
        }
      }
      addInlineDecorations(state, line, result)
      continue
    }

    const quote = line.text.match(/^( {0,3})>( ?)/)
    if (quote) {
      const active = intersectsSelection(state, line.from, line.to)
      result.decorations.push(Decoration.line({ class: 'cm-unified-quote' }).range(line.from))
      if (!active) {
        result.decorations.push(
          Decoration.replace({ inclusive: true }).range(line.from, line.from + quote[0].length)
        )
      }
      addInlineDecorations(state, line, result)
      continue
    }

    const list = line.text.match(/^( *)([-+*]|\d+[.)])( +)(?:\[([ xX])\]( +))?(.*)$/)
    if (list) {
      const active = intersectsSelection(state, line.from, line.to)
      const indent = list[1].length
      const markerEnd = indent + list[2].length + list[3].length
      const taskTextEnd = list[4] ? markerEnd + 4 : markerEnd
      const taskTogglePosition = line.from + markerEnd + 1
      result.decorations.push(
        Decoration.line({ class: list[4] ? 'cm-unified-task cm-unified-list' : 'cm-unified-list' }).range(line.from)
      )
      if (!active) {
        result.decorations.push(Decoration.replace({ inclusive: true }).range(line.from + indent, line.from + markerEnd))
        if (list[4]) {
          result.decorations.push(
            Decoration.replace({ inclusive: true }).range(line.from + markerEnd, line.from + taskTextEnd)
          )
          result.decorations.push(
            Decoration.widget({
              widget: new TaskCheckboxWidget(list[4].toLowerCase() === 'x', taskTogglePosition),
              side: -1
            }).range(line.from + indent)
          )
        }
      }
      addInlineDecorations(state, line, result)
      continue
    }

    result.decorations.push(Decoration.line({ class: 'cm-unified-paragraph' }).range(line.from))
    addInlineDecorations(state, line, result)
  }

  if (config.searchQuery) {
    for (const match of findSearchMatches(state.doc.toString(), config.searchQuery, config.searchOptions)) {
      result.decorations.push(
        Decoration.mark({
          class: `cm-unified-search-hit${
            config.activeSearchRange &&
            config.activeSearchRange.start === match.start &&
            config.activeSearchRange.end === match.end
              ? ' is-active'
              : ''
          }`
        }).range(match.start, match.end)
      )
    }
  }

  result.decorations.sort((a, b) => a.from - b.from)
  return Decoration.set(result.decorations, true)
}

export function createUnifiedEditorExtensions(initial: UnifiedConfig): {
  extensions: Extension[]
  update(view: EditorView, config: UnifiedConfig): void
} {
  const configEffect = StateEffect.define<UnifiedConfig>()
  const configField = StateField.define<UnifiedConfig>({
    create: () => initial,
    update(value, transaction) {
      const effect = transaction.effects.find((candidate) => candidate.is(configEffect))
      return effect ? effect.value : value
    }
  })

  const decorationField = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, initial),
    update(value, transaction) {
      const effect = transaction.effects.find((candidate) => candidate.is(configEffect))
      if (!transaction.docChanged && !effect) {
        return value
      }
      return buildDecorations(transaction.state, effect?.value ?? transaction.state.field(configField))
    },
    provide: (field) => EditorView.decorations.from(field)
  })

  return {
    extensions: [configField, decorationField],
    update: (view, config) => {
      view.dispatch({ effects: configEffect.of(config) })
    }
  }
}
