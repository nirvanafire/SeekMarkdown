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

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
}

export interface CodeEditorHandle {
  execute(action: EditorAction): void
  focus(): void
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

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange },
  ref
): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialValueRef = useRef(value)

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
      }
    }),
    []
  )

  useEffect(() => {
    if (!hostRef.current) {
      return
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
          EditorView.lineWrapping,
          placeholder('从这里开始书写 Markdown…'),
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown 源码编辑器',
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
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [onChange])

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
  }, [value])

  return <div ref={hostRef} className="code-editor" />
})

export default CodeEditor
