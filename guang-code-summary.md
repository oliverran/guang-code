---

## Guang-Code 项目总结思考

---

### 一、DeepSeek Harness (DSH) 如何结合到 guang-code 项目中

DSH 作为一个架构蓝图而非"可导入库"，其核心思想是通过 **Capability Seams（能力接缝）** + **Cordis 服务容器模式** 为 Agent 构建可插拔的子系统。Guang-code 没有直接依赖 DSH 的 npm 包，而是从 DSH 的架构文档（`docs/subsystems/`、`docs/capability-seams.md`）中抽取了 8 个模式，逐一落地为自实现模块：

| # | DSH 参考思想 | Guang-code 落地实现 | 代码位置 |
|---|---|---|---|
| 1 | **Cordis 服务容器 + 领域化存储**（`packages/storage/` + `docs/subsystems/storage.md`） | 实现 `StorageHub` 单例，支持 JSON / SQLite 双后端切换；`defineDomain()` + `domainTable()` 声明式定义领域表（MemoryDomain = entries + indexLines + stats 三表）。默认 JSON 后端（零依赖），检测到 `better-sqlite3` 时自动升级。 | [storage/index.js](file:///c:/Users/olive/guang-code/dist/utils/storage/index.js)、[storage/types.js](file:///c:/Users/olive/guang-code/dist/utils/storage/types.js) |
| 2 | **Skill 多层作用域 + 热更新**（`packages/skill/`、`docs/subsystems/skills.md`） | SkillLoader 2.0：5 层作用域 `builtin → global → project → session → runtime`，优先级升序覆盖。每个 Skill 用 SHA-256 digest 做增量加载，FS Watcher 触发 hot-reload，`digests.json` 做缓存对比。 | [skillLoader.js](file:///c:/Users/olive/guang-code/dist/utils/skillLoader.js) |
| 3 | **工具流水线洋葱模型 / Waterfall**（capability-seams.md → Tooling Seam） | `ToolPipeline`：`pre → execute → post → error` 四相监听，按 `priority` 排序。内置 6 个拦截器：超时（Bash/AgentTool/通用三级）、权限门控、输出截断（20k 字符）、脱敏（secretScanner）、审计追踪、插件 pre/post 钩子。所有工具必须走 `defaultToolPipeline.run()`。 | [toolPipeline.js](file:///c:/Users/olive/guang-code/dist/utils/toolPipeline.js)、[QueryEngine.js#L1021-L1048](file:///c:/Users/olive/guang-code/dist/utils/QueryEngine.js#L1021-L1048) |
| 4 | **插件沙箱 + 审批模型**（`packages/sandbox/`、`docs/subsystems/sandbox.md` + `docs/subsystems/approval.md`） | `BasicVmSandbox` 基于 Node 原生 `vm` 模块，屏蔽 `process/fs/child_process`，仅通过 `api` 暴露受限能力；`FileAccessPolicy` 白名单控制读写路径；`ApprovalFlow` 支持 4 种审批模型：`none / user_confirm / llm_vote / user_and_llm`。 | [pluginManager.js](file:///c:/Users/olive/guang-code/dist/utils/pluginManager.js) |
| 5 | **Event Sourced Session**（`packages/session/`、`docs/subsystems/session.md`） | `SessionEventStore`：JSONL append-only 事件流，26 种事件类型（`MessageAdded/ToolCallInitiated/MemoryWritten/...`），SHA-256 哈希链（`prevHash → seq → id|type|payload`），每 100 事件写 projection 快照；超过 2000 事件自动用 Brotli 归档 `events.N.jsonl.br`；支持 Fork 会话谱系。 | [sessionES.js](file:///c:/Users/olive/guang-code/dist/utils/sessionES.js) |
| 6 | **Compaction 可插拔 Seam**（spill + compaction catalog） | `SessionCompactor` 抽象基类 + 注册表，4 种策略：<br>• `keep_last`（保留尾部 N 条）<br>• `summary_inject`（目标+统计模板标记，无 LLM）<br>• `summary_llm`（调用 LLM 提炼 4 段式摘要，失败自动退化为 inject）<br>• `hybrid`（按消息数 <40 / 40-200 / >200 切换）。硬约束：LLM 失效时必须降级 hybrid。 | [compaction.js](file:///c:/Users/olive/guang-code/dist/utils/compaction.js) |
| 7 | **多协议 SDK 互操作层**（`packages/mcp/` + `packages/acp/`） | `sdkInterop.js`：同一 `SdkServer` 挂接 3 种协议自动识别：<br>• MCP（`application/mcp+json`）<br>• ACP（PubSub + JSON-RPC SSE）<br>• 原生 JSON-RPC 2.0（NDJSON chunked HTTP + SSE 订阅）。传输层统一 `InProcessServerTransport` 抽象。 | [sdkInterop.js](file:///c:/Users/olive/guang-code/dist/utils/sdkInterop.js) |
| 8 | **Web UI + Chat Composer**（`packages/web/`、`docs/subsystems/web.md`） | `GuangWebServer`：零依赖 Node 原生 `http` 模块，单文件 SPA（`dist/ui/index.html`）。`/api/ui/chat` 端点用 SSE 流式输出（`text_delta / tool_start / tool_done / done`），Web 端默认拒绝高风险（Bash/Write/Delete）操作。| [webServer.js](file:///c:/Users/olive/guang-code/dist/utils/webServer.js) |

> **关键结合哲学**：DSH = "一组设计约束"，guang-code 把它们翻译成"不需要外部依赖的自建实现"——每个 seam 都是独立 class，对外暴露统一接口，内部可以替换实现。这就是 DSH 文档反复强调的 **Capability Seam ≠ 实现，而是可替换边界**。

---

### 二、目前为止 guang-code 做了哪些和 Memory 有关的工作

这是整个项目投入最大的子系统。从"进化层次"可以分成 5 层，每层都向后兼容：

#### 2.1 L0：Legacy Markdown 记忆系统（保留作回滚基线）
- **结构**：每个项目一个独立 `MEMORY.md`（index，最多 200 行 / 25KB），链接指向 `memory/` 目录下的独立 topic 文件。
- **元数据**：每个记忆文件用 frontmatter 声明 `name / description / type`（user / feedback / project / reference 四分类）。
- **防御机制**：`truncateEntrypointContent()`：index 超过行数/字节上限时截断并追加警告；`secretScanner` 写入前扫描密钥。
- 代码：[memdir.js](file:///c:/Users/olive/guang-code/dist/utils/memdir.js)

#### 2.2 L1：MemoryDomain KV 结构化存储（当前写路径主通道）
- 升级了 Legacy 的"文本文件"为"结构化条目"，通过 `StorageHub` 持久化。
- **三表设计**：
  - `entries`（key=id, value={type,name,description,content,tags,createdAt,updatedAt,legacyFilePath}）
  - `indexLines`（按插入顺序 seq=1..200，最新放最前，构建 prompt index 时保持稳定排序）
  - `stats`（entriesTotal / lastAddAt / lastMigrationAt...）
- **迁移策略**：渐进式无风险升级。懒加载首次读时自动 `migrateLegacyMarkdownToKV()`（扫描 Legacy 目录导入）；写入时采用 **dual-write**：KV + Legacy Markdown 都写，直到用户显式执行 `/memory compact-kv` 关闭 legacy。
- 代码：[memoryDomain.js](file:///c:/Users/olive/guang-code/dist/utils/memoryDomain.js)

#### 2.3 L2：MCP Memory Backend 适配器（外挂式记忆联邦）
解决"一个项目要同时接 Memorix / MCP Reference Memory / Engram 三种不同 memory 服务器"的问题。
- **自动发现**：按正则 `/^(memorix|memory|engram|.*-?memory.*)$/i` 从 MCP 连接里筛候选服务。
- **Canonical Actions 路由表**：每个动作定义一串候选工具名，逐个尝试。例如 `add` → `add_memory / memorix_add_memory / memory_add / engram_add / store_memory / remember`。
- **参数 Shape 自动适应**：同一个 add 动作，尝试 4 种参数结构（`{title,content,type}` / `{name,content,memory_type}` / `{key,value,type}` / `{memory:{...}}`）。
- **Prompt 注入**：`loadMemoryForPrompt()` 返回 `{text, sources, backend, server}`，格式与 KV 后端完全一致，上层 QueryEngine 不需要关心具体后端是谁。
- 代码：[mcpMemoryBackend.js](file:///c:/Users/olive/guang-code/dist/utils/mcpMemoryBackend.js)

#### 2.4 L3：Memory Backend Registry 多后端路由（Hybrid 默认）
统一入口，4 种模式：
| 模式 | 写入路径 | 读/构建 Prompt | 适用场景 |
|---|---|---|---|
| `legacy` | 只写 Markdown | 只从 Markdown 读 | 旧版本兼容 / debug |
| `kv` | KV + Markdown（dual-write） | 从 KV 读 | 无 MCP 环境的离线开发 |
| `mcp` | KV + Markdown + MCP（三者全写，**写入兜底**） | 优先 MCP，失败按 `mcpFallbackToKV` 退 | 用户自己部署了 memory 服务器 |
| `hybrid`（默认） | 同 mcp | **MCP 有结果用 MCP（相关性检索），空结果自动用 KV（最新条目前 N 条）** | 生产环境推荐（最稳妥） |
- 附带 `/memory` CLI 命令集：`/memory backend` 切换、`/memory status` 看统计、`/memory migrate` 手动迁移 Markdown→KV、`/memory search <query>`。
- 代码：[memoryRegistry.js](file:///c:/Users/olive/guang-code/dist/utils/memoryRegistry.js)

#### 2.5 L4：QueryEngine 里的 Prompt 动态拼装（Working Memory 层）
记忆不是"全倒进去"，而是做了三道门：
1. **相关性筛选**：用 `lastUserTextForMemory()` 取最后用户输入的前 500 字符作为 `relevanceQuery`，MCP 后端走 `searchEntries(query=...)`（语义/子串检索），KV 走 substring 过滤。
2. **数量与字符硬上限**：最多 6 条、每条正文最多 9000 字符，超额截断追加 `[...truncated]`。
3. **自动会话压缩**：chatHistory 估算字符 > 60k 时触发。优先走旧版 `autoCompactChatHistory()`（构造 [KEY REFERENCES] + 首尾上下文），失败回落到 `compactionRegistry.run('hybrid')`，结果再注入 `[Conversation compacted via strategy=xxx]` system marker。
- 代码：[QueryEngine.js#L345](file:///c:/Users/olive/guang-code/dist/utils/QueryEngine.js#L345)、[QueryEngine.js#L379-L441](file:///c:/Users/olive/guang-code/dist/utils/QueryEngine.js#L379-L441)

#### 2.6 附带：Session 级别的短期记忆
- Event Sourcing 本身就是"会话记忆"：所有消息、工具调用、权限决策、记忆写入都在 JSONL 里，可以重放、审计、Fork。
- `projection.json` 缓存 messagesIndex / toolPermissions / skillsInvoked 等派生状态，避免每次启动全量 replay。
- 代码：[sessionES.js](file:///c:/Users/olive/guang-code/dist/utils/sessionES.js)

---

### 三、这些优化如何复用在其他 Agent 项目里 & Agent 记忆设计方法论

#### 3.1 记忆为什么重要——Agent 的"失忆问题"
没有记忆系统的 LLM Agent 本质上是一个**Stateless Function**：每轮对话都像"第一次见面"。这会导致 4 类致命问题：
- **用户体验差**：每次都要重述项目背景、技术栈、个人偏好。
- **跨会话知识断裂**：昨天确定的技术决策（"我们不用 TypeScript 严格模式"）今天就忘记了。
- **长对话崩塌**：超过 context window 后要么截断丢信息、要么 token 费用爆炸。
- **无法积累组织知识**：团队成员各自用 Agent，经验不能沉淀复用。

记忆系统的终极目标是让 Agent 具备 **Continuity（连续性）**、**Contextual Awareness（情境感知）**、**Learning over Time（随时间学习）**。

#### 3.2 可直接复用的 8 个 guang-code 模式

| 模式 | 说明 | 可复用点 |
|---|---|---|
| **① Layered Memory 三层架构** | LTM（长期，跨会话持久化）→ STM（短期，单会话 Event Sourcing）→ WM（工作记忆，当前轮 Prompt 内注入） | 任何 Agent 项目都可以先画这三层图：每一层的写/读路径、触发条件、数据格式。 |
| **② Backend Interface + Registry** | `MemoryBackend` 统一接口（addEntry / searchEntries / loadMemoryForPrompt...），用 Registry 注册多个实现。所有调用方只依赖 Registry，不依赖具体后端。 | 未来接入向量数据库（Chroma / Milvus）、Graph Memory 时，只要加一个新的 Backend 类注册即可，不污染上层业务。 |
| **③ Dual-Write + Lazy Migration** | 新老系统并存：双写、懒迁移、用户手动确认后再切主。 | Agent 系统迭代快，迁移策略**必须是默认设计**，不能等"有空了再做"。 |
| **④ Relevance over Recency** | 不是"取最近 N 条"，而是"用当前用户 query 做相关性检索"。Prompt 注入时 MCP 和 KV 都要先过 query 匹配。 | 这是 Memory 系统能否真的"有用"的分水岭。纯 recency 在 50 条以上记忆基本就失效了。 |
| **⑤ Graceful Degradation 链** | `LLM summary → template summary → keep_last`；`MCP → KV → Legacy`；`SQLite → JSON`。每一步都有 fallback，不会因为任何一个外部依赖挂了就让整系统不可用。 | 生产级 Agent 必须是"**韧性系统**"（resilient）。外部分布式组件（MCP server / LLM API / SQLite native 模块）天然会失败，设计时就要想好"那怎么办"。 |
| **⑥ Capability Seam 思想** | 把记忆拆成独立 seam：Storage Seam、Compaction Seam、Retrieval Seam、Routing Seam。每个 seam 有自己的 Registry、策略枚举、默认实现。 | 好处是团队可以并行开发，每个 seam 单独测试，架构演进不会牵一发动全身。 |
| **⑦ Token Budget 硬约束意识** | 每个记忆条都有字符上限，整个 <memory> 块的大小要进预算检查，和系统 prompt + 项目指令一起核算。 | 记忆系统**最容易犯的错**是"为了完整把所有东西都塞进去"——结果就是 LLM 注意力被稀释，中间段的记忆被 wash out（Lost in the Middle 效应）。宁少勿滥。 |
| **⑧ Auditability & Security** | 工具流水线审计、记忆写入扫密钥、会话 SHA-256 哈希链防篡改、插件沙箱白名单。 | 记忆 = 持久化数据，一旦写错泄露就是法律风险。这是企业落地的硬门槛，不是可有可无。 |

#### 3.3 从零设计一个 Agent 记忆系统——核心关注清单（Checklist）

按"必须回答的问题"列出：

**① 记忆分类（What to remember?）**
- [ ] 有几种语义类型？至少要拆：`user_profile`（长期个人偏好）/ `project_context`（项目约定/文件结构）/ `decision_log`（已做决策）/ `learned_facts`（查过的 API/文档）。
- [ ] 每条记忆的元数据最少要有：`id / type / title / description / tags / createdAt / updatedAt / source`（来源）。

**② 写入触发（When to write?）**
- [ ] 显式写入：用户用 `/remember` 命令 / Agent 调用 `add_memory` 工具；
- [ ] 隐式写入：长会话结束时自动提炼、用户点赞/踩的回答、任务成功完成后的决策摘要。

**③ 检索策略（How to recall?）**
- [ ] 混合检索是标配：Lexical（子串 / BM25）+ Semantic（embedding 向量）至少二选一。
- [ ] Rerank：返回的 topK 结果必须再过一层相关性排序（简单实现可以按 `updatedAt` + `tag match` 打分）。
- [ ] Recency decay：1 个月以前的记忆要降权，除非用户主动提到。

**④ Prompt 注入（How to inject into context?）**
- [ ] 注入上限：<memory> 块的 token 数一般不超过总 context 的 15-20%，LLM 的注意力承载是有限的。
- [ ] 结构化注入：Index（列表）+ 展开正文，不要只塞一整坨文本。
- [ ] 注入说明：告诉模型"当你需要回忆什么时可以 search_memory，当需要记住时可以 add_memory"——否则很多模型不知道自己**拥有这个能力**。

**⑤ 压缩与遗忘（How to forget?）**
- [ ] 必须有 compaction 策略，默认 auto-trigger（字符数阈值或消息数阈值）。
- [ ] 压缩后要生成 system marker（目标/决策/阻塞点四段式），保留关键信息。
- [ ] 提供手动压缩 / 手动删除命令。

**⑥ 安全与治理**
- [ ] 写入前做密钥扫描（AWS key、JWT、私钥等模式匹配）。
- [ ] 记忆文件访问路径受 FileAccessPolicy 白名单控制。
- [ ] 所有写入事件进入审计日志（用户可以看 Agent 偷偷写了什么记忆）。

**⑦ 可观测性**
- [ ] Stats 页：总条目数、各类型分布、最近写入、后端使用情况。
- [ ] Debug 开关：能打印"本轮对话注入了哪些记忆，来源是什么"，否则出问题根本无法排查。

---

**总结一句话**：Guang-code 的记忆系统可以概括为 **"三层架构 × 四个后端 × 一条降级链 × 一套 Seam 化接口"**。它的设计精髓不在于"用了多先进的向量数据库"，而在于**用最小依赖实现了生产级记忆系统该有的 7 个非功能性特征：渐进迁移、韧性降级、Token 预算、可审计、可扩展、安全可控、多后端联邦**。这些模式几乎可以原样平移到任何基于 LLM 的 Agent 项目中。
