import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { SearchOptions } from '../editor/search'
import { createSearchRegex } from '../editor/search'
import { extractMarkdownOutline } from '../lib/markdownOutline'

export interface PreviewAnnotation {
  id: string
  quote: string
  note: string
}

interface PreviewProps {
  content: string
  documentPath?: string
  searchTerm?: string
  searchOptions?: SearchOptions
  activeSearchIndex?: number
  annotations?: PreviewAnnotation[]
  onReadingProgress?: (progress: number, heading: string | null) => void
}

function isSafeWebUrl(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function PreviewLink({
  href,
  children
}: {
  href?: string
  children?: ReactNode
}): JSX.Element {
  if (!isSafeWebUrl(href)) {
    return <span className="unsafe-link">{children}</span>
  }

  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

function PreviewImage({
  src,
  alt,
  documentPath
}: {
  src?: string
  alt?: string
  documentPath?: string
}): JSX.Element {
  const [resolvedSource, setResolvedSource] = useState<string | null>(
    isSafeWebUrl(src) ? src ?? null : null
  )

  useEffect(() => {
    if (!src || isSafeWebUrl(src)) {
      setResolvedSource(src ?? null)
      return
    }

    let cancelled = false
    setResolvedSource(null)
    if (!documentPath) {
      return
    }

    void window.seerMarkdown
      .readLocalImage(documentPath, src)
      .then((dataUrl) => {
        if (!cancelled) {
          setResolvedSource(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSource(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [documentPath, src])

  if (!resolvedSource) {
    return <span className="image-fallback">图片不可用：{alt || '本地资源'}</span>
  }

  return <img src={resolvedSource} alt={alt ?? ''} loading="lazy" />
}

function unwrapMarks(root: HTMLElement): void {
  root.querySelectorAll('mark[data-preview-mark]').forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) {
      return
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark)
    }
    parent.removeChild(mark)
    parent.normalize()
  })
}

function wrapTextMatches(
  root: HTMLElement,
  expression: RegExp | null,
  className: string,
  activeIndex: number
): void {
  if (!expression) {
    return
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    if (node.textContent?.trim()) {
      textNodes.push(node as Text)
    }
    node = walker.nextNode()
  }

  let matchIndex = 0
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ''
    expression.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let match = expression.exec(text)

    while (match) {
      const start = match.index
      const end = start + match[0].length
      if (end === start) {
        expression.lastIndex += 1
        match = expression.exec(text)
        continue
      }

      if (start > cursor) {
        fragment.append(text.slice(cursor, start))
      }
      const mark = document.createElement('mark')
      mark.dataset.previewMark = className
      mark.className = `${className}${matchIndex === activeIndex ? ' is-active' : ''}`
      mark.textContent = match[0]
      fragment.append(mark)
      cursor = end
      matchIndex += 1
      match = expression.exec(text)
    }

    if (cursor < text.length) {
      fragment.append(text.slice(cursor))
    }
    if (cursor > 0 || matchIndex > 0) {
      textNode.replaceWith(fragment)
    }
  }
}

function Preview({
  content,
  documentPath,
  searchTerm = '',
  searchOptions,
  activeSearchIndex = -1,
  annotations = [],
  onReadingProgress
}: PreviewProps): JSX.Element {
  const articleRef = useRef<HTMLElement | null>(null)
  const outline = useMemo(() => extractMarkdownOutline(content), [content])

  useEffect(() => {
    const article = articleRef.current
    if (!article) {
      return
    }

    unwrapMarks(article)
    for (const annotation of annotations) {
      if (!annotation.quote) {
        continue
      }
      wrapTextMatches(
        article,
        new RegExp(annotation.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'),
        'annotation-mark',
        -1
      )
    }

    if (searchTerm && searchOptions) {
      wrapTextMatches(article, createSearchRegex(searchTerm, searchOptions), 'search-hit', activeSearchIndex)
    }

    const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    headings.forEach((heading, index) => {
      heading.id = outline[index]?.id ?? `markdown-heading-${index + 1}`
    })
  }, [activeSearchIndex, annotations, content, outline, searchOptions, searchTerm])

  const handleScroll = (event: UIEvent<HTMLElement>) => {
    if (!onReadingProgress) {
      return
    }

    const container = event.currentTarget
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const progress = maxScrollTop > 0 ? Math.min(1, Math.max(0, container.scrollTop / maxScrollTop)) : 1
    let currentHeading: string | null = null
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= container.getBoundingClientRect().top + 32) {
        currentHeading = heading.textContent
      } else {
        break
      }
    }
    onReadingProgress(progress, currentHeading)
  }

  return (
    <article
      ref={articleRef}
      className="markdown-preview"
      aria-label="Markdown 预览"
      onScroll={handleScroll}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: PreviewLink,
          img: ({ src, alt }) => <PreviewImage src={src} alt={alt} documentPath={documentPath} />
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}

export default Preview
