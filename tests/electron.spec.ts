import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('launches, edits, saves, and protects unsaved Markdown', async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'seermarkdown-e2e-'))
  const fixturePath = join(workingDirectory, 'sample.md')
  await writeFile(fixturePath, '# 初始文档\n\n准备编辑。\n', 'utf8')

  const app = await electron.launch({
    args: [resolve('out/main/index.js'), fixturePath]
  })
  const page = await app.firstWindow()

  await expect(page.locator('.brand-name')).toContainText('SeerMarkdown')
  await expect(page.locator('.document-copy strong')).toHaveText('sample.md')
  await expect(page.locator('.editor-panel')).toBeVisible()
  await expect(page.locator('.preview-panel')).toHaveCount(0)
  await expect(page.locator('.unified-editor-panel')).toBeVisible()
  await expect(page.locator('.cm-unified-heading').first()).toContainText('初始文档')

  const editor = page.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('# 已保存的文档\n\n保存流程正常。')
  await expect(page.locator('.cm-unified-heading').first()).toContainText('已保存的文档')
  await expect(page.locator('.dirty-indicator')).toContainText('未保存')

  await page.locator('button[title="保存"]').click()
  await expect(page.locator('.dirty-indicator')).toContainText('已保存')
  await expect
    .poll(async () => readFile(fixturePath, 'utf8'))
    .toContain('# 已保存的文档')

  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type('\n\n还有一处未保存修改。')
  await expect(page.locator('.dirty-indicator')).toContainText('未保存')

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close()
  })
  const closeDialog = page.getByRole('dialog')
  await expect(closeDialog).toContainText('保留这次修改吗？')
  await closeDialog.getByRole('button', { name: '取消' }).click()
  await expect(closeDialog).toBeHidden()
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await page.screenshot({ path: '/tmp/seermarkdown-smoke.png', fullPage: true })

  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy()
    }
  })
  await app.close()
})

test('uses sidebar shortcuts and source mode', async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'seermarkdown-sidebar-e2e-'))
  const fixturePath = join(workingDirectory, 'shortcuts.md')
  await writeFile(fixturePath, '快捷工具', 'utf8')

  const app = await electron.launch({
    args: [resolve('out/main/index.js'), fixturePath]
  })
  const page = await app.firstWindow()

  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: '源码模式' })).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: '打开历史记录' }).click()
  await expect(page.getByRole('dialog', { name: '打开历史' })).toContainText('shortcuts.md')
  await page.getByRole('button', { name: /shortcuts\.md/ }).click()
  await expect(page.locator('.document-copy strong')).toHaveText('shortcuts.md')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('快捷工具')
  await page.locator('button[title="二级标题"]').click()
  await expect(page.locator('.cm-unified-h2')).toContainText('快捷工具')

  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.locator('button[title="插入表格"]').click()
  await expect(page.locator('.unified-table-widget')).toBeVisible()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.locator('button[title="代码块"]').click()
  await expect(page.locator('.unified-code-widget')).toBeVisible()

  await page.getByRole('button', { name: '源码模式' }).click()
  await expect(page.getByRole('button', { name: '源码模式' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.cm-content')).toContainText('## 快捷工具')
  await expect(page.locator('.preview-panel')).toHaveCount(0)
  await expect(page.locator('.split-handle')).toHaveCount(0)

  await page.getByRole('button', { name: '源码模式' }).click()
  await expect(page.getByRole('button', { name: '源码模式' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.editor-panel')).toBeVisible()

  await page.getByRole('button', { name: '收起侧边栏' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)
  await expect(page.locator('.editor-toolbar')).toBeVisible()
  await expect(page.locator('.window-drag-region')).toBeVisible()
  await page.getByRole('button', { name: '展开侧边栏' }).click()
  await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveClass(/has-inspector/)
  await page.getByRole('button', { name: '文档大纲' }).click()
  await expect(page.locator('.inspector')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/has-inspector/)
  await expect(page.locator('.inspector-content')).toBeVisible()
  await page.locator('.inspector').getByRole('button', { name: '关闭右侧边栏' }).click()
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveClass(/has-inspector/)
  await page.getByRole('button', { name: '文档大纲' }).click()
  await expect(page.locator('.inspector')).toBeVisible()

  await page.screenshot({ path: '/tmp/seermarkdown-sidebar.png', fullPage: true })

  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy()
    }
  })
  await app.close()
})

test('reads a persistent reading list in order', async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'seermarkdown-reading-list-e2e-'))
  const paths = await Promise.all(
    ['one.md', 'two.md', 'three.md'].map(async (name) => {
      const path = join(workingDirectory, name)
      await writeFile(path, `# ${name}`, 'utf8')
      return { path, name }
    })
  )

  const app = await electron.launch({
    args: [resolve('out/main/index.js'), paths[0].path]
  })
  const page = await app.firstWindow()
  await page.evaluate((items) => {
    window.localStorage.setItem('seermarkdown.reading-list', JSON.stringify(items))
  }, paths)
  await page.reload()

  await page.getByRole('button', { name: '打开阅读列表' }).click()
  const readingDialog = page.getByRole('dialog', { name: '阅读列表' })
  await expect(readingDialog.locator('.reading-list-item').nth(0)).toContainText('one.md')
  await expect(readingDialog.locator('.reading-list-item').nth(1)).toContainText('two.md')
  await expect(readingDialog.locator('.reading-list-item').nth(2)).toContainText('three.md')

  await readingDialog.getByRole('button', { name: '下一个' }).click()
  await expect(page.locator('.document-copy strong')).toHaveText('two.md')
  await readingDialog.getByRole('button', { name: '下一个' }).click()
  await expect(page.locator('.document-copy strong')).toHaveText('three.md')
  await expect(readingDialog.getByRole('button', { name: '下一个' })).toBeDisabled()

  await readingDialog.getByRole('button', { name: '上一个' }).click()
  await expect(page.locator('.document-copy strong')).toHaveText('two.md')

  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy()
    }
  })
  await app.close()
})
