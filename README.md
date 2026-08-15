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

### 1) 启动 Terminal REPL

```bash
cd guang-code
# 直接对话（默认模型读取 config.json 的 defaultModel）
node . "帮我在当前项目初始化一个 tsconfig.json + ESLint"
# 或启动交互模式
node .
```

### 2) 启动 Web UI（内置、零构建、支持直接对话）

```
/ui start [--port=5173] [--host=127.0.0.1] [--public]
/ui status     # 查看运行状态
/ui stop       # 停
/ui open       # 打开浏览器到 http://127.0.0.1:5173
别名： /web 、 /webui
```

或纯 Node：

```bash
node -e "import('./dist/utils/webServer.js').then(m=>m.startWebServer({port:5173}))"
# Web UI 聊天界面：http://127.0.0.1:5173
```

Web UI 功能：
- 💬 **Chat**：SSE token-by-token 流式对话；切换 / 新建 Session；tool call 折叠卡片；Event log。
- 📂 **Sessions**：Event-Sourcing 持久化 session 列表（fork / archived / messageCount / turnCount）。
- 🧠 **Skills**：5 scope 作用域（builtin→global→project→session→runtime），SHA-256 digest 增量热重载；`/skill inject` 等价的 runtime 注入。
- 🧩 **Plugins**：Runtime 自修改插件（YAML / comment frontmatter、4 种审批模型、vm sandbox、FileAccessPolicy 写白名单）。
- 🛠️ **SDK**：MCP / ACP / JSON-RPC 三协议 health ping；tools schema list；Compaction strategies + usage。

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
