# SeerMarkdown

SeerMarkdown 是一个使用 Electron、React 和 TypeScript 编写的本地 Markdown 查看与编辑桌面客户端。

## 核心能力

- 打开 `.md`、`.markdown`、`.mdown` 文件，也可将文件拖入窗口打开
- CodeMirror Markdown 源码编辑与 GitHub Flavored Markdown 安全预览
- 手动保存、另存为、未保存修改保护和已有文件自动保存
- 文件打开历史记录，最多保留 20 条，并恢复上次编辑与预览位置
- 持久化阅读列表，支持多选添加、拖拽添加、顺序阅读和上一个/下一个
- 左侧控制台：文件操作、预览模式、Markdown 格式工具、文档状态和侧栏缩进
- 查找替换：大小写、整词、正则、结果计数、上一个/下一个和全部替换
- Markdown 大纲：H1-H6 层级、源码定位、预览目录跳转
- 本地图片插入：复制到文档同级 `assets/`，预览只读取文档目录内的图片
- 阅读进度、剩余阅读时间和当前标题
- 持久化书签与文字批注，支持跳转和删除
- Markdown 快捷按钮：标题、列表、表格、代码块、引用和分隔线
- 可拖动调整编辑器/预览分栏，预览开启、预览独占和源码独占模式

## 快捷键

- `Cmd/Ctrl+O`：打开文件
- `Cmd/Ctrl+S`：保存
- `Cmd/Ctrl+Shift+S`：另存为
- `Cmd/Ctrl+F`：查找
- `Cmd/Ctrl+H`：查找和替换
- `Enter` / `Shift+Enter`：下一个/上一个查找结果
- `Esc`：关闭查找或大纲面板

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

Electron E2E 需要在可以启动图形界面的普通终端中运行。

## 构建

```bash
npm run pack:dir  # 生成未压缩的当前平台应用
npm run dist      # 生成当前平台安装包
npm run dist:mac  # macOS DMG
npm run dist:win  # Windows NSIS EXE
```

`electron-builder` 使用根目录 `icon.png` 生成 macOS `.icns` 和 Windows `.ico`。产物位于 `release/`，当前不包含代码签名或公证。

GitHub Actions Workflow 会在版本 Tag、Pull Request 或手动触发时构建 macOS 和 Windows 安装包，并上传构建产物和发布到 GitHub Releases。构建脚本显式使用 `--publish never`，本地构建不会要求 GitHub Personal Access Token。

## 安全设计

Electron 主进程通过最小化 IPC 提供文件读写和文档目录内图片读取能力。渲染进程启用 `contextIsolation`，关闭 `nodeIntegration`。Markdown 预览会清洗原始 HTML，外链只允许安全的 HTTP/HTTPS，本地图片只允许文档目录内的图片扩展名，禁止目录穿越和任意本地文件读取。

## 数据存储

文件历史、阅读列表、阅读位置、书签和批注使用浏览器本地存储。预览开关和分栏比例只在本次会话中保持。文件历史最多保留 20 条；阅读列表按添加顺序显示；阅读位置会在切换文件和关闭应用前保存。
