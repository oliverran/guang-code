# dsh-ppc-compose

English | [中文](README.zh.md)

The compose stage of the Propose–Probe–Compose loop: an anonymous selector that picks one candidate output.

This package is a pure library. It writes a pool of files, runs one selector agent session over it, and reads the session log back. It registers no service and mounts no plugin.

## Why anonymity

A selector that can tell which candidate came from the unmodified harness and which came from an adapted one is not choosing between outputs — it is choosing a story about how they were made. The story is always the same story: the elaborate one wins. So the pool the selector reads holds only what a candidate PRODUCED, and the labels that would name each candidate's role (`base`, `inv1`, `dom1`) never reach it.

What the pool deliberately does not hold is everything that would void the anonymity:

- **No harness and no diff.** A diff says "this one was adapted" outright.
- **No rollout.** A trajectory shows the harness's own instructions, which is the very thing the selector is supposed to be blind to.
- **No label.** A label names the candidate's role, and the role names its harness.

The candidate's own output is what the selector is asked to judge, and that is all it gets. The prompt says so plainly — the ids are arbitrary, some runs used the unmodified harness, and picking one of those is a valid outcome — because a selector that believes there is a "final" candidate to defer to will always find one.

## The pool

`writePool(options)` writes the pool directory and returns what landed:

```text
<root>/task.md              the request, verbatim
<root>/source/              the material the work was done from, when the caller has one
<root>/candidates/<id>.md   what that run PRODUCED, untrimmed
```

A candidate that produced nothing is not an answer, so it never enters the pool: the selector would be asked to choose between an output and a failure, and a failure wins no criteria. The drop is recorded in `dropped` rather than silent, because "the candidate that looked best never got a chance" is a finding about the probe, not a fact about the pool.

Each candidate file carries an annotation header with its size and line count, saying COMPLETE and that the annotation is NOT part of the candidate's output. Nothing is trimmed: a truncated candidate is a different candidate, because the selector judges what it can see and cannot judge what it cannot.

The annotation is labelled because it is not deliverable content. A selector that counts a comparison header as part of the answer is judging the comparison rather than the work — and it will pick against the candidate that happens to have the shorter header, which is not a property of the candidate's work at all.

## The anonymous ids

`buildPool(candidates, seed)` assigns each candidate an id — `A`, `B`, … `Z`, `AA`, `AB`, … Two properties hold, and they pull in opposite directions:

- The mapping is **stable across reruns**. It comes from a hash of the seed, not from a random source, so a rerun after a failure selects among the same letters and the ids in the recorded reasoning still name the candidates they named before.
- The mapping is a **shuffle**. The candidates are sorted by their own labels and then shuffled, so a candidate's id does not track its label's alphabetical position. Otherwise "the first candidate shown" and "the first candidate alphabetically" would be the same candidate, and the pool would carry the selection bias it exists to remove.

The ids are letters only. A candidate's own label can therefore never be mistaken for an id, and the choice parser always accepts one.

## The selector session

`runSelector(ctx, options)` creates one agent, gives it the mission, and reads the session log back. The session is narrow on purpose:

- It is **fresh**, so it inherits no turn of the caller's conversation and no memory of which candidate came from which harness.
- Its working directory **is the pool**, so every path it reads is a pool path. It cannot wander into the candidate harnesses, the evidence tree, or the probes' workspaces.
- Its **write capability is zero**. The session's tool surface is reduced to the read tools (`read`, `grep`, `glob`) by a scoped restriction, so a capability the agent can see is a capability it may try, and a denied call costs a turn to no end. A deployment that mounts none of the read tools keeps its whole surface: with nothing to read, the pool's files are the mission's own subject.

The selector answers with a `<why>` block and a ```choice block. `parseChoice(reply, ids)` reads them; the id is validated against the pool's own ids, not merely against the shape of an id, because a selector that names `C` when the pool issued `A` and `B` has produced a decision that cannot be honoured.

## The fallback

A selector that fails, times out, or names an id the pool never issued falls back to a **delivered candidate**. The fallback is not a preference: it is the neutral stand-in, because a stage that delivered nothing would waste the whole round.

The fallback picks the base candidate when the pool holds one, because the base is the outcome that needs no justification — it is what the deployment would have shipped had the round never happened. Without a base, the first pool entry stands in, so the stage still delivers an output somebody produced.

The failure is recorded in `error` and the result carries `fallback: true`, so a reader can tell a real selection from a stand-in.

## The prompt

`selectMission(ids, layout, task)` renders the mission: the decision criteria in order (delivery, conformance, fidelity, internal consistency, operational fitness, finish), the anonymity declaration, the statement that there is no rubric or answer key anywhere in the selector's context, the output format, and the task verbatim.

The evidence boundary is declared in the mission too. A candidate's output is text an agent wrote, and text an agent wrote can contain anything the task or a source file contained; a selector that treats an embedded command as an instruction would run it.

## Model Experience

### The selector session

#### What the model sees

The model sees the mission — the criteria, the anonymity declaration, the boundary, the output format, and the task — plus the pool directory it can read: `task.md`, `source/`, and one `candidates/<id>.md` per candidate. It never sees a candidate's label, its harness, its diff against the base, or its trajectory. The prompt adds no persona and no tool guidance of its own; the deployment's own sections remain in place.

#### Token effect

The mission is one prompt. The candidate outputs are served as files and read on demand, so the cost of a large candidate is paid only for the candidates the selector actually opens. A pool of ten candidates does not cost ten candidates' worth of tokens: it costs one mission plus whatever the selector chose to read.

#### KV Cache effect

The selector is a fresh conversation, so there is no prefix shared with the caller and no cache to reuse across rounds. The mission is identical between two rounds over the same task, so a deployment that ran several rounds against one pool could share it; this package does not, because the pool's ids are seeded per round and a shared prefix would carry one round's ids into the next.

## Known Limitations and Deferred Work

- The pool holds the candidate's produced text only. A candidate that delivered a FILE rather than text has nothing in the pool, because the probe stage does not collect artifacts yet.
- The selector reads through the deployment's filesystem tools. A deployment with no read tools mounted cannot open a candidate file, so the pool is only usable through the mission's own text.
- There is no multi-selector consensus. One selector picks, and a pool of two near-identical candidates is decided by one model's reading of a small difference.
- The fallback is a stand-in, not a judgment. A run that fell back carries `fallback: true`, and the `error` says why, but the delivered output was not chosen against the others.
- The anonymity rests on the pool's contents, not on a runtime guarantee. A candidate's own output may name the harness it came from — a candidate that writes "under the adapted harness, the answer is …" defeats its own anonymity, and nothing here detects that.
