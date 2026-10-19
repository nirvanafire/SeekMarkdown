import { describe, expect, it } from 'vitest'
import { extractMarkdownOutline } from '../markdownOutline'

describe('markdown outline', () => {
  it('extracts nested headings with source positions', () => {
    const content = '# Title\n\n## Section\n\n### Detail\n'
    const outline = extractMarkdownOutline(content)

    expect(outline.map(({ level, text, line }) => ({ level, text, line }))).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Section', line: 3 },
      { level: 3, text: 'Detail', line: 5 }
    ])
    expect(content.slice(outline[1].start, outline[1].end)).toContain('## Section')
  })

  it('ignores heading-like text inside fenced code blocks', () => {
    const outline = extractMarkdownOutline('# Real\n```md\n# Fake\n```\n## Also real')
    expect(outline.map((item) => item.text)).toEqual(['Real', 'Also real'])
  })

  it('keeps duplicate headings and ignores empty headings', () => {
    const outline = extractMarkdownOutline('# Same\n##\n# Same')
    expect(outline.map((item) => item.text)).toEqual(['Same', 'Same'])
  })
})
