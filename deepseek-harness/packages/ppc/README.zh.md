# ppc/ — 面向递归 agent harness 的 Propose–Probe–Compose

[English](README.md) | 中文

这些包在 DSH 自己的 harness 上实现一个 Propose–Probe–Compose 循环：proposer 编辑 harness 的一份副本，probe 用改过的 harness 对同一个任务跑一次 rollout，结果再和 base 对照评判。方法来自 [harness2](https://arxiv.org/abs/2610.14224)（vendored 在 `_third_party/harness2`），执行宿主是 DSH。

| 包 | 职责 |
|---|---|
| [`evidence/`](ppc-evidence/README.md) | 把 session log 渲染成 proposer 会去读的证据树 |
| [`surface/`](ppc-surface/README.md) | DSH 可编辑面：提案允许写哪些路径，以及运行时要求这些文件满足什么 |
| [`propose/`](ppc-propose/README.md) | propose 阶段：就地改写 staged harness 的全新 editor session |
| [`probe/`](ppc-probe/README.md) | probe 阶段：把 staged harness 跑在任务上的全新 session |
| [`compose/`](ppc-compose/README.md) | compose 阶段：从匿名候选池里挑一个的 selector |
| [`library/`](ppc-library/README.md) | 按领域划分的经验库：被采纳的 harness、它们的经验，以及在它们之上的词面检索 |

这个循环是为「离线、低频改进」设计的：产出的 harness 应当被采纳进 library 供后续任务检索，而不是每个任务重新推导一遍。
