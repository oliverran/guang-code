# PPC — Propose–Probe–Compose for DeepSeek Harness

把 Harness² 的递归自我改进落成 DSH 的一个插件包 `packages/ppc/`。方法论来自
[arXiv:2610.14224](https://arxiv.org/abs/2610.14224)（见 `_third_party/harness2`），
执行宿主是 DSH 自己。

## 为什么不是把 harness2 跑在 DSH 上

`--substrate dsh`（P0，已交付）让 harness2 的实验方法能驱动 DSH。但它的成本模型是
**每个任务 4k 次 rollout + 3k 次 editor session**，交互式编码场景不可接受，而且它的
harness 是 per-task 临时物化的，不落回主 harness。

PPC 采纳它的方法论，改变执行节奏：

> **离线低频改进 + 在线高频检索。** 用 PPC 周期性（每周 / 每次大版本后）对
> `.dsh/skills`、`AGENTS.md`、`PERSONA.md`、`hooks.json` 做批量改进，落成 library；
> 日常任务只读 library 做检索增强，零额外延迟。

## 两层递归

| harness2 概念 | PPC 落点 |
|---|---|
| execution harness | DSH 的 5 个可编辑面（见下表） |
| improvement harness（`R_t`） | `$DSH_HOME/ppc/library/` |
| task-level recursion | `ppc.run(taskId, {k, mode})` |
| harnessing-level recursion | `ppc.record(domain, harness, experience)` |

### 可编辑面（与 `DSH_SURFACE` 一致）

| 组件 | 路径 | 注入方式 |
|---|---|---|
| C1 persona | `PERSONA.md` | `--patch` overlay 替换 `system-prompt.config.persona` |
| C2 instructions | `AGENTS.md` | `dsh-agent-instructions` 从 workspace 读 |
| C6 skills | `.dsh/skills/<n>/SKILL.md` | `ctx.skills.registerProvider` 或直接落 workspace |
| C7 scripts | `scripts/<n>.py` | bash 直跑 |
| C8 hooks | `hooks.json` | `hooks-claude-code` 的 `configPath` |

**subagent 是 DSH 的空洞**：`ctx.subagents.registerProvider()` 纯代码注册，无文件发现。
所以 PPC 不把 subagent 当可编辑面 —— 需要它时用 `subagent-spawn-in-process` 现开。

## 六个包

```
packages/ppc/
  ppc-core/          service 定义（ctx.ppc）+ 配置 + 路径解析
  ppc-evidence/      session log → 共享 grammar 的 evidence tree
  ppc-propose/       临时 skill bundle + editor session
  ppc-probe/         N 个并发 fresh agent 跑 staged harness
  ppc-compose/       匿名选择器：从候选池里挑一个产出物
  ppc-library/       INDEX.md / EXPERIENCE.md / 检索
  command-ppc/       slash command
```

### M1 · ppc-evidence

**输入**：一个刚跑完的 probe agent 的 `Session`。
**输出**：`$DSH_HOME/ppc/working/<taskId>/<round>/evidence/rollouts/<label>.md`

直接复用 [substrate/dsh.py](../../_third_party/harness2/harness2/substrate/dsh.py) 的
`render_events` —— 它已经把 DSH 的 packed chunk row、`surfaceOp` 三态、`tool/result`
三层错误信号都处理好了。这正是 P0 的意外收益：**同一份解析器，实验和在线共用**。

```
evidence/
  task.md              任务原文（由 caller 提供）
  rollouts/<label>.md  完整 trajectory
  deliverables/<label>/  产出物
  harness/             当前 harness 树（proposer 编辑对象）
  library/INDEX.md     同 domain 历史条目
```

关键约束（照抄 harness2）：**evidence 只以文件服务，prompt 只给指针**，不做 prompt 内联
截断。

### M2 · ppc-propose

harness2 让 proposer 用文件编辑工具改 `context/harness/`。DSH 的 proposer 是
`subagent-spawn-in-process` 的 fresh child，要给它编辑能力就得挂 `tool-fs`。

PPC 的做法：**editor session 的 cwd 就是 staged harness 目录本身**，挂 `tool-fs`
（write/edit）+ `tool-bash`（跑 `scripts/` 验证）。它改的就是真实的 staged harness
副本，改完直接可跑 —— 不需要"提案格式"再 apply 一次。

这比 harness2 更简单：harness2 需要 `harvest` 机制把 workspace 拷出来
（[proposer.py `_harvest`](../../_third_party/harness2/harness2/core/proposer.py)），
PPC 直接就地编辑。

**三个必须做对的地方**（M2d 补上的）：

1. **editor 必须能写。** DSH 部署默认的文件策略是 `read-only`，editor 在那个策略下
   根本写不了它被指去的 harness —— 每份提案都空手而归，而这个失败看起来像是模型的
   问题。所以 session 建好后立刻 `setSandboxMode(session, 'workspace-write')`：写入被
   限制在 session 自己的工作目录（staged harness）加平台临时目录，而部署默认值不变。
   切换是 session 日志上的 `sandbox/mode` 事件，可重放、可审计。
2. **mission 里的路径必须是真实路径。** editor 的 cwd 就是 harness，所以 harness 是 `.`，
   证据树是它旁边的目录。`workspacePath()` 按 editor 读得到的方式渲染路径。旧的写法
   写的是 `context/harness/`，而树里根本没有 `context/` 这一层 —— proposer 会去找一个
   不存在的目录。
3. **evidence layout 的名字必须和磁盘一致。** `missionFor()` 列出的是相对树根的真实
   目录名，不是某个前缀。

**可编辑面的唯一定义**：`ppc-surface` 的 `DSH_SURFACE` 值承载全部规则（always-on 文件
和上限、skill/script 目录、hooks 文件和事件、触发模板、种子文件）。`gen-ppc-surface.ts`
把它发布成 `surface-manifest.json`，harness2 的 Python substrate **读那份 manifest**
而不是重复这些值。两棵树各写一份可编辑面必然漂移：一个树接受、另一个树拒绝的路径，
就是一份在一处通过校验、却在另一处被丢弃的提案。

**这个 manifest 已经抓到一处真实漂移**：harness2 的 `is_allowed` 把 `sub_agents/` 写死在
共享正则里，所以 DSH 的面会接受 `sub_agents/<n>/AGENT.md` —— 而 DSH 的 subagent 是纯
代码注册，那个文件没有任何运行时会加载。已改成 per-surface 的 `subagent_dir`（DSH 传
`None`），路径直接不在面上。

**D1/D2 两个维度**（照抄 harness2 的 INV/DOM）：
- `INV` — procedure / tool use / completion（怎么做事）
- `DOM` — 领域知识（做什么事）

各起 k 个候选，并发跑。验证失败重试一次，仍失败则 fall back 到 base（不丢弃任务）。

### M3 · ppc-probe

**对照实验的严格性是全部价值所在**，所以：

```ts
const agent = await agents.create({
  sessionId: SessionId(`ppc-probe-${label}-${randomUUID()}`),
  meta: { cwd: staged.root },        // cwd 就是 staged harness 本身
  agentOptions: { provider, model }, // 冻结，不变
  setup: (agentCtx) => {
    // PERSONA.md 不从磁盘读：它是 deployment persona，一个 prompt section
    agentCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: persona })
  },
})
```

**实现里定下来的几件事**（不是猜的，是照运行事实定的）：

- **cwd 就是 staged harness**。`dsh-agent-instructions` 从 project root 沿链读到 cwd，
  `dsh-skill-filesystem` 从 cwd 向上找到最近的 `.git` 定 project root。staged harness 在
  临时目录里，上面没有 `.git`，所以 provider 认定的 project root 就是 staged 目录 ——
  前提是上方没有目录抢走这次上溯。cwd 设成别的目录，probe 读到的 `AGENTS.md` 就会是另一份。
- **persona 必须注册成 prompt section**。`PERSONA.md` 运行时从不打开；只把文件 staged
  进去而不注册，跑起来的是部署自己的身份，测了个寂寞。
- **不需要 `sessions.flush`**。`Session.events` 本身就是渲染的来源，session log 是给
  持久化和审计用的，不是给这一阶段读的。
- **并发限流在 `runProbes` 的 `concurrency` 选项上**（默认 2，对齐 harness2 的
  `PHASE_WIDTH`），不是 `Config.probeConcurrency` —— 这个包是纯库，没有 plugin 配置面。
- **失败的候选不中断 sweep**。死掉的 rollout 是发现，其余候选仍然测着各自的 harness；
  重复 label 被跳过而不是运行（否则两个候选互相覆盖对方的 staged harness）。
- **结果按候选给出的顺序返回**，与完成顺序无关。

**回传 evidence**：`probeEvidence(results, base, budget)` 产出两样东西 —— `rollouts`
（这次运行做了什么）和 `candidates`（每个候选的 harness、相对 base 的 unified diff、
它的 rollout、它的输出）。diff 相对 **base** 算，因为候选的价值在于它相对自己派生自的
那份 harness 改了什么。边界声明**不在这里加**：`dsh-ppc-evidence` 写每个 trajectory 文件
时都会加，加两次就是读者要读两遍。

**这是 DSH 相对 harness2 的净增益**：DSH 的 `tools/pre-execute` / `post-execute`
waterfall 可以在 probe 期间挂临时探针采集结构化证据，而不必像 harness2 那样事后解析
markdown trajectory。第一版先不做，留作 M3.5。

### M4 · ppc-compose

k 个候选各跑完 probe 后，起一个 fresh selector 挑一个产出物。

**匿名性是这个阶段存在的理由。** selector 能分辨「哪个候选用的是未改动的 harness」，
就不是在产出物之间选，而是在给「产出物是怎么来的」编故事——而这个故事永远是同一个：
越精巧的赢。所以 selector 读到的 pool 里**只有候选产出物**，而且刻意不持有：

| 不持有 | 为什么 |
|---|---|
| 候选的 harness 和 diff | diff 直接写着「这个是改编过的」 |
| 候选的 rollout | trajectory 里就是 harness 自己的指令 |
| 候选的 label（`base`/`inv1`/`dom1`） | label 说的是角色，角色说的是 harness |

**实现里定下来的几件事**：

- **匿名 id 是稳定 + 洗牌**。候选先按 label 排序（确定性起点）再按 seed 的哈希洗牌。
  稳定来自哈希而不是随机源，所以失败后的重跑在同一批字母里选择，之前记下的理由里的
  id 仍然指向它当时指向的候选；洗牌让 id 不跟随 label 的字母序，否则「第一个展示的
  候选」和「字母序第一的候选」就是同一个。id 只有字母，所以候选自己的 label 永远
  不会被误认成 id。
- **什么都没产出的候选不进 pool**。selector 会被要求在一个产出物和一个失败之间挑，
  而失败在任何一条标准下都赢不了。丢弃被记录在 `dropped` 里，不是静默的——
  「看起来最好的那个候选根本没得到机会」是关于 probe 的发现。
- **selector 的 cwd 就是 pool**。它读不到候选的 harness、evidence tree 或 probe 的
  工作目录；匿名性不靠提示词保证，靠它能看见的路径保证。
- **写入能力是零**。工具面被作用域限制收缩到 `read`/`grep`/`glob`。agent 能看见的
  能力就是它可能去试的能力，而一次被拒的调用要白费一轮。**没挂读工具的部署保留
  完整工具面**：既然没什么可读，pool 的文件本身就是 mission 的主题。
- **choice 的 id 拿 pool 自己发过的 id 校验**，不是只校验形状。pool 只发了 A/B 时
  点了 C 的 selector，产出的是一个无法兑现的决定。
- **回退是中性的替代品，不是偏好**。selector 失败/超时/点了不存在的 id，回退到
  base（没有 base 就第一个候选），因为 base 是那个不需要任何理由的结果——它就是
  这一轮从未发生过时部署本来会交付的东西。失败记在 `error` 里，结果带
  `fallback: true`，读者能分辨一次真正的选择和一次替代。

**与原设计的偏离**：原设计说 selector 看 `evidence/pool/<label>/{harness.diff,
rollout.md, produced.md}`。实现只给它 `produced.md`——一个能看见 diff 的 selector
能分辨「改编过的」和「没改的」，匿名性当场作废。diff 和 rollout 留在 evidence 树里，
给 propose 阶段和将来 M5 的经验蒸馏用。

### 验收：demo + service

`scripts/ppc-loop.ts` 拥有整轮循环，两个入口跑**同一份代码**：

- `pnpm run demo:ppc` — 终端里逐阶段打印
- `pnpm run service:ppc` → http://127.0.0.1:3111 — 浏览器 dashboard，SSE 实时推送

一个复刻了循环的 demo 是 demo 的 demo，两者一旦漂移，验收证据就在讲一个没人发布的东西。

**跑通真实 provider 之后，循环自己抓出了三个真 bug**（都不是测试能发现的）：

1. **editor 读不到证据树**。editor 只有 `read`/`write`/`edit`/`bash`，没有列目录的
   工具，而证据树的形状取决于哪些 rollout 跑过——所以它只能猜文件名。猜不到就
   断定「我没有证据」，于是回答 KEEP_BASE。这个结论来自一份缺失的目录列表，却
   长得和一个正确答案一模一样。修法：`EDITOR_TOOLS` 加上 `glob` 和 `grep`。
2. **evidence layout 谎报了 `deliverables/<label>/`**，而那个目录根本没写出来
   （probe 不收集产物）。被派过去的 proposer 同样空手而归。修法：只有真的产出
   了文件的 rollout 才进 `deliverables` map，layout 也才列它。
3. **selector 把 pool 的注解头部算成了候选内容**，理由是「A 和 B 带了请求者没要的
   注释头」。修法：注解头部明确标注「不属于候选的产出」。

第 3 条尤其说明为什么「只读产出物」还不够：**比较用的脚手架也会变成被评判的对象**，
而它评判的不是工作本身。

### M5 · ppc-library

包：[`packages/ppc/ppc-library`](../../deepseek-harness/packages/ppc/ppc-library/)，
`@deepseek-ai/dsh-ppc-library`。纯库，不注册 service，不挂 plugin。

目录布局（沿用 harness2 的
[core/library.py](../../_third_party/harness2/harness2/core/library.py)）：

```
<root>/<domain>/
  INDEX.md                        # 索引，proposer 先读这个；派生而非手写
  harnesses/<taskId>/harness/     # 完整的被采纳 harness 树
  harnesses/<taskId>/EXPERIENCE.md
```

`domainDir` / `slug` 折叠分隔符，领域名和任务 id 永远不可能指向库外的路径。

#### 准入门控（harness2 反 hallucination 的核心，不能去）

`EXPERIENCE.md` 四字段，前三条缺一**完全不写**，调用返回 `{ rejected }`，库保持原样：

```markdown
- **cue**:        触发条件（这条经验适用的情势**形状**，不是本次任务的事实）
- **lesson**:     可迁移的结论（对 harness 执行的操作，点名它针对的组件）
- **evidence**:   支撑它的执行对比（引用具体 rollout 时刻）
- **confidence**: 置信度（可选）
```

**门控在写入处强制，不在读取处**：写入是唯一能强制这条规则的地方，因为后来的读取
只会找到写入允许存在的东西。

#### 蒸馏（harness2 的 `_distil`）

`runDistiller(ctx, options)` 跑一个 agent 读完整轮的记录，写出至多一条经验。
`distilMission(options)` 渲染 mission。

mission 里两条关键声明：

- **被采纳的候选不是唯一的证据**：选择是在藏起 harness 的情况下比较交付物的，所以这个
  选择说的是哪个产出物读起来最好，而不是哪个编辑起了作用。蒸馏读 trajectory，不读判决。
- **判决可以是 `confounded`**：一次改了多个组件而没有执行能隔离出其中一个时，记录展示的
  就是这个。只靠 confounded 对比支撑的经验是猜测，而库里的猜测会被之后每个任务当事实读。

失败、超时、`NO_ENTRY` 拒绝、或缺必需字段 → **完全没有经验**。这是正确结果：这一轮
没教出任何能被存下的东西。

#### 检索（词面）

`retrieve(options)` 用 `cue` 与任务文本的 token **Jaccard 重叠**打分：

- 阈值 `minScore`（默认 0.12），深度 `topN`（默认 3），同分按 task id 决胜
- 打分只算在 `cue` 上：`cue` 是情势形状，`lesson` 又长又具体，算在它上面等于拿任务去
  匹配经验的措辞
- 词面而非语义，是刻意的：可解释、免费、且在库的规模上足够
- `renderLessons(matches)` 只渲染 `cue` 和 `lesson`——`evidence` 动辄几百字，进 prompt 太贵

#### 与 M4 的共享

selector 和 distiller 都是「读一个目录、回答一个问题」的 session。两者共同的性质
（全新、cwd 就是读的目录、写入能力为零）由 `ppc-evidence` 的 `runReader` 统一持有，
两处各写一遍必然漂移——jscpd 就是这么抓到第一个 clone 的。

#### 落地

`scripts/ppc-loop.ts` 现在跑完整五阶段（probe → propose → probe → compose → library），
demo 和 HTTP dashboard 共用它。

### M6 · 在线检索（子上下文注入）

用户选了**子上下文注入**而非临时 skill。落点是
[`ctx.systemPrompt.context()`](../../deepseek-harness/packages/core/system-prompt/README.md#L21)：

```ts
ctx.effect(() => {
  const dispose = ctx.systemPrompt.context({
    name: 'ppc:library',
    order: 50,                        // persona(0) 之后，tool guidance(100-199) 之前
    text: () => renderLessons(matches),
  })
  return dispose
})
```

`PromptContext` 的三个字段决定了这个选择是对的：
- `name` 唯一，重复注册 throw
- `order` 明确，不会和别的插件打架
- `text` 是 provider 函数，**每次 assemble 按当前任务评估**，不是固定字符串

而且它 materialize 成 **durable user-role snapshot**（[system-prompt README](../../deepseek-harness/packages/core/system-prompt/README.md#L21)），
意味着注入的内容进 session log、可 replay —— 符合 DSH 的
「Model-visible ⟺ logged」不变量。临时 skill 做不到这点。

**检索算法**（零依赖）：`cue` 与当前任务描述的 token Jaccard 相似度 ≥ `minScore`
（默认 0.12）则命中，取 top-N（默认 3）。harness2 用的是 LLM 语义检索，我们先用词面
近似 —— 便宜、可解释、无依赖，且 library 规模小时足够。

**注入内容只有 lesson 和 cue，不含 evidence**（evidence 是几千字的 rollout 摘要，
进 prompt 太贵）。需要细节时模型可以 `read` library 目录。

### M7 · slash command

```
/ppc run <task-id> [--k N] [--mode parallel|sequential] [--domain D]
/ppc library show <domain>
/ppc library forget <domain> <task-id>
/ppc working clean [--task <task-id>]
```

复用 [packages/interaction/commands](../../deepseek-harness/packages/interaction/)
的 command 注册模式。

## 与 P0 的关系

P0 的 `--substrate dsh` 和 PPC 有 80% 的执行逻辑重叠（跑一次 DSH rollout、拿回
trajectory）。区别在于谁编排：

| | P0 | PPC |
|---|---|---|
| 编排者 | harness2 的 `core.recursion` | PPC 自己 |
| 成本 | 4k rollout + 3k editor | 默认 k=2，约 10 rollout + 6 editor |
| harness 落点 | per-task 临时 | library 累积，跨任务 |
| 用途 | 复现论文 | 日常改进 DSH 自己 |

PPC 的 probe 应当直接调用 `_third_party/harness2/harness2/substrate/dsh.py` 的
`DshSubstrate`，而不是重写一遍 —— 保证两条路径的 rollout 语义完全一致。

## 实施顺序与风险

| 阶段 | 内容 | 风险 |
|---|---|---|
| M1 | evidence | 低。解析器已测。 |
| M2 | propose | 中。`tool-fs` 的 write 白名单要放开到 staging dir。 |
| M3 | probe | 中。并发 + API 成本；需要 `Config.probeConcurrency`。 |
| M4 | compose | 中。匿名化容易被泄漏（文件名、diff 内容）。 |
| M5 | library | 低。纯文件 IO。 |
| M6 | 检索注入 | 中。相似度阈值需要调；误注入会污染 prompt。 |
| M7 | command | 低。 |

M1–M5 已落地。`packages/ppc/` 下六个包，322 个测试。

## 明确不做

- **不做 adaptive recursion**（按难度分配预算）：先让固定 k 跑通。
- **不做 library 的自动合并/淘汰**：harness2 论文的 Future Work，值得做但不是第一版。
- **不改 DSH 的 model 权重**：整个方法是 `Agent = Model + Harness`，权重冻结。
- **不在第一版挂 tool loop 探针**：M3.5 的优化，先要 baseline 数字。