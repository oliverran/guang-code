# dsh-ppc-library

English | [中文](README.zh.md)

The per-domain experience library: the harnesses earlier tasks in a domain adopted, the lessons they contributed, and lexical retrieval over them.

This package is a pure library. It writes a library of files under a caller-owned root, reads it back, and scores the lessons it holds against a task. It registers no service and mounts no plugin.

## Why a library at all

A Propose–Probe–Compose round improves a harness for ONE task. The improvement is worth little if it dies with the round: the next task in the same domain meets the same situation and gets the same wrong behaviour.

The library is what makes the method recursive rather than merely iterative. A round that adopted a harness stores it, and a later task in the same domain reads it as an example before it draws its own edit. The learning compounds across tasks instead of restarting each time.

Retrieval is by construction: a domain's directory only ever holds same-domain entries, so a lesson cannot fire in a domain it was not learned in.

## The layout

```text
<root>/<domain>/
  INDEX.md                        the index a reader browses first
  harnesses/<taskId>/harness/     the full adopted harness tree
  harnesses/<taskId>/EXPERIENCE.md why it was adopted, and the lesson
```

The whole tree is carried, never a summary. A proposer that wants to reuse a component from an earlier task needs the component itself, and a summary of it cannot be copied into a harness.

`domainDir` and `slug` collapse separators, so a domain name and a task id can never name a path outside the library. `domainDir('a/b')` is `a__b`, not `a/b`.

## The distillation

`runDistiller(ctx, options)` runs one agent over a finished round's record and reads the lesson out of its reply. `distilMission(options)` renders the mission.

The session is narrow on purpose. It is fresh, so it inherits no turn of the caller's conversation and no memory of which candidate the selector preferred. Its working directory IS the round's record, so every path it reads is a record path. And its write capability is zero: a distiller that could write could edit the evidence it is reasoning about, and the lesson would then describe a record that never existed.

The mission says two things that make the distillation honest:

- **The adopted candidate is not the only evidence.** Selection compared deliverables with the harnesses hidden, so the choice says which output read best, not which edit worked. An edit in a rejected candidate may be the one that changed behaviour for the better; an edit inside the adopted candidate may have contributed nothing. The distillation reads the trajectories, not the verdict.
- **A verdict may be `confounded`.** When a candidate changed several components at once and no execution isolates one of them, that is what the record shows. A lesson resting only on a confounded contrast is a guess, and a guess in the library is read by every later task as a fact.

A distiller that fails, times out, declines with `NO_ENTRY`, or writes a record missing a required field produces **no lesson at all**. That is the correct outcome, not a failure to work around: the round taught nothing that could be stored, and the library is better off empty of it than holding a guess.

## The admission gate

`add(taskId, harness, details)` stores an entry only when its lesson carries all three required fields:

- **cue** — the SHAPE of situation the lesson applies to, so it can fire on a different matter. Not this task's facts: the pattern.
- **lesson** — the operation to perform on a harness, stated so it can be applied and checked, naming the component it concerns.
- **evidence** — the execution contrast the lesson rests on: which runs, which moments.
- **confidence** — how much the record supports the claim, and why. Optional.

A lesson missing any of the first three is **not written at all**. The call returns `{ rejected }` and the library is untouched.

This is harness2's `has_experience` rule, and it is the anti-hallucination core of the method. A lesson with no evidence is a guess — and a guess stored in a library is not a guess any more: it is read by every later task in the domain as a fact about that domain, and it is copied into their harnesses. A round that cannot support a lesson therefore contributes NOTHING, which is the correct outcome rather than a failure to report.

The gate is enforced in the write, not in a reader: the write is the only place the rule can be enforced, because a later read finds only what the write allowed.

## The index

`INDEX.md` is derived, never authored. `rebuildIndex()` regenerates it from what is on disk, so an index that disagrees with the directory is a stale index rather than a second source of truth. Each row names the entry, a one-line census of the components its harness carries, and the entry's `cue` — the cue is what a reader scans for, because it is the part that says whether the lesson applies.

`inventory(surface, tree)` is that census. It counts what the runtime reads — skills, scripts, hooks — and the always-on characters, because the always-on text is the part that costs the agent's output budget on every run.

## Retrieval

`retrieve(options)` scores each lesson's `cue` against the task's text and returns the best matches:

- The score is the **Jaccard overlap** of the two token sets: shared tokens over the union.
- The threshold is `minScore` (default `0.12`) and the depth is `topN` (default `3`).
- Ties break by task id, so the same library and the same task always answer the same way.

The scorer is lexical on purpose. It is explainable — a reader can see exactly which words matched and judge whether the match is real. It is free: no model call, no embedding index, no network. And at library scale it is enough, because the question retrieval has to get right is "is this lesson about the same situation at all", and word overlap answers that long before a semantic model is worth its latency.

The score is computed on the `cue` alone. The `cue` is the shape of the situation; the `lesson` is long and specific, so scoring on it would match a task against a lesson's wording rather than against its situation.

`renderLessons(matches)` renders the matches as the text a later task is given. Only the `cue` and the `lesson` are rendered: the `evidence` cites specific rollout moments and runs to hundreds of words, which is far too much context to spend on a hint. A reader that needs the detail opens the entry in the library.

## Model Experience

### The lesson a later task is given

#### What the model sees

The model sees the rendered lessons: for each match, the `cue` in parentheses and the `lesson` beside it, under a heading that says they are earlier adopted harnesses in this area. It does not see the `evidence`, the harness trees, or the adoption records — those are files in the library, opened only when a reader wants the detail. The rendering also says the lessons are not instructions for this task, and that anything an earlier task's component asserted about a workspace must be re-verified: there it was a fact, here it was a hypothesis.

#### Token effect

The injection is the matched lessons only, and a task that matches nothing gets nothing. The cost is therefore proportional to how much the library has to say about THIS task, not to the size of the library: a domain holding fifty entries costs the same as a domain holding five when only one of them fires.

#### KV Cache effect

The rendered text changes with the task, so it is not a stable prefix and cannot be shared across turns the way an always-on section can. Two turns with the same task render the same lessons and would share that text; two turns with different tasks do not, and the prompt section's own ordering is what keeps the rest of the request stable.

## Known Limitations and Deferred Work

- The scorer is lexical, so a lesson phrased in words the task does not use does not fire. A task that says "the download keeps failing" and a cue that says "when a fetch times out" share nothing, and the lesson is not retrieved.
- A lesson is stored against one domain. A lesson that would apply to two domains is stored in one of them, and the other domain's tasks never see it.
- There is no re-scoring and no decay. A lesson that was right once stays in the library forever, and nothing here measures whether it still is.
- The library has no merge or eviction. Entries accumulate, and a reader browsing a large index sees every entry of the domain, however well or badly it matches.
- The experience is written by a caller that parsed it from a model reply. This package does not check that the lesson is TRUE, only that it is complete enough to be stored.
