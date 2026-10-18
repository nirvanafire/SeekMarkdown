import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

interface PreviewProps {
  content: string
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

function PreviewImage({ src, alt }: { src?: string; alt?: string }): JSX.Element {
  if (!isSafeWebUrl(src)) {
    return <span className="image-fallback">图片不可用：{alt || '本地资源'}</span>
  }

  return <img src={src} alt={alt ?? ''} loading="lazy" />
}

export default function Preview({ content }: PreviewProps): JSX.Element {
  return (
    <article className="markdown-preview" aria-label="Markdown 预览">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        urlTransform={(url) => (isSafeWebUrl(url) ? url : '')}
        components={{
          a: PreviewLink,
          img: PreviewImage
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
