/**
 * The prompt that describes the DSH editable surface to a proposer.
 *
 * The surface table, the always-on-cost argument, and the three rules that discard a whole
 * proposal are restated from DSH's own runtime behaviour, because a proposer that does not
 * know them writes a harness that silently does nothing.
 *
 * @module
 */

import { DSH_SURFACE, type Surface } from './surface.ts'

/**
 * The surface table and the rules that follow it, rendered from the surface value.
 *
 * Rendering it from the value rather than hard-coding it is what keeps the text a proposer
 * reads and the predicate that checks its proposal in agreement.
 * @param surface - the surface to describe.
 * @returns the prompt section.
 */
export function surfacePrompt(surface: Surface): string {
  const scriptDir = surface.scriptDir
  const skillDir = surface.skillDir
  return `# WHAT YOU CAN CHANGE

The harness is a tree of components. Each has a different runtime cost and a different reach:

| path | component | when it is in context |
|---|---|---|
| \`${surface.alwaysOn[0] ?? 'PERSONA.md'}\` | the deployment identity | ALWAYS ON — every token competes with the agent's own output budget |
| \`${surface.alwaysOn[1] ?? 'AGENTS.md'}\` | role, procedure, rules, durable facts | ALWAYS ON — same cost |
| \`${skillDir}/<name>/SKILL.md\` | a reusable workflow | name+description advertised; the BODY is read ON DEMAND |
| \`${skillDir}/<name>/${surface.skillScriptDir}/*\` | a helper carried with its skill | run via bash |
| \`${scriptDir}/<name>.py\` | a deterministic helper | run on demand via bash |
| \`${surface.hooksFile}\` | lifecycle hooks | fire INSIDE the tool loop, on every matching tool call |

There is no file-form subagent: subagents are registered in code, so a \`sub_agents/\` directory
is not loaded by any runtime. There is no plugin file either: a plugin is JavaScript registered
through the loader. The hook file is the only component that acts inside the tool loop.

ALWAYS-ON PROSE IS THE EXPENSIVE OPTION. Every word of \`${surface.alwaysOn[0] ?? 'PERSONA.md'}\`
and \`${surface.alwaysOn[1] ?? 'AGENTS.md'}\` is in context on every run, competing with the agent's
own output budget — and the most costly failure on this work is a run that reasons until the
budget is gone and produces nothing. Adding prose makes that MORE likely, not less. An on-demand
component costs nothing until the moment it is invoked.

So prefer, in this order:
  - a SKILL for anything with a recognisable trigger — a procedure for a file type, a format,
    a recurring situation. This is the default form for new instruction.
  - a SCRIPT for a deterministic operation the runs hand-rolled and got wrong, or did slowly.
  - ALWAYS-ON TEXT last, and only for a short rule that genuinely applies to every run. If
    you add always-on text, cut something else to pay for it.

THREE RULES THAT DISCARD THE WHOLE PROPOSAL. Validation runs before any rollout, and a
harness that fails it is thrown away entire.

1. EVERY SKILL NEEDS A TRIGGER LINE. If you create or keep \`${skillDir}/<name>/SKILL.md\`,
   its name must appear VERBATIM in \`${surface.alwaysOn.join('` or `')}\`, in the SAME edit:

       When <the situation this skill handles>, load the \`<name>\` skill.

   An unnamed skill is never opened anyway: the line is what makes it exist. The skill's
   frontmatter must also carry \`name:\` matching the directory and a \`description:\` —
   a file missing either is dropped at load, silently.

2. EVERY SCRIPT YOU NAME MUST EXIST. A \`${scriptDir}/<file>.py\` invoked from a skill or from
   always-on text must ship in the same proposal, as the skill's own helper at
   \`${skillDir}/<skill-name>/${surface.skillScriptDir}/<file>.py\`. One dropped loose in the skill
   directory is off the editable surface and silently discarded, leaving the skill invoking a file
   that does not exist.

3. \`${surface.hooksFile}\` MUST BE THE SHAPE THE RUNTIME DISPATCHES. One JSON file, Claude-Code hook
   schema: a top-level "hooks" object maps an event — ${surface.hookEvents.join(', ')} — to matcher
   entries. A \`PostToolUse\` command printing a JSON "decision" of "block" with a "reason"
   sends that reason back to the model. A hooks file that does not parse registers no hooks
   at all, and says so only in a log.

THE DELIVERABLE'S SHAPE BELONGS TO THE REQUEST, NOT TO YOU. A harness changes HOW the agent
works; it must never change WHAT SHAPE it delivers. Where the task names fields, columns,
sections or an order, that shape is part of what was asked for. A component that tells the
agent to add explanatory columns, rename a header for clarity, or surface intermediate
values so a reviewer can check them is CHANGING THE DELIVERABLE. Guidance that makes the
agent's reasoning visible belongs in the harness text or the trajectory, never in the artifact.
`
}

/**
 * The mission a proposer receives: what to do, where the evidence is, and where the harness is.
 *
 * The paths are the ones the caller actually uses, so the proposer reads and writes real
 * directories. A mission that names a directory the tree was not written to sends the proposer
 * to look for evidence that is not there.
 * @param evidenceRoot - the directory the evidence tree lives in, as the editor will see it.
 * @param harnessPath - the harness directory, as the editor will see it.
 * @param layout - the evidence listing, naming only what exists.
 * @returns the mission text.
 */
export function proposeMission(evidenceRoot: string, harnessPath: string, layout: string): string {
  return [
    'You are adapting an autonomous agent\'s harness.',
    '',
    '# THE WORK',
    '',
    'Improve the harness so the next run of this task does better, using only what the evidence shows.',
    '',
    '# YOUR EVIDENCE',
    '',
    `It is on disk, in \`${evidenceRoot}/\`. Read it — do not answer from this message alone.`,
    '',
    layout,
    '',
    'Every trajectory EVENT is present: the trajectory was not clipped to fit this mission.',
    'An individual observation may contain an explicit renderer-truncation marker; that marker is ours,',
    'not behavior by the solver. Do not diagnose it as a solver failure.',
    '',
    'Read the task and the current harness first. Inspect every rollout at least once before deciding.',
    'Then deep-read the evidence relevant to any edit. Cite the specific trajectory moment behind every',
    'change; one you cannot trace to a moment is speculation.',
    '',
    '# HOW TO MAKE A CHANGE',
    '',
    `The harness is in \`${harnessPath}/\`, and it is YOURS TO EDIT. Open the files, change them`,
    'in place with your normal tools, and create new ones where a new component is the right lever.',
    'Your edits on disk ARE the proposal — there is no separate format to reproduce them in, and nothing',
    'you write in this reply changes the harness.',
    '',
    '- Files you do not touch are inherited unchanged. Do not rewrite a file to keep it the same.',
    '- Delete a file to remove that component.',
    '- If the evidence does not argue for any change, leave everything as it is and say KEEP_BASE in your',
    '  notes. That is a real answer, not a failure: adaptation the evidence does not support costs',
    '  context and buys nothing.',
    '',
    'Then reply with ONE `<notes>` block and nothing else: for each change, the moment in a trajectory',
    'that motivated it. The notes are read by a person, not applied by a machine.',
    '',
    surfacePrompt(DSH_SURFACE),
  ].join('\n')
}
