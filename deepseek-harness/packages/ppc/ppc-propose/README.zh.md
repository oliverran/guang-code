# dsh-ppc-propose

[English](README.md) | 中文

Propose–Probe–Compose 循环的 propose 阶段：就地改写 staged harness 副本的全新 editor session。

## editor session

`runEditor(ctx, options)` 创建一个 agent，给它一份 mission，然后把它留在磁盘上的 harness 读回来。

这个 session 是刻意收窄的：

- **全新身份。** session id 每次尝试都重新生成，所以它不继承调用方对话的任何部分。mission 是它唯一被告知的东西。
- **`cwd` 就是 staged harness 目录。** 它写的每个相对路径都落在那份副本里，而那份副本就是 probe 阶段将要运行的东西。
- **workspace-write 文件策略。** 部署的默认是 `read-only`，在那个策略下 editor 根本写不了它被指去的 harness —— 每份提案都会空手而归，而这个失败看起来像是模型的问题。`workspace-write` 把每次写入限制在 session 自己的工作目录（也就是 staged harness）加上平台的临时目录。这个切换是 session 日志上的一条 `sandbox/mode` 事件，所以它可重放、可审计，而部署的默认值不受影响。
- **只给它需要的工具。** session 的工具被限制在 `read`、`write`、`edit`、`bash`、`glob` 和 `grep`，而且只限部署实际挂载了的那些。

发现类工具是承重的，不是图方便。证据树的形状取决于哪些 rollout 跑过，所以一个只能 `read` 具名路径的 editor 只能**猜**文件名——而猜不到东西的 editor 会断定自己没有证据，然后回答 KEEP_BASE。这个结论是从一份缺失的目录列表里得出来的，不是从证据里得来的，而它看上去和一个正确答案一模一样。`glob` 和 `grep` 让 editor 能发现它被指去的那棵树。

证据不会被内联进 prompt。它是磁盘上的一棵树，mission 只是指向它的一个指针，所以不会有任何东西为了塞进 prompt 而被截断，提案也可以有证据该有的体量。

### mission 里写的路径

editor 的工作目录**就是** staged harness，所以 harness 是 `.`，而证据树是它旁边的任何东西。`workspacePath(workspace, target)` 按 editor 读到的方式——相对于工作目录——渲染一个目录，于是 mission 里写的是真实路径。一份 mission 说 `context/harness/` 而目录其实叫 `harness/`，会把 proposer 送到一个不存在的路径；说证据在某个树根本没写进去的前缀下，则会把它送去找根本不存在的证据。

### 为什么提案就是那棵 staged 树

harness2 把 proposer 放在一个一次性 workspace 里跑，之后再把改过的树拷出来。这里 editor 直接改 staged harness，所以没有单独的「提案格式」需要复现，也没有一个可能丢失改动的 apply 步骤。留在磁盘上的东西就是提案。

代价是：树在被 rollout 之前必须被读回来并校验。`dsh-ppc-surface` 按 DSH 运行时在加载时执行的规则检查它，而 editor 自己的回复只是它的 notes。

## 两个维度

一个提案沿两个维度之一抽取，各自拥有 harness 的不同部分：

- `INV` 拥有 procedure、tool use 和 completion —— agent 怎么做事。
- `DOM` 拥有 agent 缺少的 practitioner model —— 这个领域里的专业人士知道什么。

这个划分是让两个独立抽取的候选互不重叠的关键。`DIMENSION_PROMPTS` 持有每个维度的指令。

`extractNotes` 读 proposer 的 `<notes>` 块。notes 是给人读的，不是给机器应用的，所以它以文本形式返回，而不是被解析。`isKeepBase` 识别 `KEEP_BASE` —— 这是一个真实的答案，不是失败：证据并不支持的适配只花 context，什么也换不到。

## 失败

一个以 `completed` 以外原因结束的 session，会产出一个 `ok: false` 的提案，turn reason 放在 `error` 里。它留下的树仍会返回，因为半途的编辑本身也是证据，但它不是一个可以被 rollout 的提案。

`dsh-ppc-evidence` 里的 `withDeadline` 限定等待时长，abort 的 signal 会取消它。无论哪种情况，editor 自己的 agent 都会被 dispose，所以超时的 session 不会留下一个活着的 agent。

## Model Experience

### editor session

#### What the model sees

模型看到的是 mission：来自 `dsh-ppc-surface` 的面描述、指向证据树的指针，以及「就地编辑 harness 并用一个 `<notes>` 块回复」的指令。它是通过打开文件来看到证据的，而不是通过在 prompt 里收到证据。

#### Token effect

mission 是一个 prompt。证据由 `read` 工具读取，所以花在它上面的 token 是模型自己选择花的——而且每次读取都是 session log 里一条独立的 tool result，而不是一个随每个候选增长的前缀。

#### KV Cache effect

每个 editor session 都是一段全新的对话，所以候选之间不共享任何前缀，也没有可跨候选复用的 cache。在一个 session 内部，它读过的 harness 文件就是普通的 tool result。

## Known Limitations and Deferred Work

- editor 的工具集按「创建 session 那一刻存在的工具名」来限定。部署后来才挂载的工具，正在运行的 session 拿不到。
- 限定按工具名生效，不按路径。带绝对路径的 `write` 调用由文件系统后端和它的沙箱策略去解析，不由本包管。
- session 的 `cwd` 是 staged harness 目录，所以旁边的证据树可以用相对路径（`../`）到达。editor 被信任去读它，这正是 mission 要求它做的；而越出 staged 目录的编辑，会在树被读回来时被发现。
- 超时的 session 会被报为失败，它那部分树作为证据返回。没有 resume：重试会开一个全新 session，看到的是树被留下的样子。