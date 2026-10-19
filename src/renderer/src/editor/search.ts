export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface SearchMatch {
  start: number
  end: number
  text: string
}

export const defaultSearchOptions: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordCharacter(value: string | undefined): boolean {
  return !!value && /[\p{L}\p{N}_]/u.test(value)
}

export function createSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) {
    return null
  }

  try {
    return new RegExp(options.regex ? query : escapeRegExp(query), options.caseSensitive ? 'gu' : 'giu')
  } catch {
    return null
  }
}

export function findSearchMatches(
  content: string,
  query: string,
  options: SearchOptions = defaultSearchOptions
): SearchMatch[] {
  const expression = createSearchRegex(query, options)
  if (!expression) {
    return []
  }

  const matches: SearchMatch[] = []
  for (const match of content.matchAll(expression)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (end === start) {
      expression.lastIndex += 1
      continue
    }

    if (
      options.wholeWord &&
      (isWordCharacter(content[start - 1]) || isWordCharacter(content[end]))
    ) {
      continue
    }

    matches.push({ start, end, text: match[0] })
  }

  return matches
}

export function replaceSearchMatch(
  content: string,
  match: SearchMatch,
  replacement: string,
  options: SearchOptions = defaultSearchOptions,
  query = match.text
): string {
  if (options.regex) {
    const expression = createSearchRegex(query, { ...options, wholeWord: false })
    return (
      content.slice(0, match.start) +
      match.text.replace(expression ?? /$/u, replacement) +
      content.slice(match.end)
    )
  }

  return content.slice(0, match.start) + replacement + content.slice(match.end)
}

export function replaceAllSearchMatches(
  content: string,
  query: string,
  replacement: string,
  options: SearchOptions = defaultSearchOptions
): string {
  const matches = findSearchMatches(content, query, options)
  let nextContent = content

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    nextContent = replaceSearchMatch(nextContent, matches[index], replacement, options, query)
  }

  return nextContent
}
