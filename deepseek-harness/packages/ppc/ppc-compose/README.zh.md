# dsh-ppc-compose

[English](README.md) | 中文

Propose–Probe–Compose 循环的 compose 阶段：一个匿名的选择器，从若干候选产出物里挑一个。

本包是纯库。它写出一目录 pool 文件，跑一个选择器 agent session 读它，再把 session log 读回来。它不注册 service，不挂 plugin。

## 为什么要匿名

一个能分辨「哪个候选用的是未改动的 harness、哪个用的是改编过的 harness」的选择器，不是在产出物之间做选择，而是在给「这些产出物是怎么来的」编故事。这个故事永远是同一个故事：越精巧的赢。所以选择器读到的 pool 里只有候选**产出**的东西，而那些会指明候选角色的 label（`base`、`inv1`、`dom1`）永远到不了它面前。

pool 刻意**不**持有的，正是那些会毁掉匿名性的东西：

- **没有 harness，也没有 diff。** diff 直接就写着「这个是改编过的」。
- **没有 rollout。** trajectory 里就是 harness 自己的指令，而那恰恰是选择器本该看不见的东西。
- **没有 label。** label 说的是候选的角色，角色说的是它的 harness。

选择器被要求评判的，就是候选自己的产出物，也仅此而已。prompt 里明说了这一点——id 是任意的，有些运行用的是未改动的 harness，挑中这类产出是完全正当的结果——因为一个以为「总有一个 final 候选该优先」的 selector，永远都能找出一个来。

## pool

`writePool(options)` 写出 pool 目录，并返回落地的内容：

```text
<root>/task.md              the request, verbatim
<root>/source/              the material the work was done from, when the caller has one
<root>/candidates/<id>.md   what that run PRODUCED, untrimmed
```

什么都没产出的候选不算答案，所以它进不了 pool：否则就是让选择器在一个产出物和一个失败之间挑，而失败在任何一条标准下都赢不了。这个丢弃被记录在 `dropped` 里，而不是悄无声息——因为「看起来最好的那个候选根本没得到机会」是关于 probe 的发现，不是关于 pool 的事实。

每个候选文件带一个注解头部，写明它的字符数和行数，标上 COMPLETE，并声明这个注解**不属于**候选的产出。什么都不截：被截断的候选就是另一个候选，因为选择器只能评判它看得见的部分，看不见的部分它无法评判。

注解被标明是因为它不是交付内容。一个把比较用的头部算进答案里的选择器，评判的是比较本身而不是工作——而且它会因此挑低那个恰好头部更短的候选，而那根本不是候选工作的性质。

## 匿名 id

`buildPool(candidates, seed)` 给每个候选分配一个 id——`A`、`B`、… `Z`、`AA`、`AB`、…。两条性质同时成立，而它们方向相反：

- 映射**跨重跑稳定**。它来自 seed 的哈希，不是随机源，所以失败后的重跑会在同样的字母里选择，之前记下的理由里的 id 仍然指向它当时指向的候选。
- 映射是一次**洗牌**。候选先按自己的 label 排序，再被洗牌，所以一个候选的 id 不跟随它的 label 的字母序。否则「第一个展示的候选」和「字母序第一的候选」就是同一个候选，而 pool 就带上了它本该消除的选择偏置。

id 只有字母。因此候选自己的 label 永远不会被误认成 id，而 choice 解析器永远能接受一个。

## selector session

`runSelector(ctx, options)` 创建一个 agent，把 mission 交给它，再把 session log 读回来。这个 session 刻意很窄：

- 它是**全新的**，所以它不继承调用方对话的任何一轮，也不记得哪个候选用的是哪份 harness。
- 它的**工作目录就是 pool**，所以它读的每个路径都是 pool 里的路径。它走不进候选的 harness、evidence tree，或者 probe 的工作目录。
- 它的**写入能力是零**。session 的工具面被一条作用域限制收缩到读工具（`read`、`grep`、`glob`），所以 agent 能看见的能力就是它可能去试的能力，而一次被拒的调用要白费一轮。**一个没挂任何读工具的部署保留完整工具面**：既然没什么可读，pool 的文件本身就是 mission 的主题。

选择器的回答带一个 `<why>` 块和一个 ```choice 块。`parseChoice(reply, ids)` 读它们；id 是拿 pool 自己发过的 id 校验的，而不只是校验形状，因为当 pool 只发了 `A` 和 `B` 时却点了 `C` 的选择器，产出了一个无法兑现的决定。

## 回退

失败、超时、或点了 pool 从未发过的 id 的选择器，回退到一个**已交付的候选**。回退不是一种偏好，它是中性的替代品，因为一个什么都不交付的阶段就白费了整轮。

pool 里有 base 时，回退挑 base，因为 base 是那个不需要任何理由的结果——它就是这一轮从未发生过时部署本来会交付的东西。没有 base 时，第一个 pool 条目顶上，所以这一阶段仍然交付 somebody 产出过的东西。

失败被记在 `error` 里，结果带 `fallback: true`，所以读者能分辨一次真正的选择和一次替代。

## prompt

`selectMission(ids, layout, task)` 渲染 mission：按顺序的判断标准（交付、形状、忠实、内部一致、可操作性、完成度）、匿名声明、「你的上下文里任何地方都没有评分标准或参考答案」这句话、输出格式，以及逐字的任务。

证据边界也在 mission 里声明。候选的产出是 agent 写的文本，而 agent 写的文本可以包含任务或源文件里的任何东西；把嵌入的命令当成指令的选择器，会把它执行掉。

## Model Experience

### selector session

#### What the model sees

模型看到 mission——判断标准、匿名声明、边界、输出格式、任务——加上它能读的 pool 目录：`task.md`、`source/`，以及每个候选一份 `candidates/<id>.md`。它从来看不到候选的 label、它的 harness、它相对 base 的 diff、或它的 trajectory。本包不追加 persona，也不追加自己的工具指引；部署自己的 section 原样保留。

#### Token effect

mission 是一个 prompt。候选产出物以文件形式服务、按需读取，所以一个大候选的代价只由选择器真正打开的那些候选承担。十个候选的 pool 不会花掉十份候选的 token：它花一份 mission，加上选择器选择去读的那些。

#### KV Cache effect

选择器是一段全新的对话，所以它与调用方不共享前缀，跨轮也没有可复用的 cache。同一任务上的多轮 mission 是完全相同的，所以把多轮跑在同一个 pool 上的部署本可以共享它；本包不这么做，因为 pool 的 id 是按轮 seed 的，共享前缀会把一轮的 id 带进下一轮。

## Known Limitations and Deferred Work

- pool 只持有候选产出的文本。一个交付的是**文件**而不是文本的候选，在 pool 里什么都没有，因为 probe 阶段还不收集产物。
- 选择器通过部署的文件系统工具读东西。一个没挂读工具的部署打不开候选文件，所以 pool 只能通过 mission 自己的文本使用。
- 没有多选择器共识。一个 selector 挑一个，而两个近乎相同的候选由一个模型对一处细微差别的阅读来决定。
- 回退是替代品，不是判断。走了回退的运行带 `fallback: true`，`error` 说明原因，但交付的产出物并不是在这些候选之间被选出来的。
- 匿名性依赖 pool 的内容，而不是运行时的保证。候选自己的产出可能提到它来自哪份 harness——一个写下「在改编后的 harness 下，答案是……」的候选就毁掉了自己的匿名性，而这里没有任何东西能发现这一点。
