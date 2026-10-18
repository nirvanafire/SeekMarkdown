# SeerMarkdown

SeerMarkdown 是一个使用 Electron、React 和 TypeScript 编写的本地 Markdown 查看与编辑桌面客户端。

## 基础能力

- 打开 `.md`、`.markdown`、`.mdown` 文件
- CodeMirror Markdown 源码编辑
- GitHub Flavored Markdown 实时安全预览
- 手动保存与另存为
- 未保存修改保护
- 固定左侧控制台：文件操作、预览开关、格式工具和文档状态
- Markdown 快捷按钮：标题、列表、表格、代码块等
- 可拖动调整编辑器/预览分栏
- 原生文件菜单和跨平台快捷键

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
```

## 构建

```bash
npm run pack:dir  # 生成未压缩的 macOS .app
npm run dist       # 生成当前平台安装包
```

`npm run dist` 使用 `electron-builder` 为当前操作系统生成安装包，产物位于 `release/`。首版不包含代码签名或公证。

## 安全设计

Electron 主进程只通过受控 IPC 提供文件读写能力。渲染进程启用 `contextIsolation`，关闭 `nodeIntegration`，Markdown 预览会清洗原始 HTML，并只允许安全的 HTTP/HTTPS 外链。

## 多平台打包

`icon.png` 会被 `electron-builder` 用于生成 macOS `.icns` 和 Windows `.ico`。

```bash
npm run dist:mac  # macOS DMG
npm run dist:win  # Windows NSIS EXE
```

GitHub Actions Workflow 会在版本 Tag、Pull Request 或手动触发时构建 macOS 和 Windows 安装包，并在 Actions 页面上传产物。当前产物未进行代码签名或公证。
