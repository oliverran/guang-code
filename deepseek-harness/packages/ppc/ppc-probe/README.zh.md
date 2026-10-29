# dsh-ppc-probe

[English](README.md) | 中文

Propose–Probe–Compose 循环的 probe 阶段：把提案 harness 跑在任务上，记录发生了什么。

probe 是一次真实的运行。它创建一个全新的 agent session，其工作目录就是 staged harness，把任务交给 agent，让运行时加载这份 harness 自己的指令和 skill。这次运行没有任何地方是模拟的——probe 的全部价值就在于它走的是部署将来要走的那条代码路径。

## staged harness

`stageHarness(surface, tree, root)` 把一个提案写进 DSH 能运行的目录。DSH 读取的三个组件落在三个不同的地方，其中任何一个搞错，都意味着 probe 测的是模型从没见过的另一份 harness：

- `PERSONA.md` 根本不从磁盘读取。它变成 deployment persona，而那是一个 prompt section，所以 `stageHarness` 把 persona 文本单独返回，由 probe 把它注册成一个 section。
- `AGENTS.md` 从 workspace 读取，从 project root 沿链走到 session 的工作目录。
- `.dsh/skills/<name>/SKILL.md` 从 project root 读取，skill provider 从 session 的工作目录向上走、找最近的含 `.git` 的目录来定位它。

最后一个是陷阱。临时目录里的 staged harness 上方没有 `.git`，所以 provider 认定的 project root **就是** staged 目录——这正是我们要的，但前提是上方没有任何目录抢走这次上溯。放在真实仓库下的 staged harness 会悄悄继承那个仓库的 skill。所以 staged 目录就是 session 的工作目录，`probeCwd(root)` 和 `probeWorkspace(root)` 都指向它。

`stageHarness` 会替换它写入的目录，所以 probe 绝不会跑在上一个候选的残留上。

## probe session

`runProbe(ctx, options)` 创建一个 agent，把任务交给它，然后读回 session log。

两件事让这次运行是一次公平的对照：

- **session 是全新的。** id 每次尝试都重新生成，所以候选不继承调用方对话的任何一轮。继承了调用方上下文的候选，测到的就不只是它的 harness，而是那份上下文，两个候选之间的差异也就大于 harness 之间的差异。
- **模型是冻结的。** 每个候选用同一个 route 和 id，所以两个 rollout 之间的差异就是两份 harness 之间的差异，而不是采样温度之间的差异。

persona 被注册为一个有作用域的 `deployment:persona` prompt section，它在这个 agent 的作用域里遮蔽部署自己的 persona。因此部署的 persona 正是被 probe 替换掉的那个——跑起来的是候选的身份。

## 这次 sweep

`runProbes(ctx, options)` 针对一个任务跑一组候选，同一时刻最多 `concurrency` 个。默认宽度 2 对齐 harness2 的 phase width：足以藏起一次慢的模型调用，又不至于让一次 sweep 一次花光预算。

失败的候选不会中断 sweep。死掉的 rollout 本身就是发现，其余候选仍然测着它们各自的 harness。重复的 label 会被跳过而不是运行：两个同 label 的候选会互相覆盖对方的 staged harness，而 pool 里会只出现其中一个其中。

结果按候选给出的顺序返回，与它们完成的先后无关。

## 失败

一个以 `completed` 以外原因结束的 turn 会产出 `delivered: false` 的结果，原因在 `turnReason` 里。只有 completed 的 turn 才算结果，零不算。

`dsh-ppc-evidence` 里的 `withDeadline` 限定等待时长，abort 的 signal 会取消它。超时的 probe 会被报为失败并把原因放在 `error` 里，而不是抛出去——所以一个死掉的候选不会中断整次 sweep。无论哪种情况，probe 自己的 agent 都会被 dispose，所以超时的 probe 不会留下一个活着的 agent。

## 交回 evidence

probe 产出的是 session log。它之后的阶段读的是目录而不是 log，所以 `probeEvidence(results, base, budget)` 把这次 sweep 整形成 evidence tree 自己的词汇：

- `rollouts` —— 每次运行做了什么，用共享的 `[ACTION]`/`[OBSERVATION]` 语法。
- `candidates` —— 每个候选的 harness、它相对 base 的 unified diff、它的 rollout、它的输出。

diff 是相对 base harness 算的，因为一个候选的价值在于它相对自己派生自的那份 harness 改了什么。`dsh-ppc-surface` 里的 `diffTree` 用 unified 格式产出它，按路径排序，所以同一对树永远产出同样的字节。

`producedBody` 在 probe 什么都没产出时说明为什么。一个在 agent 回答之前就结束的 probe，不是一个产出了零的 probe；原因本身就是发现。

边界声明不在这里加。`dsh-ppc-evidence` 会给写的每个 trajectory 文件加上它，而加了两次的声明就是读者要读两遍的声明。

## Model Experience

### probe session

#### What the model sees

模型看到任务、来自 `PERSONA.md` 的 persona，以及 harness 自己的组件带来的一切：instruction loader 从 workspace 读到的 `AGENTS.md` 链、skill provider 从 project root 发现的 skill、hook bridge dispatch 的 hook。每次 probe 都是一段全新的对话，所以模型只看到这一个任务和这一份 harness。

#### Token effect

任务是一个 prompt。harness 的 always-on 文本每一轮都在 context 里，和部署里完全一样——那正是这份 harness 被衡量的成本。其余候选带来的东西在被调用之前不花任何 token，这正是面的 prompt 要求 proposer 保持的性质。

#### KV Cache effect

每次 probe 都是一段全新的对话，所以候选之间不共享任何前缀，也没有可跨候选复用的 cache。候选跑的是同一个任务，所以一个把它们顺序跑起来的部署本可以共享前缀——本包不这么做，因为共享的前缀会让一个候选的 context 渗进另一个的。

## Known Limitations and Deferred Work

- probe 的工具集就是部署挂载的那些。所以 probe 在部署自己的能力下测这份 harness，这正是本意，但也意味着一次 sweep 只在同一个部署内部可比。
- staged harness 会继承部署的用户级 `AGENTS.md` 和用户级 skill，因为它们是从 `$DSH_HOME` 读的，不是从 workspace 读的。候选也是在这个前提下被测量的。
- probe 产出的文件不会被收集。`probeRollout` 带的是空的 `deliverables` map，所以 probe 运行之后 evidence tree 的 `deliverables/` 目录仍然是空的；收集 probe 写出的文件，和产出它们的 harness，是两件事。
- 并发上限限制的是同时在飞的 probe 数量，不是单个 probe 发出的模型调用数。一个在 tool call 上打转的 probe，会在自己的槽位里待完整个 turn。
- 没有 resume。超时的 probe 会被报为失败；重试会开一个全新 session，跑同一份 staged harness。
