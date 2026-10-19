# Guang Code IDE — 改造方案

> 把 CLI 升级为桌面 IDE，参考 Codex（App Server 双通道协议 + Ratatui 架构思想）与 Trae（侧边 Chat + DiffView + IDE/SOLO 双模式）。

## 0. 决策

| 维度 | 选择 |
|---|---|
| 形态 | **Electron 桌面应用**（macOS 优先，双击启动 .app） |
| 项目位置 | `guang-code/ide/` 子目录（通过 npm workspace 复用 `dist/` backend） |
| 编辑器内核 | **Monaco Editor** |
| 前端框架 | React 18 + TypeScript + Vite |
| Terminal | xterm.js + node-pty |
| Backend | **零修改**，完全复用 `dist/utils/webServer.js` + `sdkInterop.js` |

## 1. Backend 复用边界（零侵入）

所有 IDE UI 与 backend 的通信**严格走以下通道**，保证 backend 不被 IDE 形态耦合：

```
IDE UI (renderer) 
  ↕  HTTP / SSE / WebSocket
Electron Main Process
  ↕  subprocess.spawn / stdio + IPC
webServer.js (现有)
  ↕  内部 SDK + QueryEngine + SessionES + SkillLoader + PluginManager + ...
```

### 复用通道清单

| IDE 功能 | 现有 backend 通道 | 端点 / 方法 |
|---|---|---|
| 流式 Chat | `webServer.js` SSE | `POST /api/ui/chat` (SSE) |
| Session 列表 | `sdkInterop.js` JSON-RPC | `session/listSessions` |
| Session 事件重放 | JSON-RPC | `session/readEvents` |
| Skill 列表 | JSON-RPC | `skills/list` |
| Plugin 列表 | JSON-RPC | `plugins/list` |
| 工具调用 | QueryEngine + toolPipeline | （已经内置） |
| MCP 互通 | JSON-RPC | `mcp.initialize` / `tools/list_mcp` |
| 内存记忆 | JSON-RPC | `memory/list` / `memory/search` |
| 文件读写 | IDE 内置（不走 backend，自己实现更直接） | `fs` 模块 |

> **关键**：文件操作由 IDE 主进程直接 `fs` 访问，**不**通过 backend，因为 IDE 是 GUI 应用，文件树、Tab、编辑器变更都发生在本地；backend 仍然负责所有 AI 推理、tool 执行、审批。

## 2. 工程结构

```
guang-code/
├── package.json              # workspace root
├── dist/                     # 现有 CLI / backend（不改）
├── scripts/                  # 现有脚本（不改）
└── ide/                      # ← 新增：Electron IDE 子项目
    ├── package.json
    ├── electron/
    │   ├── builder.yml       # electron-builder 配置
    │   └── icons/            # .icns / .png
    ├── src/
    │   ├── main/             # Electron 主进程
    │   │   ├── index.ts
    │   │   ├── backend.ts    # 启动 webServer.js 子进程
    │   │   ├── ipc.ts        # IPC handlers
    │   │   ├── fs.ts         # 文件读写
    │   │   ├── terminal.ts   # node-pty
    │   │   └── window.ts
    │   ├── preload/
    │   │   └── index.ts      # contextBridge API
    │   ├── renderer/         # React + Vite
    │   │   ├── index.html
    │   │   ├── main.tsx
    │   │   ├── App.tsx
    │   │   ├── components/
    │   │   │   ├── ActivityBar.tsx
    │   │   │   ├── Sidebar/
    │   │   │   │   ├── FileTree.tsx
    │   │   │   │   ├── SkillsPanel.tsx
    │   │   │   │   ├── PluginsPanel.tsx
    │   │   │   │   └── SessionsPanel.tsx
    │   │   │   ├── Editor/
    │   │   │   │   ├── MonacoEditor.tsx
    │   │   │   │   ├── TabBar.tsx
    │   │   │   │   └── DiffViewer.tsx
    │   │   │   ├── Chat/
    │   │   │   │   ├── ChatPanel.tsx
    │   │   │   │   ├── MessageList.tsx
    │   │   │   │   ├── ToolCallCard.tsx
    │   │   │   │   ├── PermissionDialog.tsx
    │   │   │   │   └── Composer.tsx
    │   │   │   └── Terminal/
    │   │   │       └── XTerminal.tsx
    │   │   ├── store/        # Zustand
    │   │   │   ├── ide.ts
    │   │   │   ├── chat.ts
    │   │   │   ├── editor.ts
    │   │   │   └── terminal.ts
    │   │   ├── services/     # 客户端服务
    │   │   │   ├── backend.ts    # JSON-RPC client
    │   │   │   ├── chatStream.ts # SSE 客户端
    │   │   │   └── diff.ts       # diff-match-patch
    │   │   └── styles/
    │   └── shared/           # 主进程 ↔ renderer 共享类型
    │       └── types.ts
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts
    └── README.md
```

## 3. 实施分阶段（6 阶段）

| # | 阶段 | 输出 |
|---|---|---|
| 1 | 脚手架 + Electron 主进程 | 可启动空白窗口，`npm run dev` 热重载 |
| 2 | Monaco + 文件树 + Tab | 能打开/编辑项目文件 |
| 3 | AI Chat 面板 + SSE 流 | 可对话，看 token 流式输出 |
| 4 | Agent 模式 + 工具审批 + Diff View | AI 改文件，UI 弹 Approve + Diff |
| 5 | xterm.js 内置终端 | 跑 shell 看输出 |
| 6 | electron-builder 打包 .dmg + 启动 webServer | 双击 .app 自启动，**完全独立运行** |

## 4. 参考点

- **Codex CLI** ([openai/codex](https://github.com/openai/codex))：App Server JSON-RPC 双通道协议思想；审批流；tool 调用 waterfall；项目级 + 用户级 `config.toml`
- **Trae IDE** ([trae.ai](https://www.trae.ai))：三栏布局；侧边 Chat + 多文件 Diff + Accept/Reject；SOLO/IDE 双模式；项目级 Rule + Memory
- **VS Code**（参考）：Activity Bar + Side Bar + Editor Group + Panel + Status Bar 的经典五区布局
- **Cursor**：Monaco 内核的 AI IDE 商业实现，验证了 Monaco + Chat 模式可行性

## 5. 安全 & 隔离

- **Electron sandbox**：`webPreferences.sandbox = true` + `contextIsolation = true`
- **preload 唯一白名单**：所有 node API 仅通过 `window.guang.*` 暴露
- **backend 子进程**：以受限 user 跑 webServer.js（可后续加 macOS Seatbelt，参考 Codex）
- **API Key 加密**：复用现有 `secureStore.js`（macOS Keychain）
- **审批流**：bash / write / delete 默认走 Approve UI（保留现有 `addPermissionGate` listener）

## 6. macOS 启动方式

```
dist/
  Guang Code.app/             ← 双击启动
    Contents/
      MacOS/Guang Code        ← Electron 二进制
      Resources/app/          ← 打包的 renderer + main
      Resources/backend/      ← 内嵌 dist/ 整个 backend
```

启动流程：
1. Electron 主进程启动
2. `backend.ts` `fork` 出一个 Node 子进程跑 `dist/utils/webServer.js`，端口随机或固定 5173
3. `webContents.loadURL('http://127.0.0.1:5173/')` 不行——因为 Electron 的 BrowserWindow 内嵌本地 HTTP 服务，**不走 loopback**。改为：主进程内 `createWindow` 后用 `webContents.loadFile()` 加载打包后的 SPA，renderer 通过 `http://127.0.0.1:PORT/api/*` 调 backend
4. 主进程通过 IPC 把 backend URL 暴露给 renderer

> 这正是 Codex App Server 的同款架构：Electron shell + 内嵌 backend 子进程。
