# dsh-ppc-probe

English | [中文](README.zh.md)

The probe stage of the Propose–Probe–Compose loop: running a proposed harness against the task and recording what happened.

A probe is a real run. It creates a fresh agent session whose working directory is the staged harness, gives the agent the task, and lets the runtime load the harness's own instructions and skills. Nothing about the run is simulated, because the whole value of a probe is that it is the same code path the deployment will take.

## The staged harness

`stageHarness(surface, tree, root)` writes a proposal into a directory DSH can run from. The three components DSH reads land in three different places, and getting any of them wrong means the probe measures a harness the model never saw:

- `PERSONA.md` is not read from disk at all. It becomes the deployment persona, which is a prompt section, so `stageHarness` returns the persona text separately and the probe registers it as one.
- `AGENTS.md` is read from the workspace, walking from the project root down to the session's working directory.
- `.dsh/skills/<name>/SKILL.md` is read from the project root, which the skill provider finds by walking up from the session's working directory to the nearest directory containing `.git`.

That last one is the trap. A staged harness in a temporary directory has no `.git` above it, so the provider's project root IS the staged directory — which is what we want, but only because nothing above it claims the walk. A staged harness under a real repository would silently inherit that repository's skills. So the staged directory is the session's working directory, and `probeCwd(root)` and `probeWorkspace(root)` both name it.

`stageHarness` replaces the directory it writes into, so a probe never runs against a previous candidate's leftovers.

## The probe session

`runProbe(ctx, options)` creates one agent, gives it the task, and reads back the session log.

Two things make the run a fair comparison:

- **The session is fresh.** The id is minted per attempt, so a candidate inherits no turn of the caller's conversation. A candidate that inherited the caller's context would be measured on that context as much as on its harness, and two candidates would differ in more than their harness.
- **The model is frozen.** The same route and id for every candidate, so a difference between two rollouts is a difference between the harnesses and not between the sampling temperatures.

The persona is registered as a scoped `deployment:persona` prompt section, which shadows the deployment's own for that agent's scope. The deployment's persona is therefore the one the probe replaces — the candidate's identity is what runs.

## The sweep

`runProbes(ctx, options)` runs a set of candidates against one task, at most `concurrency` at a time. The default width of 2 matches harness2's phase width: enough to hide a slow model call, few enough that a sweep does not spend the whole budget at once.

A candidate that fails does not stop the sweep. A dead rollout is a finding, and the other candidates still measure the harnesses they carry. A duplicate label is skipped rather than run, because two candidates with one label would overwrite each other's staged harness and the pool would carry one of them twice.

Results come back in the order the candidates were given, whatever order they finished in.

## Failure

A turn that ends as anything other than `completed` produces a result with `delivered: false` and the reason in `turnReason`. Only a completed turn counts as a result, never a zero.

`withDeadline` in `dsh-ppc-evidence` bounds the wait, and an aborted signal cancels it. A probe that runs out of time is reported with the reason in `error` rather than thrown, so one dead candidate does not abort the sweep. The probe's own agent is disposed either way, so a timed-out probe leaves no live agent behind.

## The hand-off to evidence

A probe produces a session log. The stages that come after it read a directory, not a log, so `probeEvidence(results, base, budget)` shapes the sweep into the evidence tree's own vocabulary:

- `rollouts` — what each run did, in the shared `[ACTION]`/`[OBSERVATION]` grammar.
- `candidates` — each candidate's harness, its unified diff against the base, its rollout, and its output.

The diff is against the base harness, because a candidate's value is what it changed relative to the harness it was derived from. `diffTree` in `dsh-ppc-surface` produces it in the unified format, over sorted paths, so the same pair of trees always produces the same bytes.

`producedBody` says why a probe produced nothing when it produced nothing. A probe that ended before the agent answered is not a probe that produced a zero; the reason is the finding.

The boundary declaration is not added here. `dsh-ppc-evidence` prepends it to every trajectory file it writes, and a declaration added twice is a declaration a reader has to read past twice.

## Model Experience

### The probe session

#### What the model sees

The model sees the task, the persona from `PERSONA.md`, and whatever the harness's own components add: the `AGENTS.md` chain the instruction loader reads from the workspace, the skills the skill provider discovers from the project root, and the hooks the hook bridge dispatches. Each probe is a fresh conversation, so the model sees only this task and this harness.

#### Token effect

The task is one prompt. The harness's always-on text is in context on every turn, exactly as it would be in a deployment — that is the cost the harness is being measured on. Everything else a candidate ships costs nothing until it is invoked, which is the property the surface's prompt asks a proposer to preserve.

#### KV Cache effect

Each probe is a fresh conversation, so no prefix is shared between candidates and there is no cache to reuse across them. The candidates run against the same task, so a deployment that ran them in sequence could share a prefix — this package does not, because a shared prefix would let one candidate's context bleed into another's.

## Known Limitations and Deferred Work

- The probe's tool set is whatever the deployment mounted. A probe therefore measures the harness under the deployment's own capabilities, which is the point, but it means a sweep is only comparable within one deployment.
- The staged harness inherits the deployment's user-level `AGENTS.md` and user-level skills, because those are read from `$DSH_HOME` and not from the workspace. A candidate is measured against them too.
- A probe's artifacts are not collected. `probeRollout` carries an empty `deliverables` map, so the evidence tree's `deliverables/` directory stays empty for a probe run; collecting the files a probe wrote is a separate concern from the harness that produced them.
- The concurrency limit bounds how many probes are in flight, not how many model calls a single probe makes. A probe that loops on tool calls stays inside its slot for its whole turn.
- There is no resume. A probe that times out is reported as failed; a retry starts a fresh session with the same staged harness.
