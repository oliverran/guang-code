import { describe, expect, it } from 'vitest'

import {
  ALWAYS_ON_MAX,
  DSH_SURFACE,
  HOOK_EVENTS,
  isAllowed,
  isSkillName,
  normalizeRel,
} from '../src/index.ts'

describe('normalizeRel', () => {
  it('strips a leading ./ and a trailing /', () => {
    expect(normalizeRel('./PERSONA.md')).toBe('PERSONA.md')
    expect(normalizeRel('scripts/')).toBe('scripts')
  })

  it('rejects an absolute path', () => {
    expect(() => normalizeRel('/etc/passwd')).toThrow(/escapes the harness/)
  })

  it('rejects a traversal', () => {
    expect(() => normalizeRel('../outside.md')).toThrow(/escapes the harness/)
    expect(() => normalizeRel('a/../../b.md')).toThrow(/escapes the harness/)
  })
})

describe('isAllowed', () => {
  it('accepts the always-on files and the hooks file', () => {
    expect(isAllowed(DSH_SURFACE, 'PERSONA.md')).toBe(true)
    expect(isAllowed(DSH_SURFACE, 'AGENTS.md')).toBe(true)
    expect(isAllowed(DSH_SURFACE, 'hooks.json')).toBe(true)
  })

  it('accepts a skill bundle and its own helper', () => {
    expect(isAllowed(DSH_SURFACE, '.dsh/skills/review/SKILL.md')).toBe(true)
    expect(isAllowed(DSH_SURFACE, '.dsh/skills/review/scripts/check.py')).toBe(true)
  })

  it('accepts a top-level helper script', () => {
    expect(isAllowed(DSH_SURFACE, 'scripts/check_totals.py')).toBe(true)
  })

  it('rejects a helper dropped loose in the skill directory', () => {
    // DSH only reads `<skill>/scripts/<file>`; a loose file is silently discarded.
    expect(isAllowed(DSH_SURFACE, '.dsh/skills/review/check.py')).toBe(false)
  })

  it('rejects a skill whose name is not kebab-case', () => {
    expect(isAllowed(DSH_SURFACE, '.dsh/skills/Code_Review/SKILL.md')).toBe(false)
    expect(isAllowed(DSH_SURFACE, '.dsh/skills/code-review/SKILL.md')).toBe(true)
  })

  it('rejects a subagent directory, because DSH has no file-form subagent', () => {
    expect(isAllowed(DSH_SURFACE, 'sub_agents/reviewer/AGENT.md')).toBe(false)
  })

  it('rejects a plugin file, because DSH has no plugin file', () => {
    expect(isAllowed(DSH_SURFACE, 'plugin/hook.ts')).toBe(false)
  })

  it('rejects a traversal without throwing', () => {
    expect(isAllowed(DSH_SURFACE, '../outside.md')).toBe(false)
  })

  it('rejects an empty path', () => {
    expect(isAllowed(DSH_SURFACE, '')).toBe(false)
  })
})

describe('isSkillName', () => {
  it('accepts the kebab-case DSH accepts', () => {
    expect(isSkillName('code-review')).toBe(true)
    expect(isSkillName('doc2')).toBe(true)
  })

  it('rejects what DSH drops at load', () => {
    expect(isSkillName('Code_Review')).toBe(false)
    expect(isSkillName('code--review')).toBe(false)
    expect(isSkillName('-code')).toBe(false)
    expect(isSkillName('code-')).toBe(false)
  })
})

describe('the surface constants', () => {
  it('names the two always-on files DSH reads', () => {
    expect(DSH_SURFACE.alwaysOn).toEqual(['PERSONA.md', 'AGENTS.md'])
  })

  it('names the events the hooks runtime dispatches', () => {
    expect(HOOK_EVENTS).toContain('PostToolUse')
    expect(HOOK_EVENTS).not.toContain('PreCompact')
  })

  it('caps the always-on text', () => {
    expect(ALWAYS_ON_MAX).toBeGreaterThan(0)
  })

  it('declares that DSH has no file-form subagent and no plugin file', () => {
    // These two are the facts that keep a proposer from writing a component DSH never
    // loads. harness2's substrate reads the same values from the published manifest.
    expect(DSH_SURFACE.subagentDir).toBeUndefined()
    expect(DSH_SURFACE.pluginDir).toBeUndefined()
  })
})
