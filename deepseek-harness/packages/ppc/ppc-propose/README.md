# dsh-ppc-propose

English | [中文](README.zh.md)

The propose stage of the Propose–Probe–Compose loop: fresh editor sessions that rewrite a staged harness copy in place.

## The editor session

`runEditor(ctx, options)` creates one agent, gives it a mission, and reads back the harness it left on disk.

The session is deliberately narrow:

- **A fresh identity.** The session id is minted per attempt, so it inherits no part of the caller's conversation. The mission is the only thing it was told.
- **A `cwd` of the staged harness directory.** Every relative path it writes lands in the copy, and the copy is what the probe stage will run.
- **A workspace-write file policy.** The deployment's default is `read-only`, under which the editor could not write the harness it was pointed at — every proposal would come back empty, and the failure would look like a model problem. `workspace-write` confines each write to the session's own working directory (the staged harness) plus the platform temp areas. The switch is a `sandbox/mode` event on the session log, so it is replayable and auditable, and the deployment default is untouched.
- **Only the tools it needs.** The session's tools are restricted to `read`, `write`, `edit`, `bash`, `glob` and `grep`, and only to those the deployment actually mounted.

The discovery tools are load-bearing rather than convenient. The evidence tree's shape depends on which rollouts ran, so an editor that can only `read` a named path has to GUESS the filenames — and an editor that guesses finds nothing, concludes it has no evidence, and answers KEEP_BASE. That is a conclusion reached from a missing directory listing, not from the evidence, and it looks exactly like a correct answer. `glob` and `grep` let the editor discover the tree it was pointed at.

The evidence is not inlined into the prompt. It is a tree on disk, and the mission is a pointer to it, so nothing is truncated to fit a prompt and the proposal can be as large as the evidence warrants.

### The paths the mission names

The editor's working directory IS the staged harness, so the harness is `.` and the evidence tree is whatever sits beside it. `workspacePath(workspace, target)` renders a directory the way the editor will read it — relative to the working directory — so the mission names real paths. A mission that says `context/harness/` when the directory is `harness/` sends the proposer to a path that does not exist, and one that says the evidence is under a prefix the tree was never written to sends it looking for evidence that is not there.

### Why the proposal is the staged tree

harness2 runs its proposer in a throwaway workspace and copies the edited tree back out afterwards. Here the editor edits the staged harness directly, so there is no separate "proposal format" to reproduce and no apply step that can lose an edit. What is left on disk is the proposal.

The consequence is that the tree must be read back and validated before it is rolled out: `dsh-ppc-surface` checks it against the rules DSH's runtime enforces at load, and the editor's own reply is only its notes.

## The two dimensions

A proposal is drawn along one of two dimensions, and each owns a different part of the harness:

- `INV` owns procedure, tool use and completion — how the agent works.
- `DOM` owns the practitioner model the agent lacks — what a professional in the domain knows.

The split is what keeps two independently drawn candidates from overlapping. `DIMENSION_PROMPTS` holds each dimension's instruction.

`extractNotes` reads the proposer's `<notes>` block. The notes are read by a person, not applied by a machine, so they are returned as text rather than parsed. `isKeepBase` recognises `KEEP_BASE` — a real answer, not a failure, since adaptation the evidence does not support costs context and buys nothing.

## Failure

A session that ends as anything other than `completed` produces a proposal with `ok: false` and the turn reason in `error`. The tree it left is still returned, because a partial edit is evidence too, but it is not a proposal that may be rolled out.

`withDeadline` in `dsh-ppc-evidence` bounds the wait, and an aborted signal cancels it. The editor's own agent is disposed either way, so a timed-out session leaves no live agent behind.

## Model Experience

### The editor session

#### What the model sees

The model sees the mission: the surface description from `dsh-ppc-surface`, the pointer to the evidence tree, and the instruction to edit the harness in place and reply with one `<notes>` block. It sees the evidence by opening files, not by receiving them in the prompt.

#### Token effect

The mission is one prompt. The evidence is read through the `read` tool, so the tokens spent on it are the ones the model chooses to spend — and each read is a separate tool result in the session log rather than a prefix that grows with every candidate.

#### KV Cache effect

Each editor session is a fresh conversation, so no prefix is shared between candidates and there is no cache to reuse across them. Within one session, the harness files it reads are ordinary tool results.

## Known Limitations and Deferred Work

- The editor's tool set is restricted to names that exist at the time the session is created. A tool the deployment mounts later is not available to a session already running.
- The restriction is by tool name, not by path. A `write` call with an absolute path is resolved by the filesystem backend and its sandbox policy, not by this package.
- The session's `cwd` is the staged harness directory, so the evidence tree beside it is reachable by relative path (`../`). The editor is trusted to read it, which is what the mission asks of it; a proposal that edits outside the staged directory is caught when the tree is read back.
- A session that exceeds its timeout is reported as failed, and its partial tree is returned as evidence. There is no resume: a retry starts a fresh session with the tree as it was left.