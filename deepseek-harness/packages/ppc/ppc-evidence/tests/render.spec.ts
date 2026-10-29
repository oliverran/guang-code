import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { clip, finalMessage, renderTrajectory, turnReason } from '../src/index.ts'

const BUDGET = { obsTrunc: 50_000, argsTrunc: 2_000, maxChars: 200_000 }

let seq = 0
function event(type: string, data: unknown, extra: Record<string, unknown> = {}): SessionEvent {
  seq += 1
  return { type, seq, time: seq, data, ...extra } as unknown as SessionEvent
}

/** `surfaceOp: 'append'` is the plain string; only a compaction fold is an object. */
const APPEND = { surfaceOp: 'append' } as const

function user(text: string, source: unknown = { kind: 'user' }): SessionEvent {
  return event('user/message', {
    role: 'user',
    id: 'm',
    source,
    content: [{ type: 'text', text }],
  }, APPEND)
}

function assistant(text: string, reasoning?: string): SessionEvent {
  const content: unknown[] = []
  if (reasoning) content.push({ type: 'reasoning', text: reasoning })
  content.push({ type: 'text', text })
  return event('assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', id: 'a', source: { kind: 'model' }, content },
  }, APPEND)
}

function toolCall(name: string, args: unknown): SessionEvent {
  return event('tool/call', {
    turn: 1, step: 1, callId: 'c', name, arguments: JSON.stringify(args),
  })
}

function toolResult(text: string, opts: { isError?: boolean; error?: unknown } = {}): SessionEvent {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'user',
      id: 't',
      source: { kind: 'tool', callId: 'c' },
      content: [{
        type: 'tool-result',
        toolCallId: 'c',
        content: [{ type: 'text', text }],
        isError: opts.isError ?? false,
      }],
    },
    ...(opts.error ? { error: opts.error } : {}),
  }, APPEND)
}

function turnEnd(kind: string): SessionEvent {
  return event('turn/end', { turn: 1, reason: { kind } })
}

describe('clip', () => {
  it('counts what it dropped', () => {
    expect(clip('x'.repeat(50), 10)).toBe(`xxxxxxxxxx${'…(+40 chars — render truncation)'}`)
  })

  it('never splits a surrogate pair', () => {
    // A thumbs-up is two UTF-16 units, so a 5-unit cut lands mid-emoji: the partial pair is
    // dropped whole, leaving two emoji rather than one plus a broken half.
    const clipped = clip('👍👍👍👍👍', 5)
    expect(clipped).not.toContain('�')
    expect(clipped.startsWith('👍👍')).toBe(true)
    expect(clipped).toBe(`👍👍${'…(+6 chars — render truncation)'}`)
  })

  it('treats null and undefined as empty', () => {
    expect(clip(null, 10)).toBe('')
    expect(clip(undefined, 10)).toBe('')
  })
})

describe('renderTrajectory', () => {
  it('renders a normal turn in the shared grammar', () => {
    const rendered = renderTrajectory([
      user('fix the bug'),
      toolCall('bash', { command: 'pytest' }),
      toolResult('1 failed'),
      assistant('Fixed it.'),
      turnEnd('completed'),
    ], BUDGET)
    expect(rendered).toContain('[USER] fix the bug')
    expect(rendered).toContain('[ACTION] bash({"command":"pytest"})')
    expect(rendered).toContain('[OBSERVATION] 1 failed')
    expect(rendered).toContain('[ASSISTANT] Fixed it.')
    expect(rendered).toContain('turn ended: completed')
    expect(rendered).not.toContain('OBSERVATION ERROR')
  })

  it('marks a failed tool result with its error identity', () => {
    const rendered = renderTrajectory([
      toolCall('bash', { command: 'boom' }),
      toolResult('kaboom', { isError: true, error: { name: 'Exit', code: '1' } }),
    ], BUDGET)
    expect(rendered).toContain('[OBSERVATION ERROR] kaboom | Exit:1')
  })

  it('drops a compaction fold so real conversation survives', () => {
    const folded = event('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        id: 'a',
        source: { kind: 'model' },
        content: [{ type: 'text', text: 'pre-compaction text' }],
      },
    }, { surfaceOp: { op: 'replace', start: 0, end: 0 } })
    const rendered = renderTrajectory([user('hi'), folded, assistant('current')], BUDGET)
    expect(rendered).not.toContain('pre-compaction text')
    expect(rendered).toContain('[ASSISTANT] current')
  })

  it('labels injected context as harness text, not the user speaking', () => {
    const rendered = renderTrajectory([
      user('<system-reminder>rules</system-reminder>', { kind: 'plugin', plugin: 'instr' }),
    ], BUDGET)
    expect(rendered).toContain('[HARNESS instr]')
    expect(rendered).not.toContain('[USER]')
  })

  it('includes reasoning so a proposer sees the deliberation', () => {
    const rendered = renderTrajectory([assistant('done', 'let me think')], BUDGET)
    expect(rendered).toContain('[REASONING] let me think')
  })

  it('caps the whole render and says how much it dropped', () => {
    const rendered = renderTrajectory([toolResult('x'.repeat(5_000))], {
      obsTrunc: 5_000, argsTrunc: 2_000, maxChars: 200,
    })
    expect(rendered.length).toBeLessThanOrEqual(201 + '…(+4800 chars — render truncation)'.length)
    expect(rendered).toContain('render truncation)')
  })

  it('says so rather than raising on a log with nothing readable', () => {
    expect(renderTrajectory([], BUDGET)).toBe('(no parseable events in trajectory)')
    expect(renderTrajectory([event('todo/write', { todos: [] })], BUDGET))
      .toBe('(no parseable events in trajectory)')
  })
})

describe('turnReason', () => {
  it('reads the last turn', () => {
    expect(turnReason([turnEnd('aborted'), turnEnd('completed')])).toBe('completed')
  })

  it('reports none when the log closed no turn', () => {
    expect(turnReason([user('hi')])).toBe('none')
  })
})

describe('finalMessage', () => {
  it('takes the last assistant text', () => {
    expect(finalMessage([assistant('first'), assistant('second')])).toBe('second')
  })

  it('ignores an empty assistant message', () => {
    expect(finalMessage([assistant('   '), assistant('real')])).toBe('real')
  })
})

describe('renderTrajectory payload fallbacks', () => {
  function userWith(content: unknown, source: unknown = { kind: 'user' }): SessionEvent {
    return event('user/message', { role: 'user', id: 'm', source, content }, APPEND)
  }

  it('reads text from a message whose content is not a block list', () => {
    expect(renderTrajectory([userWith('plain text')], BUDGET)).toContain('[USER] plain text')
  })

  it('renders nothing from a payload that carries no text', () => {
    expect(renderTrajectory([userWith(42), userWith(null)], BUDGET))
      .toBe('(no parseable events in trajectory)')
  })

  it('skips a block that is not an object', () => {
    expect(renderTrajectory([userWith(['raw', null, { type: 'text', text: 'kept' }])], BUDGET))
      .toContain('[USER] kept')
  })

  it('keeps reasoning carried on a content block', () => {
    const rendered = renderTrajectory([
      userWith([{ type: 'reasoning', text: 'deliberation' }, { type: 'reasoning', text: 7 }]),
    ], BUDGET)
    expect(rendered).toContain('[USER] deliberation')
  })

  it('reads text from a message-shaped object', () => {
    expect(renderTrajectory([userWith({ text: 'nested' })], BUDGET)).toContain('[USER] nested')
  })

  it('recurses into a nested content object', () => {
    expect(renderTrajectory([userWith({ content: { text: 'deep' } })], BUDGET))
      .toContain('[USER] deep')
  })

  it('joins the text it finds in a nested array', () => {
    expect(renderTrajectory([userWith({ message: ['a', 'b'] })], BUDGET)).toContain('[USER] a\nb')
  })

  it('treats a blank or empty payload as no text', () => {
    const rendered = renderTrajectory([
      userWith({ text: '   ' }), userWith({}), userWith({ text: null }),
    ], BUDGET)
    expect(rendered).toBe('(no parseable events in trajectory)')
  })

  it('ignores a nested object that carries no text', () => {
    expect(renderTrajectory([userWith({ content: {} })], BUDGET))
      .toBe('(no parseable events in trajectory)')
  })

  it('stops recursing once the payload nests too deeply', () => {
    const deep = { message: { message: { message: { message: { message: { message: null } } } } } }
    expect(renderTrajectory([userWith(deep)], BUDGET)).toBe('(no parseable events in trajectory)')
  })

  it('defaults an absent source to the user tag', () => {
    expect(renderTrajectory([userWith('hi', null)], BUDGET)).toContain('[USER] hi')
  })

  it('tags an unnamed plugin context as the generic harness', () => {
    expect(renderTrajectory([user('rules', { kind: 'plugin' })], BUDGET))
      .toContain('[HARNESS plugin]')
  })
})

describe('renderTrajectory tool call rendering', () => {
  it('passes an unparseable argument string through as text', () => {
    const rendered = renderTrajectory([
      event('tool/call', { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: 'not json' }),
    ], BUDGET)
    expect(rendered).toContain('[ACTION] bash("not json")')
  })

  it('renders an object argument by its JSON', () => {
    const rendered = renderTrajectory([
      event('tool/call', { turn: 1, step: 1, callId: 'c', name: 'bash', arguments: { a: 1 } }),
    ], BUDGET)
    expect(rendered).toContain('[ACTION] bash({"a":1})')
  })

  it('falls back to the tool tag and empty arguments', () => {
    const rendered = renderTrajectory([
      event('tool/call', { turn: 1, step: 1, callId: 'c', name: 9, arguments: null }),
    ], BUDGET)
    expect(rendered).toContain('[ACTION] tool()')
  })

  it('renders a tool call carried on an assistant message', () => {
    const rendered = renderTrajectory([
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          id: 'a',
          source: { kind: 'model' },
          content: [
            { type: 'tool-call', name: 'grep', arguments: { q: 'x' } },
            { type: 'tool-call', arguments: { q: 'y' } },
            { type: 'image' },
          ],
        },
      }, APPEND),
    ], BUDGET)
    expect(rendered).toContain('[ACTION] grep({"q":"x"})')
    expect(rendered).toContain('[ACTION] tool({"q":"y"})')
  })

  it('skips an assistant message that carries no content', () => {
    expect(renderTrajectory([event('assistant/message', { turn: 1, step: 1 }, APPEND)], BUDGET))
      .toBe('(no parseable events in trajectory)')
  })
})

describe('renderTrajectory tool result edge cases', () => {
  it('marks a failed result whose error carries no identity', () => {
    expect(renderTrajectory([toolResult('oops', { isError: true, error: {} })], BUDGET))
      .toContain('[OBSERVATION ERROR] oops | :')
  })

  it('renders a tool result that carries no message', () => {
    expect(renderTrajectory([event('tool/result', { turn: 1, step: 1 }, APPEND)], BUDGET))
      .toBe('[OBSERVATION]')
  })
})

describe('turn and message fallbacks', () => {
  it('reports unknown when a closed turn names no reason kind', () => {
    expect(turnReason([event('turn/end', { turn: 1, reason: {} })])).toBe('unknown')
  })

  it('tolerates an assistant message with no content list', () => {
    expect(finalMessage([event('assistant/message', { turn: 1, step: 1, message: {} }, APPEND)]))
      .toBe('')
  })
})
