export interface DocumentBookmark {
  id: string
  path: string
  title: string
  heading: string | null
  cursor: number
  excerpt: string
  createdAt: number
}

export interface DocumentAnnotation {
  id: string
  path: string
  quote: string
  note: string
  heading: string | null
  position: number
  createdAt: number
}

import { extractMarkdownOutline } from './markdownOutline'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readCollection<T>(key: string, validate: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(validate) : []
  } catch {
    return []
  }
}

export function readBookmarks(): DocumentBookmark[] {
  return readCollection('seermarkdown.bookmarks', (value): value is DocumentBookmark => {
    return (
      isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.path === 'string' &&
      typeof value.title === 'string' &&
      typeof value.cursor === 'number' &&
      typeof value.excerpt === 'string' &&
      typeof value.createdAt === 'number' &&
      (value.heading === null || typeof value.heading === 'string')
    )
  })
}

export function readAnnotations(): DocumentAnnotation[] {
  return readCollection('seermarkdown.annotations', (value): value is DocumentAnnotation => {
    return (
      isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.path === 'string' &&
      typeof value.quote === 'string' &&
      typeof value.note === 'string' &&
      typeof value.position === 'number' &&
      typeof value.createdAt === 'number' &&
      (value.heading === null || typeof value.heading === 'string')
    )
  })
}

export function resolveBookmarkPosition(
  bookmark: Pick<DocumentBookmark, 'cursor' | 'heading'>,
  content: string
): number {
  if (bookmark.cursor >= 0 && bookmark.cursor <= content.length) {
    return bookmark.cursor
  }

  if (bookmark.heading) {
    const heading = extractMarkdownOutline(content).find((item) => item.text === bookmark.heading)
    if (heading) {
      return heading.start
    }
  }

  return 0
}

export function createReadingMarkId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
