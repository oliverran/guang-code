# dsh-ppc-surface

English | [中文](README.zh.md)

The DSH editable harness surface: which paths a proposal may write, and what DSH's runtime requires of the files it writes.

This package is a pure library. It holds a path predicate, a validator, and the prompt text that describes the surface to a proposer. It registers no service and mounts no plugin.

## The surface

| component | path | how DSH reads it |
|---|---|---|
| c1 persona | `PERSONA.md` | replaced into `system-prompt.config.persona` by the caller |
| c2 instructions | `AGENTS.md` | `dsh-agent-instructions` reads the chain from the project root to the cwd |
| c6 skills | `.dsh/skills/<name>/SKILL.md` | `dsh-skill-filesystem` scans the project root |
| c6 helpers | `.dsh/skills/<name>/scripts/<file>.py` | run through bash, shipped with the skill |
| c7 scripts | `scripts/<name>.py` | no loader; the model runs it through bash |
| c8 hooks | `hooks.json` | `dsh-hooks-claude-code` reads `configPath` once at load |

Two DSH facts shape this list:

- There is no file-form subagent. `ctx.subagents.registerProvider()` is code-only, so `sub_agents/<name>/AGENT.md` has no runtime that would load it, and it is not on the surface. The surface says so with `subagentDir: undefined` rather than by convention, so a reader of the manifest cannot mistake it for a component.
- There is no plugin file either; a cordis plugin is JavaScript registered through the loader. The middleware-control component is carried by `hooks.json` instead.

`isAllowed(surface, rel)` is the predicate. It never throws: a path that escapes the tree is simply not editable, and `normalizeRel` is the separate function that rejects an escape when a caller joins a path to a directory.

## One surface, one definition

The `Surface` value carries every rule the validator enforces: the always-on files and their cap, the skill and script directories, the hooks file and its events, the trigger-file and trigger-line templates, the seed files. A caller does not pass the cap and the event list alongside the surface, so two callers holding the same surface cannot disagree about a rule.

`DSH_SURFACE` is the DSH surface. The same surface is also published as `surface-manifest.json` — `pnpm run gen-ppc-surface` writes it and `pnpm run verify-ppc-surface` checks it. harness2's Python substrate reads that manifest instead of repeating the values, so the two trees cannot describe one editable surface two different ways. A path one tree accepts and the other rejects is a proposal that validates in one place and is discarded in the other.

## Validation

`validate(surface, tree, options)` returns every problem with a proposed tree, and a census of what it contains. Each rule is a rule DSH enforces at load time, restated so a proposal can be checked before it is rolled out:

- A skill whose frontmatter lacks `name` or `description` is dropped at load. A harness that ships one is a harness that does nothing, and the rollout that "proves" it changed nothing proves only that.
- A skill whose frontmatter `name` disagrees with its directory overrides the directory name at load, so every trigger line naming the directory stops matching.
- A skill the always-on text never names is never opened. It costs context and buys nothing.
- A skill that invokes a helper the proposal did not ship fails at the moment it is invoked.
- A hooks file that does not parse registers no hooks at all, and says so only in a log. The check covers the event names the runtime dispatches, the matcher-entry list shape, and the `command` hook type.
- Always-on text over the cap is a harness that costs the agent its output budget on every run.

`autotrigger` gives every untriggered skill a trigger line in the always-on text, and skips a line that would breach the cap.

## Reading and writing a tree

`readTree(surface, root)` reads a proposal directory into a tree and reports the files that exist on disk but are off the surface. A file the runtime never reads is not part of the harness, so it is reported rather than carried forward.

`writeTree(surface, tree, root)` writes a tree into a directory, replacing what is there. It refuses any path that is off the surface.

## Diffing two trees

`diffTree(base, candidate, label)` produces the unified diff between two harness trees. The evidence tree shows a candidate's harness next to the harness it was derived from, and without the diff a reader can only compare two file trees by hand — while the difference that matters, which lines of the always-on text changed, is the part a reader is least likely to reconstruct.

The diff is line-based, with three context lines on each side of a change, in the unified format `difflib.unified_diff` produces. Two changes closer than twice the context are one hunk, so a reader sees one contiguous region rather than two fragments that share no lines. The files appear in sorted path order, so the same pair of trees always produces the same bytes.

## Model Experience

### The surface description a proposer reads

#### What the model sees

A proposer reads the surface table, the always-on cost argument, and the three rules that discard a whole proposal. The table is the surface this package defines; the rules are the DSH runtime's own load-time failures, restated so a proposer that does not know them does not write a harness that silently does nothing. The table is rendered from the `Surface` value, not written out beside it: a hard-coded table and a changing predicate are two descriptions of one surface, and the day they disagree the proposer is told to write a path the runtime never reads.

##### The surface table

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

Tokens appear only where a caller's prompt embeds this text; this package adds none of its own. The table is six rows and the rules are a few hundred words, so the cost is a fixed prompt prefix rather than a per-call addition.

#### KV Cache effect

None; this package assembles no provider request and touches no prompt assembly.

## Known Limitations and Deferred Work

- The surface names the paths DSH reads, not the paths a deployment may have extended. A custom skill root or a preset that reads another file is not on this surface and would be rejected as off-surface.
- The skill frontmatter check reads `name` and `description` as scalars. A frontmatter that uses YAML nesting to express either field is not recognised, and the skill is reported as missing the field.
- The always-on cap is a character count. DSH's own instruction budget is a byte count, so the two are not the same limit and a tree that passes here can still be truncated at load.
- A hooks file that parses and matches the event names can still register a command that fails at run time; this package checks the schema, not the command's behaviour.