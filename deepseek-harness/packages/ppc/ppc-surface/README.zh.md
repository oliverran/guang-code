# dsh-ppc-surface

[English](README.md) | 中文

DSH 可编辑 harness 面：提案允许写哪些路径，以及 DSH 运行时要求它写下的文件满足什么。

本包是纯库。它持有一个路径谓词、一个校验器，以及描述这个面给 proposer 的提示文本。它不注册任何 service，也不挂载任何插件。

## 这个面

| 组件 | 路径 | DSH 怎么读它 |
|---|---|---|
| c1 persona | `PERSONA.md` | 由调用方替换进 `system-prompt.config.persona` |
| c2 instructions | `AGENTS.md` | `dsh-agent-instructions` 从项目根一路读到 cwd |
| c6 skills | `.dsh/skills/<name>/SKILL.md` | `dsh-skill-filesystem` 扫描项目根 |
| c6 helpers | `.dsh/skills/<name>/scripts/<file>.py` | 通过 bash 运行，必须随 skill 一起交付 |
| c7 scripts | `scripts/<name>.py` | 没有 loader；模型自己用 bash 跑 |
| c8 hooks | `hooks.json` | `dsh-hooks-claude-code` 在加载时读一次 `configPath` |

两个 DSH 的事实决定了这份清单：

- 没有文件形式的 subagent。`ctx.subagents.registerProvider()` 是纯代码注册，所以 `sub_agents/<name>/AGENT.md` 没有任何运行时会去加载，它不在这个面上。这个面用 `subagentDir: undefined` 明说这件事，而不是靠约定，所以读 manifest 的人不会把它误当成一个组件。
- 也没有插件文件；cordis 插件是 JavaScript，由 loader 注册。因此中间件控制这个组件由 `hooks.json` 承担。

`isAllowed(surface, rel)` 就是那个谓词。它从不抛错：一个逃出目录的路径只是不可编辑，而 `normalizeRel` 是另一个函数——它在调用方把路径拼到目录上时拒绝逃逸。

## 一个面，一份定义

`Surface` 值承载校验器执行的每一条规则：always-on 文件及其上限、skill 与 script 目录、hooks 文件及其事件、触发文件与触发行的模板、以及那些种子文件。调用方不再把上限和事件列表跟面分开传，所以持有同一个面的两个调用方不可能对某条规则有分歧。

`DSH_SURFACE` 就是 DSH 的面。同一份面还以 `surface-manifest.json` 发布——`pnpm run gen-ppc-surface` 写它，`pnpm run verify-ppc-surface` 校验它。harness2 的 Python substrate 读那份 manifest，而不是重复这些值，于是两棵树不可能用两种不同的方式描述同一个可编辑面。一个树接受、另一个树拒绝的路径，就是一份在一处通过校验、却在另一处被丢弃的提案。

## 校验

`validate(surface, tree)` 返回提案树的所有问题，以及它包含什么的清单。每一条规则都是 DSH 在加载时执行的规则，只是被重述了一遍，好让提案能在被 rollout 之前就被检查：

- frontmatter 缺 `name` 或 `description` 的 skill 会在加载时被丢弃。交付了这样一个 skill 的 harness 就是一个什么都不做的 harness，而那个「证明」它什么都没变的 rollout，也只证明了这一点。
- frontmatter 的 `name` 和目录名不一致时，加载时以 frontmatter 为准，于是所有指名目录名的触发行都不再匹配。
- always-on 文本从未点名的 skill 永远不会被打开。它只花 context，什么也换不到。
- 调用了提案没有交付的 helper 的 skill，会在调用的那一刻失败。
- 解析不了的 hooks 文件一个 hook 都不会注册，而且只在日志里说一声。这个检查覆盖运行时派发的事件名、matcher entry 的列表形状，以及 `command` 这种 hook 类型。
- always-on 文本超过上限的 harness，会在每一次运行里花掉 agent 自己的输出预算。

`autotrigger` 会给每个没有触发线的 skill 补一条，并跳过会突破上限的那一条。

## 读写一棵树

`readTree(surface, root)` 把一个提案目录读成一棵树，并报告那些存在于磁盘上、却在面之外的文件。运行时从不读的文件不是 harness 的一部分，所以它被报告出来，而不是被继续带下去。

`writeTree(surface, tree, root)` 把一棵树写进目录，替换掉原有内容。它拒绝任何面之外的路径。

## 对两棵树做 diff

`diffTree(base, candidate, label)` 产出两棵 harness 树之间的 unified diff。证据树会把候选的 harness 和它派生自的那份并排放着；没有 diff，读者只能手工比对两棵文件树——而真正要紧的差别，也就是 always-on 文本里改了哪几行，恰恰是读者最不会自己去重建的那部分。

diff 是按行的，改动两侧各带三行上下文，格式与 `difflib.unified_diff` 产出的 unified 格式一致。相距不到两倍上下文的处改动算一个 hunk，于是读者看到的是一段连续区域，而不是两块没有共同行的片段。文件按路径排序出现，所以同一对树永远产出同样的字节。

## Model Experience

### 给 proposer 读的面描述

#### What the model sees

proposer 读到的是面表格、always-on 的成本论证，以及那三条会丢弃整个提案的规则。表格是本包定义的面；规则是 DSH 运行时自己的加载期失败模式，重述一遍，好让不知道它们的 proposer 不会写出一个静默无效的 harness。表格是从 `Surface` 值渲染出来的，而不是在旁边另写一份：写死的表格和会变的谓词，是对同一个面的两份描述；两者一旦分歧，proposer 就会被告知去写一条运行时从不读取的路径。

##### 面表格

```markdown
| path | component | when it is in context |
|---|---|---|
| `PERSONA.md` | the deployment identity | ALWAYS ON — every token competes with the agent's own output budget |
| `AGENTS.md` | role, procedure, rules, durable facts | ALWAYS ON — same cost |
| `.dsh/skills/<name>/SKILL.md` | a reusable workflow | name+description advertised; the BODY is read ON DEMAND |
| `.dsh/skills/<name>/scripts/*` | a helper carried with its skill | run via bash |
| `scripts/<name>.py` | a deterministic helper | run on demand via bash |
| `hooks.json` | lifecycle hooks | fire INSIDE the tool loop, on every matching tool call |
```

#### Token effect

只有当调用方的 prompt 嵌入这段文本时才会产生 token；本包自身不增加任何 token。表格是六行、规则是几百词，所以这是一段固定的 prompt 前缀，而不是每次调用都要追加的东西。

#### KV Cache effect

无；本包不组装任何 provider 请求，也不触碰 prompt 组装。

## Known Limitations and Deferred Work

- 这个面列举的是 DSH 读取的路径，不是某个部署可能扩展出来的路径。自定义的 skill root，或会读别的文件的 preset，都不在这个面上，会被判为面外。
- skill frontmatter 检查把 `name` 和 `description` 当作标量读。用 YAML 嵌套来表达这两个字段之一的 frontmatter 不会被识别，该 skill 会被报成缺这个字段。
- always-on 上限按字符数计。DSH 自己的指令预算按字节计，所以两者不是同一个限制，通过这里的树在加载时仍可能被截断。
- 一个能解析、事件名也对得上的 hooks 文件，仍可能注册一条运行时失败的命令；本包检查的是 schema，不是命令的行为。