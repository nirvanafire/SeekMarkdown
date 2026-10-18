import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const samplePath = join(projectRoot, 'fixtures/sample.md')
const indexUrl = pathToFileURL(join(projectRoot, 'out/renderer/index.html')).href
const sample = await readFile(samplePath, 'utf8')

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--allow-file-access-from-files']
})

async function capture({ mode, path }) {
  const page = await browser.newPage({ viewport: { width: 1320, height: 840 }, deviceScaleFactor: 1 })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.addInitScript((payload) => {
    const noop = () => undefined
    const opened = payload.mode === 'loaded'
      ? { path: payload.filePath, name: 'sample.md', content: payload.sample }
      : null

    window.seerMarkdown = {
      openFile: async () => opened,
      saveFile: async (path, content) => ({ path, name: path.split('/').pop(), content }),
      saveFileAs: async (content, suggestedName) => ({
        path: `/tmp/${suggestedName}`,
        name: suggestedName,
        content
      }),
      setDirty: noop,
      requestClose: async () => undefined,
      completeClose: noop,
      onInitialFile: (listener) => {
        if (opened) queueMicrotask(() => listener(opened))
        return noop
      },
      onMenuCommand: () => noop,
      onCloseRequested: () => noop
    }
  }, { mode, sample, filePath: samplePath })

  await page.goto(indexUrl, { waitUntil: 'load' })
  await page.waitForSelector('.app-shell')
  await page.waitForTimeout(500)

  const metrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    },
    bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth,
    bodyOverflowY: document.documentElement.scrollHeight > window.innerHeight
  }))

  await page.screenshot({ path, fullPage: true })
  console.log(JSON.stringify({ mode, path, metrics, consoleErrors }, null, 2))
  await page.close()
}

await capture({ mode: 'empty', path: '/tmp/seermarkdown-empty.png' })
await capture({ mode: 'loaded', path: '/tmp/seermarkdown-editor.png' })
await browser.close()
