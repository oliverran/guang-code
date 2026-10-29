import { describe, expect, it } from 'vitest'

import {
  DSH_SURFACE,
  proposeMission,
  surfacePrompt,
  type Surface,
} from '../src/index.ts'

/** A surface whose configurable paths all differ from DSH's, so a hard-coded render cannot pass. */
function surfaceWith(over: Partial<Surface>): Surface {
  return { ...DSH_SURFACE, ...over }
}

describe('surfacePrompt', () => {
  it('renders the table from the surface it is given, not from hard-coded defaults', () => {
    const prompt = surfacePrompt(surfaceWith({
      alwaysOn: ['ROLE.md', 'RULES.md'],
      skillDir: 'skills',
      skillScriptDir: 'tools',
      scriptDir: 'helpers',
      hooksFile: 'lifecycle.json',
    }))

    expect(prompt).toContain('| `ROLE.md` |')
    expect(prompt).toContain('| `RULES.md` |')
    expect(prompt).toContain('`skills/<name>/SKILL.md`')
    expect(prompt).toContain('`skills/<name>/tools/*`')
    expect(prompt).toContain('`helpers/<name>.py`')
    expect(prompt).toContain('`lifecycle.json`')
  })

  it('names each always-on file in the trigger-line rule', () => {
    const prompt = surfacePrompt(surfaceWith({ alwaysOn: ['ROLE.md', 'RULES.md'] }))
    expect(prompt).toContain('`ROLE.md` or `RULES.md`')
  })

  it('lists the hook events the surface dispatches', () => {
    const prompt = surfacePrompt(surfaceWith({ hookEvents: ['Stop', 'SessionStart'] }))
    expect(prompt).toContain('Stop, SessionStart')
  })

  it('falls back to the canonical always-on names when the surface carries none', () => {
    const prompt = surfacePrompt(surfaceWith({ alwaysOn: [] }))
    expect(prompt).toContain('`PERSONA.md`')
    expect(prompt).toContain('`AGENTS.md`')
  })
})

describe('proposeMission', () => {
  it('embeds the evidence root, harness path, and layout verbatim', () => {
    const mission = proposeMission('/evidence/run-1', '/harness/candidate', 'tree:\n  a.md')

    expect(mission).toContain('`/evidence/run-1/`')
    expect(mission).toContain('`/harness/candidate/`')
    expect(mission).toContain('tree:\n  a.md')
    // The mission closes with the surface section, so the proposer reads the rules too.
    expect(mission).toContain('# WHAT YOU CAN CHANGE')
  })
})
