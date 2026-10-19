import { describe, expect, it } from 'vitest'
import {
  findSearchMatches,
  replaceAllSearchMatches,
  replaceSearchMatch,
  type SearchOptions
} from '../search'

const options: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
}

describe('editor search', () => {
  it('finds literal matches and respects case sensitivity', () => {
    expect(findSearchMatches('Mark mark MARK', 'mark', options)).toHaveLength(3)
    expect(findSearchMatches('Mark mark MARK', 'mark', { ...options, caseSensitive: true })).toHaveLength(1)
  })

  it('supports whole-word matching', () => {
    expect(findSearchMatches('cat catalog cat', 'cat', { ...options, wholeWord: true })).toHaveLength(2)
  })

  it('supports regular expression matching', () => {
    expect(
      findSearchMatches('issue 12 and issue 345', String.raw`issue \d+`, { ...options, regex: true })
    ).toHaveLength(2)
  })

  it('replaces one match and all matches', () => {
    const content = 'one two one'
    const [first] = findSearchMatches(content, 'one', options)
    expect(replaceSearchMatch(content, first, 'three', options)).toBe('three two one')
    expect(replaceAllSearchMatches(content, 'one', 'three', options)).toBe('three two three')
  })

  it('uses capture groups for regular expression replacements', () => {
    const result = replaceAllSearchMatches(
      '# title',
      String.raw`^# (.+)$`,
      '## $1',
      { ...options, regex: true }
    )
    expect(result).toBe('## title')
  })

  it('returns no matches for an invalid regular expression', () => {
    expect(findSearchMatches('content', '[', { ...options, regex: true })).toEqual([])
  })
})
