# guang-code Changelog

格式：每版本按 **能力 / 模块** 拆分，遵循 `Added / Changed / Fixed / Deprecated / Removed / Security` 6 大类；
Breaking Change 在条目前缀 `[BREAKING]`。版本号遵循 [SemVer 2.0](https://semver.org/lang/zh-CN/)。

---

## v2.0.0（2026-08-15 · DSH 对齐 + P0/P2 能力大版本）

**Tag**：`v2.0.0`
**对比基线**：v1.2.2 → v2.0.0
**核心交付**：把 DeepSeek Harness（DSH）的 9 子包设计映射到 guang-code 的单仓 dist 结构，一次性落地
P0 Memory 多后端 + P2（4.3 Session ES / 4.4 Waterfall / 4.5 Skills / 4.6 Compaction / 4.7 Plugins / 4.8 SDK）+ P0 Web UI 直接对话。

### Added

#### 4.3 Session Event-Sourcing（[sessionES.js](file:///c:/Users/olive/guang-code/dist/utils/sessionES.js)）

- 新增 `SessionEventStore`：27 种领域事件（`session.created|forked|archived|restored`、`message.appended|role_override|trimmed`、`tool.start|result|error|interrupted|permission_denied`、`compaction.before|after|strategy_changed`、`memory.saved|recalled|backend_switched`、`plugin.proposed|approved|rejected|activated|deactivated|errored`、`skill.loaded|injected`、`model.changed`、`usage.ticked`）
- 新增 `JSONL append-only` + `SHA-256 哈希链`（每事件 `prevHash` = `sha256(prevRaw)`），杜绝静默篡改
- 新增 `Brotli 分段归档`：event log 达阈值自动分 segment + `.br` 压缩 + `projection.json` 增量快照
- 新增 `Fork` 语义：`/session fork` 时 `forkOptions.keepMessages` 决定投影重放起点，事件永不丢失
- 新增 `Audit`：任意 event log → 离线重放还原 session（含 compaction 前后痕迹）

#### 4.4 Tool 4-Phase Waterfall（[toolPipeline.js](file:///c:/Users/olive/guang-code/dist/utils/toolPipeline.js)）

- 新增 `ToolPipeline`：**pre → execute → post → error** 4 阶段洋葱模型（plugin 可挂入 pre/post）
- 新增 9 内置监听器：
  1. `softTimeout`（软性 SLA 告警）
  2. `hardTimeout`（硬超时 Abort）
  3. `wallClockTimeout`（跨调用累计上限）
  4. `permissionGate`（deny-by-default，写入/删除/Bash/SendMessage/AgentTool 先审批）
  5. `outputTruncation`（工具结果超长按 char/token 截断）
  6. `secretRedaction`（6 种正则：Bearer/sk-/ghp_/AKIA/pk_live/RSA PRIVATE KEY）
  7. `auditLogger`（全量落盘到 audit/*.jsonl，含 input/output/tokens）
  8. `pluginPreListener`
  9. `pluginPostListener`
- 新增 `PipelineAbortError(replacementResult)`：pre 阶段可直接短路返回替换结果，不再执行真实 tool

#### 4.5 5-Scope Skill Loader（[skillLoader.js](file:///c:/Users/olive/guang-code/dist/utils/skillLoader.js) · [skills.js](file:///c:/Users/olive/guang-code/dist/utils/skills.js)）

- 新增 **5 层作用域**（数字越小优先级越低，scope 近的覆盖 scope 远的）：
  | 层级 | Scope | 目录示例 | 优先级 |
  |---|---|---|---|
  | 1 | builtin | `dist/../skills/builtin`（随包） | 10 |
  | 2 | global | `~/.guang-code/skills/global`（跨项目） | 20 |
  | 3 | project | `<repo>/.guang-code/skills/project`（本仓库） | 30 |
  | 4 | session | `<repo>/.guang-code/skills/sessions/<id>`（单会话） | 40 |
  | 5 | runtime | `api.injectSkill()` 内存态（最高覆盖） | 50 |
- 新增 `SHA-256 digests.json` 增量：仅重新 hash 变更文件，冷启动 skill 目录 ≥2 秒 → ≤200ms
- 新增 `inject API`：`/skill inject <name> <md|skillFile>` 运行时写 session scope，可覆盖同名
- 新增可选 `fs.watch` 热重载：project/global 目录修改秒级生效（默认关，`/skill watch on`）

#### 4.6 Compaction Seam（[compaction.js](file:///c:/Users/olive/guang-code/dist/utils/compaction.js)）

- 新增 `SessionCompactor` 抽象 + `CompactorRegistry`：默认内置 4 策略
  1. `keep_last(n)`：仅保留最后 n 条，最省 token
  2. `summary_inject(tpl)`：模板化压缩，插入 `系统消息 · 历史摘要`（无 LLM 调用）
  3. `summary_llm(prompt,maxTokens)`：调用 LLM 生成摘要，语义保留最好
  4. `hybrid`：前半段 summary_llm + 后半段 keep_last，平衡成本/语义
- 新增 `usage 持久化`：每次 compaction 记 `strategy / inputTokens / outputTokens / removedCount / savedAt` 到 projection，配合 `MessagesTrimmed` 事件可追溯"删了什么"
- 新增 `/compact strategy <name> [params]`、`/compact now`、`/compact history <N>` 三条 slash

#### 4.7 Runtime Plugin 自修改扩展（[pluginManager.js](file:///c:/Users/olive/guang-code/dist/utils/pluginManager.js) · [pmContext.js](file:///c:/Users/olive/guang-code/dist/utils/pmContext.js)）

- 新增 2 种 frontmatter：
  - **YAML frontmatter**（`--- yaml ... ---`，传统）
  - **注释 frontmatter**（`// ~name: xxx \n // ~tags: [a,b] \n`，适配纯 JS 文件）
- 新增 **4 审批模型**：`none` / `user_confirm` / `llm_vote`（3 模型 2/3 赞成） / `user_and_llm`（两者都过）
- 新增 `BasicVmSandbox`：原生 `vm.createContext` + `"use strict"` 包裹，`eval(wrapped)` 返回 logs；支持 `import()` 白名单（仅 `fs/path/crypto/zlib` 及 `vm` 内部）
- 新增 `FileAccessPolicy` 写白名单：默认只允许 `<repo>/.guang-code/plugins-out/`，其他写路径直接抛错
- 新增 Plugin API：`api.registerTool(name,schema,fn)` + `api.hook('pre'|'post', matcher, fn)` + `api.logger.*` + `api.emitUsage(tok)`
- 新增 4 条 slash：`/plugin propose|activate|deactivate|list`

#### 4.8 MCP / ACP / JSON-RPC 完整互操作 SDK（[sdkInterop.js](file:///c:/Users/olive/guang-code/dist/utils/sdkInterop.js)）

- 新增 **3 协议 × 3 传输**矩阵：
  - 协议：`JSON-RPC 2.0`（req/resp + notify）/ `MCP`（tools/list + call + notifications）/ `ACP pubsub`（pub/sub/topics）
  - 传输：`Stdio`（JSON Lines）/ `HTTP chunked NDJSON`（POST /sdk/v1/stream）/ `SSE`（GET /sdk/v1/sse）
- 新增 `@guang-code/sdk` 包导出视角：`SdkServer(options)` + `SdkClient(options)` 双栈
- 新增 `sdk.info` 方法返回：`name / version / protocols / capabilities / endpoints / defaultModel / config`（含 `endpoints.chat = /api/ui/chat` 供 Web / 第三方跳转）
- 新增 schema 自动发现：`sdk.tools.list` 实时读 registry 生成 JSON Schema 输入输出

#### P0 Memory 多后端 & 领域化 KV

- 新增 **多后端可切换**：`StorageRegistry`（[storage/index.js](file:///c:/Users/olive/guang-code/dist/utils/storage/index.js)）内置 JSON（[json.js](file:///c:/Users/olive/guang-code/dist/utils/storage/json.js)）/ SQLite FTS5（[sqlite.js](file:///c:/Users/olive/guang-code/dist/utils/storage/sqlite.js)）2 实现，统一 `put/get/list/del/search/close` 接口
- 新增 **领域化 KV**：Memory 拆 4 域 `sessions / skills / plugins / usage`（[memoryDomain.js](file:///c:/Users/olive/guang-code/dist/utils/memoryDomain.js)），每域独立 key 前缀，避免和任意 KV 混存
- 新增 **MCP 记忆后端外挂**（[mcpMemoryBackend.js](file:///c:/Users/olive/guang-code/dist/utils/mcpMemoryBackend.js)）：只要对端 MCP server 提供最小 3 方法集（`memory_get / memory_put / memory_list_prefix`）即可无缝挂接
- 新增 `/memory backend <jsonl|sqlite|mcp [serverName]` slash：运行时热切换，写入自动双写旧 backend
- 新增 `Secret Scanning`（[secretScanner.js](file:///c:/Users/olive/guang-code/dist/utils/secretScanner.js)）：6 种正则 + 任何 put 前扫描，命中则抛错拒绝入库

#### P0 Web UI 直接对话

- 新增 `GuangWebServer`（[webServer.js](file:///c:/Users/olive/guang-code/dist/utils/webServer.js)）：Node 原生 http（无 express 依赖），默认端口 `5173`，支持 `/` / `/ui/*` 静态 + `/api/ui/chat` SSE
- 新增单文件 SPA（[dist/ui/index.html](file:///c:/Users/olive/guang-code/dist/ui/index.html)）5 Tab：
  - **Chat**：Composer（textarea Enter 发送 / Shift-Enter 换行，Stop 按钮 AbortController），ReadableStream 按 `\n\n` 切帧，`reRenderLastMsg` 增量无闪烁渲染
  - **Sessions**：侧栏 session 列表 + `＋ New Chat`，切会话自动 restore projection；event log 面板实时追加
  - **Skills / Plugins / SDK**：只读展示当前加载的 scope、已 activated 插件、SDK endpoints/capabilities
- 新增 Chat **9 类 SSE 事件**：`session / user_message / text_delta / tool_start / tool_done / permission_request / done / error / final`
- 新增 Chat 默认权限策略：bash / write / delete / sendMessage / agentTool 默认 deny，其余 allow；`final` 事件返回完整 `{sessionId, messages, tokens, error?}`
- 新增 `/ui start|stop|status|open` slash 命令（[slashCommands.js](file:///c:/Users/olive/guang-code/dist/commands/slashCommands.js)）

#### Query Engine + 跨模块打通

- 升级 `QueryEngine.runQuery`（[QueryEngine.js](file:///c:/Users/olive/guang-code/dist/utils/QueryEngine.js)）：统一回调签名 `{onStreamChunk,onPermissionRequest,onTool,onUsage,onFinal}`，Web/SSE/SDK 复用同一回调集合
- 升级 `slashCommands`：`/memory` 组、`/compact` 组、`/plugin` 组、`/skill` 组、`/ui` 组、`/sdk` 组、`/session fork|audit|replay`

### Changed

- [BREAKING] Session 持久化格式：JSON blob 单文件 → `session/<id>/events.jsonl(.br) + projection.json + segments/`，旧 session 首次启动会被 `migrateSessionV1ToV2`（`sessionStorage.js`）自动迁移并留备份 `<id>.v1.bak.json`
- [BREAKING] Compaction 从内置"固定 auto trim"策略升级为 `hybrid` 默认 + 可替换 seam，默认触发阈值 `messages.length > 40 || totalTokens > 32000` 可调
- Skills 加载：同步一次性读目录 → 启动时 digests diff + 按 scope 覆盖；不再重复加载 builtin（除非 digests 变化）
- `/ui` 路由：之前演示用的 `GET /chat` 统一为 `GET /` → [index.html](file:///c:/Users/olive/guang-code/dist/ui/index.html)，`POST /api/ui/chat` 为唯一 Chat 入口

### Fixed

- `pluginManager.propose()` 顺序 bug：先 `plugins.set` → 再 `requestApproval` → 再 `await decide` → 最后 `activate`；修复 activated=false 和 logs 未定义等 6 类问题
- Web UI Chat smoke：循环变量名 collision（`event` vs `eventName`）修复后 9 断言全过，包括 badModel 时 `error + final` 事件仍能正确落盘
- `sdkInterop.info` 之前缺少 `defaultModel + config + endpoints.chat`，升级后前端 model select 自动取 config.defaultModel 初始化
- Secret Scanning 之前只扫 message，现扩展扫：记忆 put / tool input / tool output / plugin output 4 入口

### Security

- Tool Pipeline 中段放 `permissionGate + secretRedaction`（遵循 pipeline 中段最严原则）：任何 tool 入参/出参都必须过
- BasicVmSandbox deny-by-default：没列在 import 白名单里的内置模块一律抛 `SecurityError`
- FileAccessPolicy 默认只允许 `<repo>/.guang-code/plugins-out/` 写入，跨盘 / 父目录穿越一律拒绝
- `.gitignore` 现覆盖：`.guang-code / state / compaction / audit / plugins-out / __wip_local / __smoke_* / .env* / *.pem`（见 [.gitignore](file:///c:/Users/olive/guang-code/.gitignore)）

---

## v1.2.2（2026-04-13）

### Added
- Memory Recall：Top-K + semantic 双通道召回，Private/Team scope 隔离
- Dream Pipeline：低峰期异步 consolidate + 冷记忆预热
- `/memory consolidate` slash 命令

### Fixed
- Recall 结果去重（同 docId 多 slice 合并）
- Team scope 权限：写入者 vs 读取者 ACL 校验

---

## v1.2.1（PM 小版本）

### Added
- Autocomplete 统一 pipeline：slash 历史 + 路径补全 + git branch/tag，Tab cycle 多选
- Path Safety：写入路径穿越检测（`../` / 符号链接）

### Changed
- `/` 命令提示符：由 `>` 改为「输入 `/` 触发 autocomplete 面板」

---

## v1.2.0（PM Edition · 2026-Q1）

### Added
- Command Palette（Ctrl/⌘+P）：所有 slash / custom command / todo 都可模糊搜索
- Alignment Pack：每条响应前挂"目标 / 约束 / 交付物"三段确认
- Decision Ledger：决策记录 `.guang-code/decisions/<YYYYMMDD>-<slug>.md` + `/decide`
- Plan Mode：/plan → 产出 todo → 用户 approve 后才执行

---

## v1.1.0（Security & Cleanup）

### Added
- Permission 统一 gate：bash / write / delete / sendMessage 四类默认 deny
- SSRF 保护：WebFetch 拒私网（10/172.16-31/192.168/127/link-local）+ host 白名单
- Secret Scanning 6 正则（Bearer / sk- / ghp_ / AKIA / pk_live / RSA PRIVATE KEY），message 发送前拒绝
- Windows DPAPI 密钥加密（secureStore），macOS Keychain / Linux libsecret 占位但未启用
- Auto conversation compaction：>60 条或 >24K tokens 自动 keep_last(20)

---

## v1.0.0（首发 · 2025-Q4）

### Added
- Terminal REPL：多模型（OpenAI / Anthropic / MiniMax）provider 切换
- Core tools 10+：Read / Edit / Write / LS / Grep / Glob / Bash / WebFetch / McpTool / AgentTool / SendMessage
- Sessions：创建 / 切换 / 列出 / 删除 / 重命名
- Hooks：preTool / postTool / onModelResponse 3 挂点
- MCP Client：支持 `tools/list` + `tools/call`，JSON Schema 入参出参自动绑定
- Config：`config.js` 分层（defaults → user config → env override）

---

## Roadmap（v2.x 候选，未进入主线）

- Memory spill：短记忆 → 长记忆自动搬迁 + 冷层查询
- Session-level query：`/session query "找 X 那次对话里的 Y 工具"`
- Windows ACL：plugins-out 目录继承 `<repo>` ACL，拒绝低权限账户读
- Memory sync：跨设备 / 多副本一致性（暂定 CRDT + SQLite 流复制）
- SDK 正式发布 npm：`@guang-code/sdk` 打 `package.json` + 发布 CI

