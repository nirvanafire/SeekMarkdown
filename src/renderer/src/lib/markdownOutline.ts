export interface MarkdownOutlineItem {
  id: string
  level: number
  text: string
  start: number
  end: number
  line: number
}

function cleanHeadingText(value: string): string {
  return value.trim().replace(/\s+#+\s*$/, '').trim()
}

export function extractMarkdownOutline(content: string): MarkdownOutlineItem[] {
  const items: MarkdownOutlineItem[] = []
  const lines = content.split('\n')
  let offset = 0
  let fence: { marker: string; length: number } | null = null

  lines.forEach((line, index) => {
    const lineStart = offset
    offset += line.length + 1

    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { marker: marker[0], length: marker.length }
      } else if (marker[0] === fence.marker && marker.length >= fence.length) {
        fence = null
      }
      return
    }

    if (fence) {
      return
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/)
    if (!headingMatch) {
      return
    }

    const level = headingMatch[1].length
    const text = cleanHeadingText(headingMatch[2])
    if (!text) {
      return
    }

    items.push({
      id: `markdown-heading-${index + 1}`,
      level,
      text,
      start: lineStart + line.indexOf(headingMatch[1]),
      end: Math.min(content.length, lineStart + line.length),
      line: index + 1
    })
  })

  return items
}
