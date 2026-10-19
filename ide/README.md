# Guang Code IDE

> 把 CLI 升级为桌面 IDE 的 Electron 子项目 — 参考 Codex App Server 架构 + Trae IDE 的三栏布局 + DiffView 工作流。

## 📦 项目位置

```
guang-code/
└── ide/                       ← 本目录
    ├── package.json           # @guang-code/ide
    ├── src/
    │   ├── main/              # Electron 主进程
    │   ├── preload/           # contextBridge API
    │   ├── renderer/          # React UI
    │   └── shared/            # 共享类型
    └── electron/builder.yml   # electron-builder 配置
```

通过 npm workspace 与父项目共享 `dist/` backend（**零侵入**）。

## 🚀 开发

```bash
# 在仓库根
cd guang-code

# 一次性安装所有依赖（包括 ide/）
npm install

# 启动 IDE（开发模式：Vite HMR + Electron）
npm run ide
```

需要 macOS 12+、Node.js 18+、Xcode Command Line Tools（编译 node-pty）。

## 🏗️ 构建生产包

```bash
# 在仓库根
npm run ide:build      # 编译 main + renderer
npm run ide:package    # 输出 macOS .dmg / Windows nsis / Linux AppImage
```

产物在 `ide/release/`。

## 🧱 架构

```
┌──────────────────────────────────────────────────────────────┐
│  Electron BrowserWindow  (sandbox + contextIsolation)       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Renderer (React + Monaco + xterm.js)                 │  │
│  │     ↕  window.guang.*  (contextBridge)                │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC
┌────────────────────────┴─────────────────────────────────────┐
│  Main Process                                                 │
│  ├── BackendManager  →  spawn(node start-ui.mjs)              │
│  ├── PtyManager      →  node-pty (zsh / bash)                 │
│  └── IPC handlers    →  fs / chat proxy / dialog / etc.       │
└──────────────────────────────────────────────────────────────┘
                         │ HTTP + SSE + JSON-RPC
┌────────────────────────┴─────────────────────────────────────┐
│  dist/utils/webServer.js  (现有 backend，零修改)             │
│   └── SDK + QueryEngine + Session + Skills + Plugins + ...   │
└──────────────────────────────────────────────────────────────┘
```

### 关键设计

- **Backend 零修改**：所有 AI / tool / session 调用通过现有 `sdkInterop.js`（30+ JSON-RPC method）+ `/api/ui/chat` SSE
- **文件 I/O 直走主进程**：IDE 自己负责文件树 / Tab / 编辑器变更，不经 backend
- **PTY 在主进程**：xterm.js 是纯渲染，通过 IPC 把用户输入和 PTY 输出互转
- **沙箱严格**：`sandbox: true` + `contextIsolation: true`，只暴露 `window.guang.*` 白名单

## 📂 实施阶段

| 阶段 | 状态 |
|---|---|
| 1. 脚手架 + Electron 主进程 | ✅ 已完成 |
| 2. Monaco + 文件树 + Tab | ✅ 已完成 |
| 3. AI Chat + SSE 流 | ✅ 已完成 |
| 4. Agent 模式 + 工具审批 + Diff View | ✅ 已完成 |
| 5. xterm.js 内置终端 | ✅ 已完成 |
| 6. electron-builder 打包 .dmg | ✅ 已完成 |

## 🔐 安全

- renderer 不能直接访问 `node`，只能通过 `window.guang.*`
- 所有 `will-navigate` / `window.open` 都被拦截
- `webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }`
- 主进程统一调度 backend 子进程，避免越权

## 📚 参考

- [Codex CLI](https://github.com/openai/codex) — App Server 双通道协议思想
- [Trae IDE](https://www.trae.ai) — 侧边 Chat + DiffView + Accept/Reject
- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [xterm.js](https://xtermjs.org/)
