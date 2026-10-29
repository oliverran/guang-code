# ppc/ — Propose–Probe–Compose for recursive agent harnessing

English | [中文](README.zh.md)

These packages implement a Propose–Probe–Compose loop over DSH's own harness: a proposer edits a copy of the harness, a probe rolls the edited harness out against the same task, and the result is judged against the base. The method follows [harness2](https://arxiv.org/abs/2610.14224) (vendored under `_third_party/harness2`); the execution host is DSH.

| Package | Role |
|---|---|
| [`evidence/`](ppc-evidence/README.md) | Renders session logs into an evidence tree a proposer reads |
| [`surface/`](ppc-surface/README.md) | The DSH editable surface: which paths a proposal may write, and what the runtime requires of them |
| [`propose/`](ppc-propose/README.md) | The propose stage: fresh editor sessions that rewrite a staged harness in place |
| [`probe/`](ppc-probe/README.md) | The probe stage: fresh sessions that run a staged harness against the task |
| [`compose/`](ppc-compose/README.md) | The compose stage: an anonymous selector that picks one candidate output |
| [`library/`](ppc-library/README.md) | The per-domain experience library: adopted harnesses, their lessons, and lexical retrieval over them |

The loop is designed for offline, low-frequency improvement: the harnesses that come out of it are meant to be adopted into a library and read by later tasks, not re-derived per task.
