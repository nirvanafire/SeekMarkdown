import { describe, expect, it } from 'vitest'
import { buildOutlineTree, extractMarkdownOutline } from '../markdownOutline'

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

  it('builds a tree with nested children and recovers from skipped levels', () => {
    const tree = buildOutlineTree([
      { id: 'a', level: 1, text: 'A', start: 0, end: 2, line: 1 },
      { id: 'b', level: 3, text: 'B', start: 3, end: 5, line: 2 },
      { id: 'c', level: 2, text: 'C', start: 6, end: 8, line: 3 },
      { id: 'd', level: 1, text: 'D', start: 9, end: 11, line: 4 }
    ])

    expect(tree.map((node) => node.text)).toEqual(['A', 'D'])
    expect(tree[0].children.map((node) => node.text)).toEqual(['B', 'C'])
  })
})
