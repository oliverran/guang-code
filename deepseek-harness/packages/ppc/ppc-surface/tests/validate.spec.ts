import { describe, expect, it } from 'vitest'

import {
  ALWAYS_ON_MAX,
  DSH_SURFACE,
  HOOK_EVENTS,
  autotrigger,
  checkHooks,
  frontmatterField,
  frontmatterOf,
  scriptReferences,
  skillNames,
  validate,
  type HarnessTree,
  type Surface,
} from '../src/index.ts'

/** A surface that differs from DSH's in one rule, for the cap and the trigger file. */
function surfaceWith(over: Partial<Surface>): Surface {
  return { ...DSH_SURFACE, ...over }
}

function skill(name: string, description: string, body = 'do the thing'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

function base(over: HarnessTree = {}): HarnessTree {
  return {
    'AGENTS.md': 'You are a coding agent.',
    'PERSONA.md': 'You are precise.',
    ...over,
  }
}

describe('frontmatterOf', () => {
  it('reads the block between the fences', () => {
    const text = frontmatterOf('---\nname: a\ndescription: b\n---\n\nbody\n')
    expect(text).toContain('name: a')
    expect(text).not.toContain('body')
  })

  it('finds no frontmatter in a file without one', () => {
    expect(frontmatterOf('no frontmatter here')).toBe('')
    expect(frontmatterOf('---\nname: a\nno closing fence')).toBe('')
  })
})

describe('frontmatterField', () => {
  it('reads a scalar field', () => {
    expect(frontmatterField('---\nname: review\n---', 'name')).toBe('review')
  })

  it('treats an empty value as absent', () => {
    expect(frontmatterField('---\ndescription:\n---', 'description')).toBeUndefined()
  })

  it('strips surrounding quotes', () => {
    expect(frontmatterField('---\ndescription: "a b"\n---', 'description')).toBe('a b')
  })
})

describe('skillNames', () => {
  it('finds the skill bundles a tree ships', () => {
    const names = skillNames(DSH_SURFACE, base({
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing'),
      '.dsh/skills/doc/SKILL.md': skill('doc', 'when documenting'),
    }))
    expect(names).toEqual(['doc', 'review'])
  })

  it('ignores a helper that is not a SKILL.md', () => {
    expect(skillNames(DSH_SURFACE, base({
      '.dsh/skills/review/scripts/check.py': 'print(1)',
    }))).toEqual([])
  })

  it('ignores a skill directory whose name fails the skill-name rule', () => {
    expect(skillNames(DSH_SURFACE, base({
      '.dsh/skills/Code_Review/SKILL.md': 'anything',
    }))).toEqual([])
  })
})

describe('scriptReferences', () => {
  it('finds a script named in a command', () => {
    expect(scriptReferences('Run `python3 scripts/check.py` first.'))
      .toEqual(['scripts/check.py'])
  })

  it('finds a skill-local helper', () => {
    expect(scriptReferences('python3 .dsh/skills/review/scripts/check.py'))
      .toEqual(['.dsh/skills/review/scripts/check.py'])
  })

  it('finds a script named in prose without a command', () => {
    expect(scriptReferences('See scripts/check.py for details.'))
      .toEqual(['scripts/check.py'])
  })

  it('reports a repeated reference once', () => {
    expect(scriptReferences('run scripts/check.py, then scripts/check.py again'))
      .toEqual(['scripts/check.py'])
  })
})

describe('checkHooks', () => {
  it('accepts the schema the runtime dispatches', () => {
    const source = JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
      },
    })
    expect(checkHooks(source, HOOK_EVENTS)).toEqual([])
  })

  it('accepts a bare event map', () => {
    const source = JSON.stringify({
      PreToolUse: [{ hooks: [{ type: 'command', command: 'guard.sh' }] }],
    })
    expect(checkHooks(source, HOOK_EVENTS)).toEqual([])
  })

  it('rejects a file that is not JSON', () => {
    expect(checkHooks('{not json', HOOK_EVENTS)[0]?.message).toMatch(/not valid JSON/)
  })

  it('rejects an unknown event', () => {
    const source = JSON.stringify({ hooks: { PreCompact: [] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/unknown event/)
  })

  it('rejects a non-command hook', () => {
    const source = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', command: 'x' }] }] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/must be "command"/)
  })

  it('rejects an empty command', () => {
    const source = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '  ' }] }] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/empty `command`/)
  })

  it('rejects a document that is not an object', () => {
    expect(checkHooks('[]', HOOK_EVENTS)[0]?.message).toMatch(/must be a JSON object/)
  })

  it('rejects an object that names no events', () => {
    expect(checkHooks('{}', HOOK_EVENTS)[0]?.message).toMatch(/needs a top-level/)
  })

  it('rejects an event that does not map to a list', () => {
    const source = JSON.stringify({ hooks: { Stop: 'not a list' } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/must map to a LIST/)
  })

  it('rejects a matcher entry that is not an object', () => {
    const source = JSON.stringify({ hooks: { Stop: [null] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/needs a `hooks` list/)
  })

  it('rejects a matcher entry with no hooks list', () => {
    const source = JSON.stringify({ hooks: { Stop: [{}] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/needs a `hooks` list/)
  })

  it('rejects a hook that is not an object', () => {
    const source = JSON.stringify({ hooks: { Stop: [{ hooks: [null] }] } })
    expect(checkHooks(source, HOOK_EVENTS)[0]?.message).toMatch(/hook must be an object/)
  })
})

describe('validate', () => {
  it('accepts a harness that satisfies the runtime', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'You are a coding agent. When reviewing a diff, load the `review` skill.',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing a diff'),
    }))
    expect(problems).toEqual([])
  })

  it('rejects a skill with no frontmatter', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': 'no frontmatter',
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/needs YAML frontmatter/)
  })

  it('rejects a skill with no description', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': '---\nname: review\n---\n\nbody',
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/needs a `description:`/)
  })

  it('rejects a skill whose name does not match its directory', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': skill('other', 'when reviewing'),
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/overrides the directory name/)
  })

  it('rejects a skill whose frontmatter declares no name', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': '---\ndescription: when reviewing\n---\n\nbody',
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/needs `name:`/)
  })

  it('rejects a skill the always-on text never names', () => {
    const { problems } = validate(DSH_SURFACE, base({
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing'),
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/never named in the always-on text/)
  })

  it('rejects a skill that invokes a helper the proposal did not ship', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing', 'run python3 .dsh/skills/review/scripts/check.py'),
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/but that file is not in the harness/)
  })

  it('accepts a skill that ships the helper it invokes', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing', 'run python3 .dsh/skills/review/scripts/check.py'),
      '.dsh/skills/review/scripts/check.py': 'print(1)',
    }))
    expect(problems).toEqual([])
  })

  it('rejects a hooks file the runtime cannot dispatch', () => {
    const { problems } = validate(DSH_SURFACE, base({
      'hooks.json': JSON.stringify({ hooks: { PreCompact: [] } }),
    }))
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/unknown event/)
  })

  it('rejects an empty always-on harness', () => {
    const { problems } = validate(DSH_SURFACE, { 'AGENTS.md': '   ' })
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/is empty/)
  })

  it('names the surface\'s first always-on file when the surface carries none', () => {
    const { problems } = validate(surfaceWith({ alwaysOn: [], rejectEmptyAlwaysOn: true }), {})
    expect(problems[0]?.path).toBe('')
    expect(problems[0]?.message).toMatch(/is empty/)
  })

  it('rejects always-on text over the cap', () => {
    const { problems } = validate(DSH_SURFACE, {
      'AGENTS.md': 'x'.repeat(ALWAYS_ON_MAX + 1),
      'PERSONA.md': 'y',
    })
    expect(problems.map(problem => problem.message).join('\n')).toMatch(/over the .* cap/)
  })

  it('census reports the skills and the always-on size', () => {
    const { census } = validate(DSH_SURFACE, base({
      'AGENTS.md': 'load the `review` skill',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing'),
    }))
    expect(census.skills).toEqual(['review'])
    expect(census.alwaysOnChars).toBeGreaterThan(0)
  })
})

describe('autotrigger', () => {
  it('gives an untriggered skill a trigger line', () => {
    const tree: Record<string, string> = {
      ...base(),
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing a diff'),
    }
    const fixed = autotrigger(DSH_SURFACE, tree)
    expect(fixed).toEqual(['review'])
    expect(tree['AGENTS.md']).toContain('load the `review` skill')
  })

  it('leaves a triggered skill alone', () => {
    const tree: Record<string, string> = {
      ...base(),
      'AGENTS.md': 'When reviewing a diff, load the `review` skill.',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing a diff'),
    }
    expect(autotrigger(DSH_SURFACE, tree)).toEqual([])
  })

  it('skips a trigger line that would breach the always-on cap', () => {
    const tree: Record<string, string> = {
      ...base(),
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing a diff'),
    }
    const fixed = autotrigger(surfaceWith({ alwaysOnMax: 10 }), tree)
    expect(fixed).toEqual([])
  })

  it('writes the trigger line into the surface\'s own trigger file', () => {
    const tree: Record<string, string> = {
      'PERSONA.md': 'You are precise.',
      '.dsh/skills/review/SKILL.md': skill('review', 'when reviewing a diff'),
    }
    const surface = surfaceWith({ autotriggerFile: 'PERSONA.md' })
    expect(autotrigger(surface, tree)).toEqual(['review'])
    expect(tree['PERSONA.md']).toContain('load the `review` skill')
    expect(tree['AGENTS.md']).toBeUndefined()
  })

  it('describes a skill that declares no description and creates the trigger file when absent', () => {
    const tree: Record<string, string> = {
      'PERSONA.md': 'You are precise.',
      '.dsh/skills/review/SKILL.md': '---\nname: review\n---\n\nbody',
    }
    expect(autotrigger(DSH_SURFACE, tree)).toEqual(['review'])
    expect(tree['AGENTS.md']).toContain('the review workflow applies')
    expect(tree['AGENTS.md']).toContain('load the `review` skill')
  })
})
