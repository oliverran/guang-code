# Guang Code · 总结思考

> 2026-08 · 版本：DSH 对齐 + Memory 升级 + P2 能力交付

---

## 一、DeepSeek Harness（DSH）如何结合到自己的 guang-code 项目

### 1. 为什么需要 DSH 作为"北星"参考

DSH 是一个把 Agent 工程化做到极致的开源项目：60+ 个 `packages/*` 子包、严格的职责分层（session / skill / memory / sandbox / plugin / sdk / host / ui …）、Cordis 插件化微内核。对于 guang-code 这样的"单仓、零额外依赖"Terminal AI coding assistant 来说，**不是去 fork DSH 来改，而是把它的分层与 seam 边界直接翻译成轻量实现**。

### 2. guang-code ↔ DSH 的架构映射（已经落地的）

| 关注点 | DSH 对应子包（参考） | guang-code 的轻量实现 |
|---|---|---|
| **微内核 + 插件注册** | `packages/cordis` + `packages/hooks/hook-protocol` | [slashCommands.js](file:///c:/Users/olive/guang-code/dist/commands/slashCommands.js) 内 `builtInSlashCommands` 可插拔；[pluginManager.js](file:///c:/Users/olive/guang-code/dist/utils/pluginManager.js) 提供 `api.registerTool` / `api.hook(pre/post)` |
| **Session 持久化 & 投影** | `session-persistence-sqlite` + `session-projection` + `session-persistence-jsonl` | [sessionES.js](file:///c:/Users/olive/guang-code/dist/utils/sessionES.js) 纯 JSONL Event-Sourcing（append-only + SHA-256 哈希链 seq + Brotli 分段归档 + projection.json 增量重放 + Fork 语义 keepMessages） |
| **会话压缩策略可插拔** | `packages/compaction/*`（basic / tool-result-pruner / policy） | [compaction.js](file:///c:/Users/olive/guang-code/dist/utils/compaction.js) SessionCompactor 抽象 + Registry + 4 内置策略（keep_last / summary_inject / summary_llm / hybrid）+ usage 持久化 |
| **工具执行 waterfall 把关** | DSH 里 guard（timeout/repeat-reminder）+ sandbox + hook-protocol 洋葱 | [toolPipeline.js](file:///c:/Users/olive/guang-code/dist/utils/toolPipeline.js) 4-Phase ToolPipeline（pre→execute→post→error）+ 9 个 built-in listener（addTimeout ×3 / addPermissionGate / addOutputTruncation / addRedaction / addAuditTrail / plugin pre+post hooks） |
| **Skills 多层作用域 + digest 增量** | `skill-filesystem` + `skill-loader` + `typert-loader` | [skillLoader.js](file:///c:/Users/olive/guang-code/dist/utils/skillLoader.js) 5 层 scope 优先级（builtin→global→project→session→runtime）+ SHA-256 digests.json 增量扫描 + inject API + 可选 fs.watch 热重载 |
| **沙箱化 runtime plugin + 审批** | `sandbox-*`（acl / local / policy） + `plugin-inventory` | [pluginManager.js](file:///c:/Users/olive/guang-code/dist/utils/pluginManager.js) BasicVmSandbox（vm.createContext + 屏蔽 process/fs/child_process + 5s timeout） + FileAccessPolicy（write 白名单默认仅 `<project>/.guang/plugins-out`）+ 4 种审批模型（none / user_confirm / llm_vote / user_and_llm） |
| **外部协议互操作** | `packages/sdk/*`（server/protocol）+ `packages/acp/acp` + `packages/mcp/mcp-client` + `examples/jsonrpc-agent` | [sdkInterop.js](file:///c:/Users/olive/guang-code/dist/utils/sdkInterop.js) `SdkServer + SdkClient` 双栈 + JSON-RPC 2.0（30+ method）+ MCP（initialize + tools/list_mcp + tools/call_mcp）+ ACP pubsub（subscribe/unsubscribe/publish），传输层 Stdio / HTTP chunked NDJSON / SSE |
| **Host Web UI** | `host/webserver` + `host/frontend-static` + `apps/web` (Vite+React 60+pkg) | [webServer.js](file:///c:/Users/olive/guang-code/dist/utils/webServer.js) 零依赖 native http + [dist/ui/index.html](file:///c:/Users/olive/guang-code/dist/ui/index.html) 单文件 SPA（DSH 深色风格 + 5 Tab）+ slashCommands 的 `/ui start|stop|status|open` |
| **Host 配置 / 设置** | `settings-file` + `credentials-local` | [config.js](file:///c:/Users/olive/guang-code/dist/utils/config.js) `loadConfig` 读 `config.json` + DPAPI 加密密钥存储（`/keys`） |

### 3. 关键结合思路（可复制的方法论）

1. **"seam 先行"，不先写实现**：先定出纯抽象接口（`SessionCompactor#compact`、`IToolPipelineListener#pre(ctx,next)`、`IApprovalFlow#requestApproval/decide`、`createSdkServer({getTools,session,skills,plugins,memoryBackend})`），让上层代码依赖的是 seam 而不是某个具体策略。换实现（例如把 summary_llm 换成 DSH 的 spill-policy）只要满足同一个 seam。
2. **分层优先级表**：DSH 里 skills/compaction/plugin 都有「scope 优先级」。guang-code 用一张常量表 `{ builtin:10, global:20, project:30, session:40, runtime:50 }`，查询时按 scope 升序、同 scope 按 digest，天然支持"下层覆盖上层"且不会混乱。
3. **append-only 事件溯源先落地，其他一切都可投影**：DSH 的 session-projection 本质是「事件 replay → 当前状态」。guang-code 不依赖 SQLite——直接 JSONL 写盘 + 每 2000 事件 Brotli 归档一段——够用、可读、恢复简单。所有命令 `session list/stats/fork/compact` 都是读 projection（快）或读 events（可查）。
4. **安全："默认 deny + 显式白名单"做在 pipeline 中间**：DSH 的 sandbox-policy + guard + observation-policy 是三层守卫。guang-code 把它们收敛成 ToolPipeline 的洋葱：先超时、再审批、再脱敏、再截断……最后才到真正的工具执行。插件 hook 放在 **审批之后**（priority 99 / 1），保证插件不能绕过安全守卫。
5. **对外互操作：先给 MCP 最常见的那 3 个 method，再加别名层**：任何 agent 要和外部世界互操作，最少只需 `initialize + tools/list + tools/call`（MCP shape）。在此基础上加个 `acp.subscribe/publish` 别名 + ACP 内部 event bus，就能覆盖 90% 外部工具（IDE / Web UI / 监控）的需求。不一开始就追求全 spec。

### 4. 与 DSH 的差异（为什么不直接"用 DSH"）

- **依赖体量差异**：DSH 200+ 子包 + pnpm workspace + Vite build。guang-code 目标是 `0 install` 就能在终端跑，所以选 Node 原生模块全部自实现。
- **使用场景**：DSH 面向"host 环境（桌面 app + 浏览器 + headless agent）"，guang-code 面向"单人终端编码助手"。
- **工程化 trade-off**：guang-code 的每个 seam 都是"纯 class + 数组 / Map"没有 Cordis 的 ServiceManager、Context、lifecycle hooks 机制，好处是单步可调试、3 行 `node --check` 就能过语法；代价是扩展性不如 DSH 微内核，后续如果真要 Cordis 化可以把 seam 升级为服务。

---

## 二、目前为止 guang-code 在 Memory 上的完整工作

### 阶段 0（v1.0.0）：最初的"朴素记忆"

- **MEMORY.md 文件制**：在 project 根与 `~/.guang-code/team/` 里放 MEMORY.md，每次 runQuery 前作为 system 角色 inject 到 context 前端。
  - 问题：纯文本、不分层、跨项目污染、越长越不精准。

### 阶段 1（v1.2.2，Recall 阶段）：Top-K 召回 + Scoped Indices + Dream Pipeline

- **Per-turn Top-K Recall**：先把 user input 做关键词向量（或 BM25 风格），从 memory index 找最相关的条目，按置信度截断。
- **Scope 拆分**：
  - `~/.guang-code/MEMORY.md`：**Private / Team**（per-user 个人记忆 + team 协同记忆）
  - `<project>/.guang/MEMORY.md`：Project 本地
- **Consolidate & Dream**：
  - `/memory consolidate`：de-dup + prune（去重 / 过期条目裁剪）
  - `/memory dream`：模型驱动的提取/归并管道，用"专用工具"写 memory 文件（密钥前先 secret-scan 防泄漏）。
- **Per-file 截断 + 注入预算**：防止某一条太长撑爆 context——单条 ≤ 设定字符数，总体 recall 预算 ≤ N% of total tokens。
- **密钥 secret 扫描**：注入前扫一次 `sk-* / AKIA* / ghp_* / Bearer + 40+ hex`，命中就 reject 或脱敏。

### 阶段 2（P0 外挂 MCP）：多后端可切换 + 领域化 KV 持久化

- **Memory Registry**：从"单一实现"升级成 `memoryRegistry`——后端是一个接口 `{ add, list, search, remove, export }`。
- **双后端默认提供**：
  - `JSONBackend`：文件持久化 + 按领域 JSON 文件分片（`~/.guang-code/memory/<domain>.json`）。
  - `SQLiteBackend`：领域化 KV 表（`memories(id, domain, key, value, tags, ts)`），`search` 用 FTS5。
- **MCP 记忆后端外挂**：遵循 MCP `tools/call_mcp` 形状 + `memory/add/list/search/schema` method，让任意外部 Memory Server（MCP server 暴露 memory）能被 guang-code 调。
- **`/memory backend <name>`**：运行时切换后端 + 热迁移（export → import，保证切换时 data 不丢）。

### 阶段 3（本次 4.3 升级）：Event-Sourcing 化 Session Memory + MessagesTrimmed 可追溯

- **Session 即 Memory**：chat history 本身是最高价值的记忆。把 session 全部做 ES 化：
  - `SessionCreated / MessageAdded / ToolCallStarted / ToolCallCompleted / PermissionDecision / SessionCompleted / MessagesTrimmed / SessionForked / SessionTitleGenerated …` 共 27 种事件。
  - 每个事件 SHA-256(prevHash + seq + payload) 形成 hash chain，事后可以 audit 有没有被篡改。
  - 投影：每次重启从 events 重放到 `projection.json`；**Brotli 分段 archive**：`events.<i>.jsonl.br` 每 2000 条换一段，冷数据体积比原始 JSONL 小 6~12×。
  - **Fork 语义**：`sessionStore.fork(srcId, keepMessages=16)` 生成子 session——子 session projection 里保留 last N 条做 warm start，parent events 完全不改，hash chain 保持各自独立可审计。
  - 与原 `sessionStorage.js` 双写：老 API 不破。
- **Compaction 作为 "Memory Compression" seam**：不再固定 "keep 4 messages + [Conversation compacted:N]"，而是 4 策略注册表：
  - `keep_last(N)`：0 LLM，速度快
  - `summary_inject(keep)`：模板总结 goal + turn/char stats，0 LLM
  - `summary_llm(keep, ctx.llmSummary)`：真正 LLM 总结 Goals / Decisions / Blockers / State → 失败 fallback summary_inject
  - `hybrid`：按消息数量自动分层（<40 / 40–200 / >200），QueryEngine 自动压缩失败时兜底它。
  - 每次 compaction 会写一条 `MessagesTrimmed{keepFrom, strategy}` 事件 → memory 压缩永远可追溯压缩前边界。

### 阶段 4（本次 P0 延伸 + SDK）：Memory 对外互操作（MCP/ACP/JSON-RPC）

- [sdkInterop.js](file:///c:/Users/olive/guang-code/dist/utils/sdkInterop.js) 里暴露 memory 家族 method：
  - `memory/add(domain, key, value, tags?)`
  - `memory/list(domain, limit?)`
  - `memory/search(query, domain?, limit?, k?)`
  - `memory/schema`（导出 backend name + caps + 领域列表，给外部 UI 自动生成表单）
- ACP pubsub：每次 `memory.add` 广播 `memory.added` 事件 → Web UI / 其他 subscriber 实时刷新，不轮询。

### Memory 相关的 Slash 命令矩阵（当前已实现）

| 命令 | 作用 |
|---|---|
| `/memory list [domain] [--limit 50]` | 按领域 list |
| `/memory add <domain> <key> <value...>` | 写 |
| `/memory search <query> [domain] [-k 10]` | Top-K 搜 |
| `/memory remove <domain> <key>` | 删 |
| `/memory dream` | LLM 提取归并（Dream Pipeline）|
| `/memory consolidate` | 去重+裁剪 |
| `/memory backend [jsonl|sqlite|mcp:<name>]` | 切换后端（无停机迁移）|
| `/memory export / import` | 在 JSONL ↔ SQLite 双向迁移 |
| `/session list / events / stats / fork / compact` | Session memory 视图 |
| `/compact <strategy> [--keep=N] [--max-chars=N]` | 显式压缩 + MessagesTrimmed |
| `/compact list` / `/compact set-default <s>` | Compaction seam 策略管理 |

---

## 三、这些优化如何复用在其他 Agent 项目里 & Agent 记忆设计全景

### A. 记忆为什么重要（3 个根本原因）

1. **Context 不是无限的，但 Agent 需要长期稳定目标**：无论 128K 还是 1M，总有更大的项目。没有记忆，Agent 每次重启就失忆——同一个功能要反复解释。记忆 = 把 context window 从 "current session" 延展到 "整个项目生命周期"。
2. **减少 LLM 调用 = 省钱 + 降延迟**：好的记忆系统会把重复信息（项目编码规范、上次做了什么、哪些坑踩过）预取出来，不必让 LLM 每次 Read 100 个文件再推理。
3. **让 Agent 具备"人格 / 偏好 / 私有知识"**：用户习惯、公司内部决策、API 端点地址……这些不应该写在 prompt 里（易泄露 + 易冲突），应该存在 memory 中。
4. **可审计性**：记忆带了 hash chain / 事件日志，出问题时可以回溯「Agent 为什么做这件事——它当时看到了哪些记忆」。

### B. Agent 项目应该怎样设计记忆（分层模型 = DSH "工作记忆 / 短期 / 长期 / 归档" 4 层）

推荐任何 agent 项目都先画 4 层：

```
  Layer 0  工作记忆 (Working Memory)  ⇔ 本次 turn 的 thought / tool call scratch
           最大, 写得最频繁, 完全 volatile
           例: 当前正在改写的 AST, 待回传的工具结果数组
           实现: 纯内存 Map / Redis / State dict, 不需要持久化

  Layer 1  短期记忆 (Short-term)     ⇔ 本次 Session 内 messages + tool trace
           中等粒度, turn 结束才持久化
           实现: session events.jsonl (guang-code 4.3) / session-projection / SQLite

  Layer 2  长期记忆 (Long-term)      ⇔ 跨 Session 持久知识: MEMORY.md / 决策账本
           写入低频, 读取高频, 需要 Recall Top-K 与索引
           实现: KV SQLite(FTS5) / vector store / MEMORY.md + inverted index

  Layer 3  归档 (Archive)            ⇔ MessagesTrimmed 之后的冷数据 / Brotli 段
           极少读, 需要时可以 replay / seek 恢复
           实现: Brotli 分卷 / 对象存储 / 冷表

  记忆总开关: 注入预算 (injection budget)  每层有自己的 % of tokens, 不超就进, 超了降级
```

### C. 记忆优化"12 条 checklist"（guang-code 已经实践过的，可直接拿去用）

| # | 关注点 | guang-code 怎么做 | 其他 agent 怎么复用 |
|---|---|---|---|
| 1 | **Seam 抽象** | SessionCompactor / MemoryBackend / SkillLoader 全部独立 seam 接口 + Registry | 第一步先画 interface，而不是先写 strategy，否则写死难换 |
| 2 | **Scope 分层** | builtin(10)→global(20)→project(30)→session(40)→runtime(50) | 任何实体（skill/rule/memory）都要有 scope + priority，否则"到底谁覆盖谁" undefined |
| 3 | **增量扫描 + digest** | SHA-256 每 scope 写 `digests.json`，启动只 reload 变了的文件 | 不要每次启动遍历整个目录 hash——1 万文件会卡死 |
| 4 | **Hash chain + 事件溯源** | JSONL append + sha256(prev+seq+payload) + MessagesTrimmed 可追溯 | 把"压缩、删除"本身也记成事件，而不是直接把数据抹掉，事后要查"到底为什么丢了 80 条消息"一定用得上 |
| 5 | **冷热分层存储** | 2000 事件 → Brotli archive `events.<i>.jsonl.br`，热读 projection.json | 数据量 ≥ 100K 事件时，Brotli 归档 + 投影几乎是必须的 |
| 6 | **压缩策略可插拔** | Registry + 4 策略 + LLM 失败 fallback 模板 | 不要把 "keep_last_8" 硬编码：同产品不同用户场景不一样 |
| 7 | **Recall Budget** | `Top-K + per-file 截断 + overall % of window` | Recall 永远不是 "越多越好"，多了反而 noise 拉低质量 |
| 8 | **Secret Scanning + 脱敏** | 注入前扫 sk-*/AKIA*/ghp_*/Bearer/40+ hex，tool 结果也 addRedaction 再下传 | 记忆里不能有明文密钥；不做审计日志也要做脱敏 |
| 9 | **权限 + 审批 + 沙箱** | 插件 vm 隔离 + FileAccessPolicy write 白名单 + 4 审批模型；ToolPipeline 先审再执行 | 记忆系统能读全盘、插件能写任意路径是最常见漏洞 |
| 10 | **对外互操作（3 协议最小集）** | MCP `initialize + tools/list + tools/call` + ACP pubsub + JSON-RPC 2.0 | 不用一步到位 spec——先让"外部 Web UI / VSCode / 外部 memory server" 都能打通 |
| 11 | **Fork 语义（版本控制）** | `sessionStore.fork(srcId, keepMessages=N)`：父不改、子带 warm start | 把 session 当 git：能 branch 才能放心试错。记忆系统也要支持 fork。 |
| 12 | **监控 + Usage 持久化** | Compaction usage → `~/.guang-code/compaction/usage.json`；SdkServer ping on open | 不知道"哪种策略用户常用 / 召回 hit 率多少"，记忆永远靠拍脑袋优化 |

### D. 核心关注点（踩过的坑 & 最值得优先做的事）

- **先保证 "不可丢失"，再谈 "压缩 / 召回效率"**：guang-code 里一开始会因为 autoCompact 失败导致历史被删——做法是把原有的 autoCompact 失败兜底到 hybrid 策略 + 写 MessagesTrimmed 事件。别的 agent 也一样：任何压缩/trim 操作 **必须先记日志再改数据**。
- **别上 vector store 先上 keyword + FTS5**：多数项目（编码/文档）Top-K BM25 或 SQLite FTS5 就够，vector 是锦上添花不是必须。guang-code 目前就是 JSONL + FTS5 双后端，够用且成本低。
- **记忆是"读多写少"——读 path 一定要快**：projection.json 放内存热缓存；每次 runQuery 只扫它，不再逐次读 events 文件；digests.json 放内存，每次 save 只增量更新。
- **Plugin/skill 注入也是一种"主动记忆"**：guang-code 的 runtime-injected skill / plugin 其实是最高优先级的记忆（因为它是即时的、用户当场改的）。所以 skillLoader scope=runtime(50) 最高。
- **不要把所有工具结果都塞进记忆**：ToolPipeline 里专门有 `tool-result-pruner` 思路，guang-code 的 compaction + OutputTruncation(20K chars) 就是为此——**工具结果是 observation 不是知识**，过了 turn 就应该裁剪。
- **把记忆当成"产品能力"卖出去**：guang-code 现在给外部暴露 SDK memory method + Web UI 显示。让记忆可视化（Sessions 列表 / Skills scope filter / Plugins 审批 / Compaction usage），用户自然会信任它、用得更多。

---

## 四、下一步建议（未实现、可继续迭代的方向）

1. **DSH 的 spill-policy / spill-local**：把 hybrid 策略升级成 "按 token 预算自动 spill 到 summary"，而不是按消息数阈值。
2. **DSH 的 session-query**：实现 `/session query "我上次改 config.json 是为什么"`——用 vector + FTS5 直接搜 events（当前已经能用 `/session events` + grep，但不是自然语言）。
3. **DSH 的 sandbox-windows-acl / pwsh-sandbox**：当前 BasicVmSandbox 是进程内 vm，还不能隔离 bash 子进程。可以把 pluginManager 的 bash 实际执行放到 DSH-style pwsh-sandbox，ACL 限制路径。
4. **记忆质量闭环**：把 `memory.search` 的点击/跳过/点赞反馈回来，训练一个轻量 reranker（或规则）做 recall 质量优化。
5. **跨设备 Memory Sync**：用 MCP memory server + ACP pubsub，让同一用户在 terminal / Web UI / IDE 三端看到同一份记忆。（当前 SDK 层已经具备结构，就是没写 sync daemon 进程。）
