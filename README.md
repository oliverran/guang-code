# Guang Code

> A terminal AI coding assistant inspired by Claude Code + DeepSeek Harness (DSH) architecture.  
> Supports **Anthropic Claude**, **OpenAI GPT / o-series**, **MiniMax**, and any **OpenAI-compatible API** (DeepSeek, Qwen, Groq, …).

```
  ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗
  ██╔════╝ ██║   ██║██╔══██╗████╗  ██║██╔════╝
  ██║  ███╗██║   ██║███████║██╔██╗ ██║██║  ███╗
  ██║   ██║██║   ██║██╔══██║██║╚██╗██║██║   ██║
  ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝
   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝
               CODE  ✦  自托管 AI 编程助手
```

- **零构建**：直接 `node dist/...` 就能用（纯 ESM / CommonJS），不依赖 Vite、React、pnpm workspace。
- **安全**：bash/write/delete 默认审批；工具结果 secret-scan 脱敏；插件 vm sandbox + write 白名单。
- **互操作**：原生 MCP / ACP / JSON-RPC 2.0 SDK，Web UI 直连。
- **可扩展**：所有关键路径都是 seam 接口（Compaction / Skills / Plugins / Memory Backend），随时替换。

---

## ⚙️ Requirements

| Dependency | Version | How to install |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org 或 `winget install OpenJS.NodeJS.LTS` |
| npm | ≥ 8 | 随 Node 一起安装 |

---

## 🚀 Quick Start (5 分钟跑起来)

### 0) 首次全局安装（可选，获得 `gc` / `guang` 命令）

```bash
cd guang-code
npm link                # 一次性注册全局命令
gc "重构这个文件"        # 任意目录直接调用
guang                   # 交互 REPL
```

### 1) 启动 Terminal REPL（Ink TUI）

```bash
cd guang-code
# 方式 A：npm script
npm start
# 方式 B：直接对话（一次性 prompt）
node . "帮我在当前项目初始化一个 tsconfig.json + ESLint"
# 方式 C：恢复上次会话
node . -r 1
```

### 2) 启动 Web UI — 6 种快速方式，按你最习惯的挑

| # | 方式 | 命令 / 操作 | 适用场景 |
|---|---|---|---|
| ⭐A | **Windows 双击** | 双击 `start-ui.cmd` | 最省心，给非 CLI 用户 |
| ⭐B | **npm script** | `npm run ui`（别名 `npm run web` / `npm run webui`） | 日常开发，在项目根目录运行 |
|   C | **CLI 内 slash** | 进入 REPL 后输入 `/ui start` | 正在和终端对话时顺手开 |
|   D | **Node 纯脚本** | `node scripts/start-ui.mjs [--port=N] [--public] [--no-open]` | CI / 脚本化调用 |
|   E | **公网/局域网暴露** | `node scripts/start-ui.mjs --public` 或双击 `start-ui.cmd 5173 /pub` | 手机、内网其它机器访问 |
|   F | **编程式** | `import {startWebServer} from './dist/utils/webServer.js'` | 你自己的 Node 服务嵌入 |

**启动参数速查**：

```bash
node scripts/start-ui.mjs --port=8080          # 改端口
node scripts/start-ui.mjs --public             # 监听 0.0.0.0（允许 LAN）
node scripts/start-ui.mjs --no-open            # 启动后不开浏览器
start-ui.cmd 8080 /pub                         # Windows cmd 参数形式：port + /pub + /no-open
```

**配套控制命令**：

```
# REPL 内：
/ui status     # 查看运行状态 / UI URL
/ui stop       # 停止
/ui open       # 打开浏览器到 http://127.0.0.1:5173
# 别名： /web 、 /webui

# 独立脚本（不进 REPL）：
npm run ui:status       # 等价 node scripts/check-ui.mjs
npm run ui:stop         # 等价 node scripts/stop-ui.mjs
check-ui.cmd / stop-ui.cmd   # Windows 双击版
```

> 底层脚本：[scripts/start-ui.mjs](file:///c:/Users/olive/guang-code/scripts/start-ui.mjs) · [check-ui.mjs](file:///c:/Users/olive/guang-code/scripts/check-ui.mjs) · [stop-ui.mjs](file:///c:/Users/olive/guang-code/scripts/stop-ui.mjs)
> 双击脚本：[start-ui.cmd](file:///c:/Users/olive/guang-code/start-ui.cmd) · [check-ui.cmd](file:///c:/Users/olive/guang-code/check-ui.cmd) · [stop-ui.cmd](file:///c:/Users/olive/guang-code/stop-ui.cmd)

Web UI 功能：
- 💬 **Chat**：SSE token-by-token 流式对话；切换 / 新建 Session；tool call 折叠卡片；Event log。
- 📂 **Sessions**：Event-Sourcing 持久化 session 列表（fork / archived / messageCount / turnCount）。
- 🧠 **Skills**：5 scope 作用域（builtin→global→project→session→runtime），SHA-256 digest 增量热重载；`/skill inject` 等价的 runtime 注入。
- 🧩 **Plugins**：Runtime 自修改插件（YAML / comment frontmatter、4 种审批模型、vm sandbox、FileAccessPolicy 写白名单）。
- 🛠️ **SDK**：MCP / ACP / JSON-RPC 三协议 health ping；tools schema list；Compaction strategies + usage。

---

## 🖥️ IDE — Electron 桌面版

仓库自带一个原生桌面壳 (`ide/`)，把 Web UI + 后端服务装进一个 Electron 应用里：左中右三栏（Activity Bar · 文件树/编辑器 · AI Chat），底部 xterm.js 终端直连 PTY，AI chat 与 Web UI 共用同一套 SSE 流（事件名 → `ChatEvent` 映射）。

```bash
cd ide
npm install
npm run dev      # 同时拉起 vite (renderer) + electron (main) + 后端 child process
npm run build    # 产出 dist/main + dist/renderer，可由 electron-builder 打包
```

主要组成：

| 层 | 路径 | 作用 |
|---|---|---|
| Main | `ide/src/main/index.ts` | Electron 入口，引导 Backend / Pty / IPC |
| Main | `ide/src/main/backend.ts` | spawn `scripts/start-ui.mjs` 作为后端子进程 |
| Proxy | `ide/src/main/ipc.ts` | 把后端 SSE 流 (`event: text_delta` …) 转为渲染端 `ChatEvent` |
| Preload | `ide/src/preload/index.ts` | `contextBridge` 暴露 `window.guang` API |
| Renderer | `ide/src/renderer/` | React + Zustand + Monaco + xterm.js |
| Renderer | `ide/src/renderer/components/ChatPanel.tsx` | AI Chat 面板（消息流 + Composer + Stop） |
| Renderer | `ide/src/renderer/store/chat.ts` | 聊天状态机（assistant message、tool calls、pending） |

> ⚠️ 构建产物 (`ide/dist/`) 不提交，需要运行时由 `npm run build` 产出。

---

## 🧱 Architecture（与 DeepSeek Harness 对齐的 Seam）

项目参考了 DeepSeek Harness (DSH) 的 60+ 子包分层，把每个高价值 seam 独立成轻量 class：

| 能力层（Seam） | 源文件 | 参考 DSH 子包 |
|---|---|---|
| **Event-Sourcing Session** | [dist/utils/sessionES.js](file:///c:/Users/olive/guang-code/dist/utils/sessionES.js) | session-persistence-jsonl · session-projection · session-title |
| **Tool 4-Phase Waterfall** | [dist/utils/toolPipeline.js](file:///c:/Users/olive/guang-code/dist/utils/toolPipeline.js) | hook-protocol · guard · sandbox-policy |
| **5-Scope Skill Loader** | [dist/utils/skillLoader.js](file:///c:/Users/olive/guang-code/dist/utils/skillLoader.js) | skill-filesystem · typert-loader |
| **Compaction Strategy Seam** | [dist/utils/compaction.js](file:///c:/Users/olive/guang-code/dist/utils/compaction.js) | compaction-basic · tool-result-pruner |
| **Runtime Plugin + Approval** | [dist/utils/pluginManager.js](file:///c:/Users/olive/guang-code/dist/utils/pluginManager.js) | sandbox-* · plugin-inventory · settings-file |
| **MCP / ACP / JSON-RPC SDK** | [dist/utils/sdkInterop.js](file:///c:/Users/olive/guang-code/dist/utils/sdkInterop.js) | sdk/server · acp/acp · mcp-client · sdk/protocol |
| **Built-in Web UI Server** | [dist/utils/webServer.js](file:///c:/Users/olive/guang-code/dist/utils/webServer.js) + [dist/ui/index.html](file:///c:/Users/olive/guang-code/dist/ui/index.html) | host/webserver · host/frontend-static · apps/web |

更完整的设计思考见 [THOUGHTS.md](file:///c:/Users/olive/guang-code/THOUGHTS.md)（DSH 结合思路、Memory 盘点、可复用的记忆设计全景）。

---

## 🧠 Memory（记忆系统全景）

### Layered Model

```
Layer 0  工作记忆 (Working)  - 当前 turn scratch           纯内存 Map
Layer 1  短期记忆 (Short)    - Session Messages + Events   JSONL + SHA-256 hash chain
Layer 2  长期记忆 (Long)     - MEMORY + 决策账本 + 领域 KV JSON / SQLite(FTS5) Backend
Layer 3  归档 (Archive)      - MessagesTrimmed + Brotli    events.<i>.jsonl.br 分卷
```

### 已交付的 Memory Feature

- ✅ **4.3 Event-Sourcing Session 双写**：27 SessionEvent 类型（SessionCreated / MessageAdded / ToolCallStarted / PermissionDecision / MessagesTrimmed …）；Brotli 分段归档；projection.json 增量重放；`SessionForked(srcId, keepMessages=16)` 子 session 暖启动。
- ✅ **4.6 Compaction Seam**：4 策略可插拔（keep_last / summary_inject / summary_llm / hybrid），registry.register + setDefault；LLM 策略失败自动 fallback 模板。
- ✅ **Top-K Recall + 注入预算**：Per-turn Top-K，per-item 截断，overall % of tokens；Dream Pipeline（`/memory dream`）+ Consolidate（`/memory consolidate`）。
- ✅ **多后端 KV（JSON + SQLite）**：`/memory backend jsonl|sqlite|mcp:<name>` 热切换 + 无停机迁移；MCP 记忆后端外挂（tools/call_mcp 兼容 shape）。
- ✅ **Secret Scanning + Desensitize**：`sk-*/AKIA*/ghp_*/Bearer/40+ hex` 注入前、工具结果返回前统一 `addRedaction`。
- ✅ **SDK 互操作**：`memory/add · memory/list · memory/search · memory/schema` 通过 JSON-RPC / MCP / ACP 全部暴露；`memory.added` ACP publish 广播实时通知。

### Memory Commands 速查

```
/memory list [domain] [--limit N]      /memory add <domain> <key> <value...>
/memory search <query> [-k K] [domain] /memory remove <domain> <key>
/memory dream                          /memory consolidate
/memory backend [jsonl|sqlite|mcp:X]   /memory export / import
/session list|events|stats|fork|compact
/compact hybrid --keep=12               /compact list / set-default summary_llm
```

---

## 🧩 Plugins（运行时自修改插件）

**生命周期**：`parse → propose (存 ~/.guang-code/plugins/runtime/<id>.mjs → emit approval) → approve → activate(vm sandbox) → deactivate`

两种 frontmatter 写法都支持：

```js
/*
 // ~name: auto_refactor_loop
 // ~version: 1.0.0
 // ~tags: [refactor]
 // ~fs-write: [src/transforms]
 // ~approval: user_confirm
 */
activate = function (api) {
  // 1) 给 Agent 加一个新工具
  api.registerTool({
    name: 'auto_refactor_loop',
    description: '把 for 循环改成 map/filter/reduce',
    inputSchema: { file: { type: 'string' } },
    async execute(input) {
      const src = api.fs.read(input.file);
      api.fs.write(input.file, applyRefactor(src));
      return { content: 'ok' };
    },
  });
  // 2) 拦截 pre/post hooks（挂在 ToolPipeline waterfall 末端）
  api.hook('pre', 'Read', (ctx) => api.log('Read: ' + ctx.input?.file_path));
  api.hook('post', /Write|Edit/, (ctx) =>
    api.fs.write('.guang/plugins-out/audit.ndjson', JSON.stringify({ t: Date.now(), tool: ctx.toolName }) + '\n'));
};
```

**4 种审批模型**（`APPROVAL_MODELS`）：`none` / `user_confirm`（默认）/ `llm_vote` / `user_and_llm`。

**安全边界**：BasicVmSandbox（`require('vm').createContext`，屏蔽 `process/fs/child_process/globalThis`，默认 timeoutMs 3s）；FileAccessPolicy：project 内 read 全 allow，write 默认 deny，只有 header 显式 `fs-write: [...]` 或白名单路径（`<project>/.guang/plugins-out`）allow。

**Plugin Slash 命令**：

```
/plugin list|info <id>                 /plugin propose <id> <source>
/plugin pending                        /plugin approve <reqId> | deny <reqId>
/plugin activate <id> | deactivate <id>
/plugin models   # 打印 4 种审批模型
```

---

## 🛠️ Skills（多层作用域）

```
Scope 优先级 (数字越大越优先):
  builtin(10)  ← 随 guang-code 发布（不可改）
  global(20)   ← ~/.guang-code/skills/
  project(30)  ← <cwd>/.guang/skills/
  session(40)  ← 当前会话生命周期（ephemeral）
  runtime(50)  ← /skill inject（最高、最即时）
```

每一层独立 `digests.json`（SHA-256 16B），启动 / 切 cwd 时只 reload 变了的 SKILL.md；可选 `fs.watch` 热重载。

```
/skills list [scope:project] [search:refactor] [--watch]
/skill show <id>                         /skill inject <markdown> [--scope runtime]
/skill dirs                              /skill remove <id>
```

---

## 🌐 SDK 对外互操作（MCP + ACP + JSON-RPC）

**包名**：`@guang-code/sdk`（即 `dist/utils/sdkInterop.js` 的 package.json 重导出）。

### 三协议 × 三传输

| 协议 | 特点 | 传输支持 |
|---|---|---|
| **JSON-RPC 2.0** | 通用 req/resp；30+ method | HTTP POST（application/json）+ chunked NDJSON |
| **MCP** | `initialize + tools/list_mcp + tools/call_mcp` + capability 握手别名 | Stdio、HTTP、SSE（兼容官方 MCP Client） |
| **ACP** | JSON-RPC + `acp.subscribe/unsubscribe/publish` 轻量发布订阅 | SSE + 任意 JSON-RPC 通道 |

### Method 清单（核心 30 条）

```
tools/list       tools/schema           tools/call
memory/add       memory/list            memory/search         memory/schema
session/list     session/events         session/projection    session/schema
skills/list      skills/inject
plugins/list     plugins/propose        plugins/approval.decide
acp/subscribe    acp/unsubscribe        acp/publish
mcp.initialize   notifications/initialized  tools/list_mcp  tools/call_mcp
sdk.info
```

### 作为 MCP Server 被外部工具连接（示例）

```
POST http://localhost:5173/sdk/v1  Accept: application/mcp+json
{
  "jsonrpc":"2.0","id":1,
  "method":"initialize",
  "params":{ "protocolVersion":"2024-11-05","clientInfo":{"name":"my-mcp-client","version":"1.0"} }
}
→ { result:{ protocolVersion:"2024-11-05", serverInfo:{name:"guang-code", version:"1.0.0"}, capabilities:{ tools:{listChanged:true} } } }
```

### 作为 ACP 总线（订阅+发布）

```
GET  http://localhost:5173/sdk/v1/sse                      ← SSE 订阅连接
POST http://localhost:5173/sdk/v1 Accept: application/acp+json
{ "jsonrpc":"2.0","id":3,"method":"acp.publish","params":{ "topic":"memory.added","payload":{...} } }
```

**SDK Slash 命令**：

```
/sdk info   # 包信息 + 协议 + 能力 + endpoints
/sdk tools  # 全部已注册 tool name + description + timeout badge
/sdk ping [jsonrpc|acp|mcp]        # 每种协议 round-trip ping
/sdk subscribe <topic>             # 进程内订阅（调试）
/sdk publish <topic> <json|text>   # 发布事件
```

---

## 🧪 Tool Execution Waterfall（工具流水线 4-Phase）

[toolPipeline.js](file:///c:/Users/olive/guang-code/dist/utils/toolPipeline.js) 提供严格的洋葱模型：

```
pre ─▶ execute ─▶ post
  ▲                  │
  └── error ◀────────┘
每个 Listener(ctx, next)：PipelineAbortError(replacementResult) 立刻替换最终结果
```

Built-in 9 个监听器（QueryEngine.ensurePipelineDefaultListeners 自动注册）：

| Listener | 作用 |
|---|---|
| `addTimeout(Bash, 60s)` | Bash 默认 60s 超时（AbortController） |
| `addTimeout(AgentTool, 10min)` | Agent 自调用子工具更长 |
| `addTimeout(*, 3min)` | 兜底 3 分钟 |
| `addPermissionGate(confirm_high_risk)` | 原来的 onPermissionRequest 统一改 waterfall |
| `addOutputTruncation(20K chars)` | 超长工具结果裁剪（保留 head + tail） |
| `addRedaction(40+ patterns)` | sk-*/AKIA*/ghp_*/Bearer... 脱敏 |
| `addAuditTrail` | `~/.guang-code/audit/audit.ndjson` 全量审计 |
| `plugin pre-hooks (priority 99)` | 插件自定义 pre 规则（**在审批之后执行**，不能绕过） |
| `plugin post-hooks (priority 1)` | 插件自定义 post（在截断/脱敏之后拿最终 clean 结果）|

```
/toolpipeline stats               # 调用次数 + 平均延迟
/toolpipeline listeners           # 顺序打印所有 listener
/toolpipeline recent <callId>     # 某一次调用的 waterfall trace
/toolpipeline default-timeout <toolName> <ms>
```

---

## 🔧 Configuration

配置文件在 `~/.guang-code/config.json`（首次运行自动创建）：

```json
{
  "defaultModel": "minimax-m2.7",
  "defaultMode": "default",
  "permissionMode": "confirm_high_risk",
  "autoDelegate": false,
  "memoryEnabled": true,
  "providers": {
    "anthropic":  { "apiKey": "<DPAPI-encrypted>" },
    "openai":     { "apiKey": "<DPAPI-encrypted>" },
    "openrouter": { "apiKey": "...", "baseURL": "https://openrouter.ai/api/v1" }
  },
  "alwaysAllowRules": [{ "tool": "Read", "pathStartsWith": "src" }],
  "trustedProjects": { "c:\\Users\\olive\\guang-code": { "allowBash": true } }
}
```

**Slash 命令：** `/config` 查看、`/keys list|add|remove` DPAPI 加密存储 provider key。

---

## 📖 更多文档

- **[THOUGHTS.md](file:///c:/Users/olive/guang-code/THOUGHTS.md)**：总结思考 3 大章（DSH 如何结合、Memory 完整工作、记忆设计复用建议）+ 踩坑 checklist
- DSH 参考实现（git submodule，不参与发布）：`deepseek-harness/`（60+ packages，cordis 微内核）

---

## 🚦 Changelog

### v2.2.0（IDE 桌面版首发 · 2026-10-19）

仓库新增 `ide/`：Electron + React + Monaco + xterm.js 桌面 IDE，复用现有 Web UI / SDK / 后端能力。

#### ✨ 新增

- `ide/`：Electron 桌面壳（main / preload / renderer 三段式）。
- ActivityBar + 文件树 + Monaco 编辑器 + 底部 PTY 面板 + 右侧 AI Chat 三栏布局。
- AI Chat 走 IPC ↔ 主进程 ↔ 后端 SSE 双向管道；主进程把 `event: text_delta / tool_* / permission_* / done / final / error` 标准化为渲染端 `ChatEvent`。
- `ide/src/main/ipc.ts`：SSE 帧解析（`event:` + `data:` 双行识别）+ 后端事件名 → `ChatEvent.type` 映射。
- `ide/src/main/backend.ts`：自动 spawn `scripts/start-ui.mjs` 作为后端子进程，解析 banner 中的 `URL:` 标识 readiness。

#### 🐛 修复

- IDE AI Chat 发送消息后无回复：根因是主进程 SSE 解析只读 `data:` 行、丢失了 `event:` 字段，导致事件对象没有 `type`；改为同时读两行并映射事件名。
- `package.json` / `dist/tools/*` / `dist/utils/pmContext.js` 同步小修。

#### 📝 文档

- README 新增 `IDE — Electron 桌面版` 章节。

---

### v2.1.0（稳定性与可运维性补丁 · 2026-08-15）

本版本全部内容聚焦"让 guang-code 在 Windows 企业环境/沙箱/杀毒保护下也能**零配置跑起来不崩**"，没有改对外 API，升级即装即用。

#### 🔥 Bug 修复（三大崩溃点全链路闭环）

| # | 崩溃场景 | 修复策略 | 代码 |
|---|---|---|---|
| B1 | `Cannot read properties of undefined (reading 'minimax')` <br>（`config.providers` 未定义时 7 个访问点裸访问） | **`normalizeProviders()` 归一层**：对 `undefined / null / 只含 providers bag / 完整 config` 四种入参全部归一化；resolveApiKey/migratePlaintextKeys/slashCommands×2 处全部走归一层；webServer providerConfig 语义修复只传一次完整 config；QueryEngine 兜底 `loadConfig()`。 | [providers/index.js](file:///c:/Users/olive/guang-code/dist/providers/index.js#L52-L93) · [utils/config.js](file:///c:/Users/olive/guang-code/dist/utils/config.js#L166-L239) · [QueryEngine.js](file:///c:/Users/olive/guang-code/dist/utils/QueryEngine.js#L180-L191) · [webServer.js](file:///c:/Users/olive/guang-code/dist/utils/webServer.js#L258-L275) · [slashCommands.js](file:///c:/Users/olive/guang-code/dist/commands/slashCommands.js#L270-L365) |
| B2 | `EPERM mkdir ~/.guang-code/storage/json` <br>（Windows Defender / 组策略阻止 HOME 目录写入） | **StorageHub 韧性链**：<br>① JSON backend 三级目录 fallback `HOME → 项目 .guang-code/storage → tmpdir` + `write probe`（防 Windows mkdir 假成功）<br>② SQLite backend 同三级 fallback，`open()` 失败不抛错，`isAvailable=false` 让 hub 自动跳过<br>③ **新增 InMemoryStorageBackend** 作为最终兜底（所有磁盘后端都挂时不崩）<br>④ `StorageHub.openAll()` 对每个 backend 用 try/catch，失败自动切换 InMemory。 | [storage/index.js](file:///c:/Users/olive/guang-code/dist/utils/storage/index.js#L58-L165) · [storage/json.js](file:///c:/Users/olive/guang-code/dist/utils/storage/json.js#L15-L62) · [storage/sqlite.js](file:///c:/Users/olive/guang-code/dist/utils/storage/sqlite.js#L31-L96) · 新增 [storage/memory.js](file:///c:/Users/olive/guang-code/dist/utils/storage/memory.js) |
| B3 | `EPERM open ...MEMORY.md.<pid>.<ts>.tmp` <br>（Legacy Markdown 记忆写 .tmp 文件被 AV 拦截） | **memdir.js 同源韧性链 + 原子写 fallback**：<br>① `resolveEffectiveMemoryBase()` 三级目录 fallback + probe + 项目级 cache<br>② `writeTextAtomic()` 两步 fallback：tmp rename 失败 → `openSync('w') + writeSync + fsyncSync` 直接写<br>③ `ensureDir()` 三步重试（对付间歇性 AV 拦截）<br>④ `removeMemory()` 统一走 `writeTextAtomic()`<br>⑤ `ensureMemoryIndexExists()` 模板写失败静默吞（reader 本就安全）。 | [utils/memdir.js](file:///c:/Users/olive/guang-code/dist/utils/memdir.js#L52-L77) · [writeTextAtomic](file:///c:/Users/olive/guang-code/dist/utils/memdir.js#L275-L322) · [ensureDir](file:///c:/Users/olive/guang-code/dist/utils/memdir.js#L125-L141) · [removeMemory](file:///c:/Users/olive/guang-code/dist/utils/memdir.js#L444-L468) |

#### ✨ Web UI 快速启动生态（6 种方式 + 启停控制）

新增：
- `package.json`（根目录）npm scripts：`start / ui / web / webui / ui:status / ui:stop`，bin 注册 `gc` / `guang` 全局命令。
- `scripts/start-ui.mjs`：零依赖启动器，`--port=N --public --no-open`，**新增进程级 `uncaughtException/unhandledRejection` 兜底监听器**（非致命错误只打日志不退出）。
- `scripts/check-ui.mjs` / `scripts/stop-ui.mjs`：跨平台端口检测 + kill。
- `start-ui.cmd / check-ui.cmd / stop-ui.cmd`：Windows 双击版，自动检测 Node、pause 提示。

详见 README 上方 [🚀 Quick Start §2 启动 Web UI — 6 种快速方式](file:///c:/Users/olive/guang-code/README.md#L55-L92)。

#### 📝 文档

- `guang-code-summary.md`：完整设计思考文档——从 DSH 8 大 Capability Seam 如何落地 guang-code、Memory 五层全景、可复用的记忆系统设计 8 模式 + 7 维度 Checklist（见项目根目录）。

### v2.0.0（DSH 对齐 + P0/P2 能力大版本 · 2026-08）

- **4.3 Session Event-Sourcing**：27 种事件 + SHA-256 hash chain + Brotli 分段 archive + Fork 语义
- **4.4 Tool 4-Phase Waterfall**：9 内置监听器（超时×3 / 审批 / 截断 / 脱敏 / 审计 / 插件前后）+ PipelineAbortError
- **4.5 5-Scope Skill Loader**：优先级表 + SHA-256 digests 增量 + inject API + 可选 fs.watch
- **4.6 Compaction Seam**：SessionCompactor 抽象 + Registry + 4 策略（keep_last/summary_inject/summary_llm/hybrid）+ usage 持久化
- **4.7 Runtime Plugin 自修改扩展**：BasicVmSandbox（原生 vm）+ FileAccessPolicy 写白名单 + 4 审批模型 + frontmatter（YAML / // ~ 两种）
- **4.8 MCP / ACP / JSON-RPC 完整互操作 SDK**：@guang-code/sdk、Client/Server 双栈、Stdio + HTTP NDJSON + SSE 传输、schema 自动发现
- **P0 Memory 升级**：多后端 JSONL + SQLite FTS5 双实现、MCP 记忆后端外挂、`/memory backend` 热切换
- **P0 Web UI**：零构建单文件 SPA + 原生 http server、5 Tab（Chat/Sessions/Skills/Plugins/SDK）、Chat 原生流式对话、Model select、Event log

### v1.2.2（2026-04-13）
- Memory Recall（Top-K）+ Private/Team scopes + Dream Pipeline + `/memory consolidate`

### v1.2.1
- Autocomplete unified pipeline（slash/history/paths/git branches）+ Tab cycle + path safety

### v1.2.0（PM Edition）
- Command palette Ctrl+P + Alignment Pack + Decision Ledger + Plan Mode

### v1.1.0
- Permission unified gate / SSRF / Secret scan / Windows DPAPI keys / Auto conversation compaction

### v1.0.0
- Terminal REPL + core tools（Read/Edit/Write/LS/Grep/Glob/Bash/WebFetch）+ Sessions + Hooks + MCP

---

## 📜 License

MIT
