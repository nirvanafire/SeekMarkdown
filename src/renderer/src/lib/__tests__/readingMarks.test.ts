import { beforeEach, describe, expect, it } from 'vitest'
import { readAnnotations, readBookmarks, resolveBookmarkPosition } from '../readingMarks'

describe('reading marks storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('restores bookmarks and ignores invalid entries', () => {
    window.localStorage.setItem(
      'seermarkdown.bookmarks',
      JSON.stringify([
        {
          id: 'bookmark-1',
          path: '/tmp/doc.md',
          title: '重要段落',
          heading: '章节',
          cursor: 12,
          excerpt: '内容',
          createdAt: 100
        },
        { id: 42 }
      ])
    )
    expect(readBookmarks()).toHaveLength(1)
  })

  it('restores annotations and ignores invalid JSON', () => {
    window.localStorage.setItem('seermarkdown.annotations', '{invalid')
    expect(readAnnotations()).toEqual([])
  })

  it('falls back to a saved heading when the cursor is outside the document', () => {
    const content = '# Start\n\n## Target\n\ncontent'
    expect(resolveBookmarkPosition({ cursor: 999, heading: 'Target' }, content)).toBe(9)
    expect(resolveBookmarkPosition({ cursor: 999, heading: 'Missing' }, content)).toBe(0)
  })
})
