import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { applyMarkdownAction, type EditorAction } from '../editor/markdownCommands'
import { defaultSearchOptions, type SearchOptions } from '../editor/search'
import {
  createUnifiedEditorExtensions,
  type UnifiedConfig
} from '../editor/unifiedDecorations'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  renderMode?: 'unified' | 'source'
  documentPath?: string
  searchQuery?: string
  searchOptions?: SearchOptions
  activeSearchRange?: { start: number; end: number } | null
  onScrollChange?: (progress: number, heading: string | null) => void
}

export interface EditorPosition {
  cursor: number
  scrollRatio: number
}

export interface EditorTextReplacement {
  from: number
  to: number
  text: string
}

export interface CodeEditorHandle {
  execute(action: EditorAction): void
  focus(): void
  setSelection(from: number, to?: number): void
  replaceRange(from: number, to: number, text: string, selectStart?: number, selectEnd?: number): void
  replaceAll(replacements: EditorTextReplacement[]): void
  insertText(text: string): void
  getPosition(): EditorPosition
  setPosition(position: EditorPosition | null): void
}

const syntaxStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3], color: '#a13d2c', fontWeight: 700 },
  { tag: [tags.emphasis, tags.strong], color: '#416b59' },
  { tag: [tags.link, tags.url], color: '#426b83' },
  { tag: tags.monospace, color: '#866231' },
  { tag: tags.comment, color: '#7c847e', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.atom], color: '#a84936' },
  { tag: [tags.string, tags.special(tags.string)], color: '#47735e' },
  { tag: tags.quote, color: '#5b665f', fontStyle: 'italic' },
  { tag: tags.list, color: '#a84936' }
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#f2efe8',
    color: '#2a332e'
  },
  '.cm-scroller': {
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: '14px',
    lineHeight: '1.8',
    padding: '22px 0 72px'
  },
  '.cm-content': {
    caretColor: '#b84432',
    paddingLeft: '22px',
    paddingRight: '28px'
  },
  '.cm-line': {
    padding: '0 4px 0 10px'
  },
  '.cm-gutters': {
    backgroundColor: '#e6e2da',
    color: '#858c86',
    borderRight: '1px solid rgba(104, 95, 81, 0.14)',
    userSelect: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 16px',
    minWidth: '44px'
  },
  '.cm-activeLine': {
    backgroundColor: '#eae6de'
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#ddd8cf',
    color: '#a6402f'
  },
  '&.cm-focused': {
    outline: 'none'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#cbd9d1'
  },
  '.cm-cursor': {
    borderLeftColor: '#b84432',
    borderLeftWidth: '2px'
  },
  '.cm-placeholder': {
    color: '#929891'
  }
})

function getCurrentHeading(view: EditorView): string | null {
  const firstVisibleLine = view.state.doc.lineAt(view.viewport.from).number
  for (let lineNumber = firstVisibleLine; lineNumber >= 1; lineNumber -= 1) {
    const line = view.state.doc.line(lineNumber)
    const heading = line.text.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/)
    if (heading) {
      return heading[1]
    }
  }
  return null
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    renderMode = 'unified',
    documentPath,
    searchQuery = '',
    searchOptions = defaultSearchOptions,
    activeSearchRange = null,
    onScrollChange
  },
  ref
): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialValueRef = useRef(value)
  const initialConfigRef = useRef<UnifiedConfig>({
    renderMode,
    documentPath,
    searchQuery,
    searchOptions,
    activeSearchRange
  })
  const unifiedExtensionRef = useRef(createUnifiedEditorExtensions(initialConfigRef.current))
  const onScrollChangeRef = useRef(onScrollChange)
  onScrollChangeRef.current = onScrollChange

  useImperativeHandle(
    ref,
    () => ({
      execute(action) {
        const view = viewRef.current
        if (!view) {
          return
        }

        if (action === 'undo' || action === 'redo') {
          view.focus()
          if (action === 'undo') {
            undo(view)
          } else {
            redo(view)
          }
          return
        }

        const selection = view.state.selection.main
        const edit = applyMarkdownAction(
          action,
          view.state.doc.toString(),
          selection.from,
          selection.to
        )
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: edit.text },
          selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
          userEvent: 'input'
        })
        view.focus()
      },
      focus() {
        viewRef.current?.focus()
      },
      setSelection(from, to = from) {
        const view = viewRef.current
        if (!view) {
          return
        }
        const start = Math.max(0, Math.min(from, view.state.doc.length))
        const end = Math.max(start, Math.min(to, view.state.doc.length))
        view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true })
        view.focus()
      },
      replaceRange(from, to, text, selectStart = from + text.length, selectEnd = selectStart) {
        const view = viewRef.current
        if (!view) {
          return
        }
        const start = Math.max(0, Math.min(from, view.state.doc.length))
        const end = Math.max(start, Math.min(to, view.state.doc.length))
        const nextLength = view.state.doc.length - (end - start) + text.length
        view.dispatch({
          changes: { from: start, to: end, insert: text },
          selection: {
            anchor: Math.max(0, Math.min(selectStart, nextLength)),
            head: Math.max(0, Math.min(selectEnd, nextLength))
          },
          userEvent: 'input'
        })
        view.focus()
      },
      replaceAll(replacements) {
        const view = viewRef.current
        if (!view || replacements.length === 0) {
          return
        }
        const ordered = [...replacements].sort((a, b) => a.from - b.from)
        view.dispatch({
          changes: ordered.map(({ from, to, text }) => ({ from, to, insert: text })),
          selection: { anchor: view.state.doc.length },
          userEvent: 'input'
        })
        view.focus()
      },
      insertText(text) {
        const view = viewRef.current
        if (!view) {
          return
        }
        const selection = view.state.selection.main
        const start = selection.from
        const end = selection.to
        const cursor = start + text.length
        view.dispatch({
          changes: { from: start, to: end, insert: text },
          selection: { anchor: cursor, head: cursor },
          userEvent: 'input'
        })
        view.focus()
      },
      getPosition() {
        const view = viewRef.current
        if (!view) {
          return { cursor: 0, scrollRatio: 0 }
        }

        const scroller = view.scrollDOM
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        return {
          cursor: view.state.selection.main.anchor,
          scrollRatio: maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0
        }
      },
      setPosition(position) {
        const view = viewRef.current
        if (!view) {
          return
        }

        const cursor = position
          ? Math.max(0, Math.min(position.cursor, view.state.doc.length))
          : 0
        const scrollRatio = position ? Math.max(0, Math.min(position.scrollRatio, 1)) : 0
        view.dispatch({
          selection: { anchor: cursor }
        })

        const scroller = view.scrollDOM
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        scroller.scrollTop = scrollRatio * maxScrollTop
        window.requestAnimationFrame(() => {
          const nextMaxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          const progress = nextMaxScrollTop > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / nextMaxScrollTop)) : 1
          onScrollChangeRef.current?.(progress, getCurrentHeading(view))
        })
      }
    }),
    []
  )

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const notifyScroll = () => {
      const currentView = viewRef.current
      if (!currentView) {
        return
      }
      const scroller = currentView.scrollDOM
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const progress = maxScrollTop > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScrollTop)) : 1
      onScrollChangeRef.current?.(progress, getCurrentHeading(currentView))
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(syntaxStyle),
          editorTheme,
          unifiedExtensionRef.current.extensions,
          EditorView.lineWrapping,
          placeholder('从这里开始书写 Markdown…'),
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown 内容编辑区',
            spellcheck: 'false'
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString())
            }
          })
        ]
      })
    })

    viewRef.current = view
    view.scrollDOM.addEventListener('scroll', notifyScroll, { passive: true })
    window.requestAnimationFrame(notifyScroll)

    return () => {
      view.scrollDOM.removeEventListener('scroll', notifyScroll)
      view.destroy()
      viewRef.current = null
    }
  }, [onChange])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    unifiedExtensionRef.current.update(view, {
      renderMode,
      documentPath,
      searchQuery,
      searchOptions,
      activeSearchRange
    })
  }, [activeSearchRange, documentPath, renderMode, searchOptions, searchQuery])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (value === currentValue) {
      return
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) }
    })
    window.requestAnimationFrame(() => {
      const scroller = view.scrollDOM
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const progress = maxScrollTop > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScrollTop)) : 1
      onScrollChangeRef.current?.(progress, getCurrentHeading(view))
    })
  }, [value])

  return (
    <div
      ref={hostRef}
      className={`code-editor code-editor--${renderMode}`}
    />
  )
})

export default CodeEditor
