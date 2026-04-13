// ============================================================
//  Guang Code — Main REPL App Component
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Box, Text, useInput, Spacer } from 'ink'
import TextInput from 'ink-text-input'
import figures from 'figures'
import type { AppState, SessionMessage, PendingPermission } from '../types/index.js'
import { MessageView } from './Message.js'
import { Spinner } from './Spinner.js'
import { PermissionRequest } from './PermissionRequest.js'
import { StatusBar } from './StatusBar.js'
import { runQuery } from '../utils/QueryEngine.js'
import { loadProjectInstructions } from '../utils/projectInstructions.js'
import { getAllSlashCommands } from '../commands/slashCommands.js'
import { saveSession } from '../utils/sessionStorage.js'
import { randomUUID } from 'crypto'
import { onSubagentEvent } from '../utils/subagents.js'
import type { CronTaskRun } from '../utils/cronTasks.js'
import { claimDueProjectCronRuns, finalizeProjectCronRun } from '../utils/cronTasks.js'
import { appendTailWindow } from '../utils/textDisplay.js'
import { classifyUserInput } from '../utils/userInputPipeline.js'
import { getSuggestions } from '../utils/suggestions/pipeline.js'
import type { Suggestion } from '../utils/suggestions/types.js'

type Props = {
  initialState: AppState
  /** CLI-level --api-key override; takes priority over config file keys */
  apiKeyOverride?: string
}

export function App({ initialState, apiKeyOverride }: Props) {
  const [state, setState] = useState<AppState>(initialState)
  const [inputValue, setInputValue] = useState('')
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [streamingText, setStreamingText] = useState('')
  const [spinnerText, setSpinnerText] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [suggestions, setSuggestions] = useState<{ key: string; items: Suggestion[] }>({ key: '', items: [] })
  const [suggestCycle, setSuggestCycle] = useState<{ key: string; index: number }>({ key: '', index: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const bgSeenRef = useRef<Set<string>>(new Set())
  const stateRef = useRef<AppState>(state)
  const cronQueueRef = useRef<CronTaskRun[]>([])
  const cronProcessingRef = useRef(false)
  const suggestReqRef = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const allSlashCommands = useMemo(() => getAllSlashCommands(state.cwd), [state.cwd])

  const paletteItems = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    const scored = allSlashCommands.map(c => {
      const name = c.name.toLowerCase()
      const desc = (c.description ?? '').toLowerCase()
      let score = 0
      if (!q) score = 1
      else if (name === q) score = 100
      else if (name.startsWith(q)) score = 60 - (name.length - q.length)
      else if (name.includes(q)) score = 40 - Math.max(0, name.indexOf(q))
      else if (desc.includes(q)) score = 20 - Math.max(0, desc.indexOf(q))
      return { name: c.name, description: c.description, usage: c.usage, examples: c.examples, noArgs: c.noArgs, score }
    })
    return scored
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 12)
  }, [allSlashCommands, paletteQuery])

  const activeSlashHelp = useMemo(() => {
    const v = inputValue
    if (!v.startsWith('/')) return null
    const token = v.slice(1).split(/\s+/)[0]?.trim().toLowerCase()
    if (!token) return null
    const scored = allSlashCommands.map(c => {
      const name = c.name.toLowerCase()
      const desc = (c.description ?? '').toLowerCase()
      let score = 0
      if (name === token) score = 100
      else if (name.startsWith(token)) score = 60 - (name.length - token.length)
      else if (name.includes(token)) score = 40 - Math.max(0, name.indexOf(token))
      else if (desc.includes(token)) score = 20 - Math.max(0, desc.indexOf(token))
      return { cmd: c, score }
    })
    const best = scored.sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))[0]?.cmd
    if (!best) return null
    const usage = best.usage ? best.usage : `/${best.name}${best.noArgs ? '' : ' …'}`
    const examples = best.examples ?? []
    return { name: best.name, description: best.description, usage, examples }
  }, [allSlashCommands, inputValue])

  useEffect(() => {
    if (paletteOpen || state.isLoading || state.pendingPermission) {
      if (suggestions.items.length > 0) setSuggestions({ key: '', items: [] })
      return
    }
    const reqId = ++suggestReqRef.current
    const timer = setTimeout(() => {
      const cur = stateRef.current
      getSuggestions({
        cwd: cur.cwd,
        input: inputValue,
        inputHistory,
        slashCommands: allSlashCommands.map(c => ({ name: c.name, description: c.description })),
      }).then(res => {
        if (suggestReqRef.current !== reqId) return
        setSuggestions(res)
      }).catch(() => {})
    }, 40)
    return () => clearTimeout(timer)
  }, [allSlashCommands, inputHistory, inputValue, paletteOpen, state.isLoading, state.pendingPermission])

  const runAutomatedPrompt = useCallback(async (promptText: string, label: string, kind: 'cron' | 'command'): Promise<boolean> => {
    const cur = stateRef.current
    if (cur.isLoading || cur.pendingPermission) return false
    let hadError = false

    const userMsg: SessionMessage = {
      id: randomUUID(),
      role: 'user',
      content: kind === 'cron' ? `[Scheduled Task: ${label}]\n${promptText}` : `[Automated: ${label}]\n${promptText}`,
      timestamp: Date.now(),
    }

    setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true, error: null }))
    setStreamingText('')
    setSpinnerText('thinking...')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const { messages: newMsgs, inputTokens, outputTokens } = await runQuery({
        messages: [...cur.messages, userMsg],
        model: cur.model,
        cwd: cur.cwd,
        permissionMode: cur.permissionMode,
        planApproved: cur.planApproved,
        providerConfig: cur.providerConfig,
        apiKeyOverride,
        signal: abort.signal,
        onPermissionRequest: async (toolName, description) => {
          const latest = stateRef.current
          if (latest.permissionMode === 'auto') return 'always_allow'
          return new Promise<'allow_once' | 'always_allow' | 'deny'>((resolve) => {
            const pending: PendingPermission = {
              id: randomUUID(), toolName, description,
              resolve: (approved) => {
                setState(prev => ({ ...prev, pendingPermission: null }))
                resolve(approved)
              },
            }
            setState(prev => ({ ...prev, pendingPermission: pending }))
          })
        },
        onStreamChunk: (chunk) => {
          if (chunk.type === 'text_delta') {
            setStreamingText(prev => appendTailWindow(prev, chunk.text ?? '', 8_000))
          } else if (chunk.type === 'tool_start') {
            const name = chunk.toolName ?? ''
            setSpinnerText(name && name !== '…' ? `${name}…` : 'thinking...')
            setStreamingText('')
          } else if (chunk.type === 'tool_done') {
            setSpinnerText('thinking...')
          } else if (chunk.type === 'error') {
            hadError = true
            setState(prev => ({ ...prev, error: chunk.error ?? 'Unknown error', isLoading: false }))
            setSpinnerText('')
            setStreamingText('')
          }
        },
      })

      setState(prev => {
        const combined = [...prev.messages, ...newMsgs]
        const lastAssistant = [...newMsgs].reverse().find(m => m.role === 'assistant' && !m.toolUseId && typeof m.content === 'string') as any
        const pendingPlan = prev.permissionMode === 'plan' && !prev.planApproved
          ? (typeof lastAssistant?.content === 'string' ? String(lastAssistant.content) : prev.pendingPlan)
          : prev.pendingPlan
        const updated: AppState = {
          ...prev,
          messages: combined,
          isLoading: false,
          inputTokens: prev.inputTokens + inputTokens,
          outputTokens: prev.outputTokens + outputTokens,
          pendingPermission: null,
          spinnerText: '',
          pendingPlan,
        }
        saveSession({
          id: prev.sessionId,
          title: prev.sessionTitle,
          createdAt: prev.sessionCreatedAt,
          updatedAt: Date.now(),
          cwd: prev.cwd,
          model: prev.model,
          messages: combined,
          inputTokens: updated.inputTokens,
          outputTokens: updated.outputTokens,
        }).catch(() => {})
        return updated
      })
      return !hadError
    } catch (err: unknown) {
      const e = err as Error
      if (e.name !== 'AbortError') {
        setState(prev => ({ ...prev, isLoading: false, error: e.message, pendingPermission: null }))
      } else {
        setState(prev => ({ ...prev, isLoading: false, pendingPermission: null }))
      }
      return false
    }

    setStreamingText('')
    setSpinnerText('')
  }, [apiKeyOverride])

  useEffect(() => {
    const cur = stateRef.current
    const pending = cur.pendingAutomatedPrompt
    if (!pending) return
    if (cur.isLoading || cur.pendingPermission) return

    setState(prev => ({ ...prev, pendingAutomatedPrompt: undefined }))
    runAutomatedPrompt(pending.prompt, pending.label, 'command').catch(() => {})
  }, [state.pendingAutomatedPrompt, runAutomatedPrompt])

  const processCronQueue = useCallback(async () => {
    if (cronProcessingRef.current) return
    cronProcessingRef.current = true
    try {
      while (true) {
        const cur = stateRef.current
        if (cur.isLoading || cur.pendingPermission) return
        const next = cronQueueRef.current.shift()
        if (!next) return
        const label = `${next.task.id}@${new Date(next.bucket).toISOString().slice(0, 16)}`
        const ok = await runAutomatedPrompt(next.task.prompt, label, 'cron')
        finalizeProjectCronRun(cur.cwd, { task: next.task, bucket: next.bucket }, ok)
      }
    } finally {
      cronProcessingRef.current = false
    }
  }, [runAutomatedPrompt])

  useEffect(() => {
    const interval = setInterval(async () => {
      const cur = stateRef.current
      if (cur.isLoading || cur.pendingPermission) return
      const claimed = claimDueProjectCronRuns(cur.cwd, new Date())
      if (claimed.runs.length > 0) {
        const maxQueue = 20
        const existing = new Set(cronQueueRef.current.map(r => `${r.task.id}:${r.bucket}`))
        for (const r of claimed.runs) {
          const key = `${r.task.id}:${r.bucket}`
          if (existing.has(key)) continue
          cronQueueRef.current.push(r)
          existing.add(key)
          if (cronQueueRef.current.length >= maxQueue) break
        }
      }
      await processCronQueue()
    }, 5_000)

    return () => clearInterval(interval)
  }, [processCronQueue])

  useEffect(() => {
    const off = onSubagentEvent(e => {
      if (e.type === 'started') {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: `[Tool: Task]\nInput: ${JSON.stringify({ id: e.id, run_in_background: true, description: e.description }, null, 2)}`,
              timestamp: Date.now(),
              toolUseId: e.id,
            },
          ],
        }))
        return
      }

      if (e.type === 'named') {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: `[Task ${e.id} named]\n\n${e.name}`,
              timestamp: Date.now(),
              toolUseId: e.id,
            },
          ],
        }))
        return
      }

      if (e.type === 'progress') {
        const key = `${e.id}:${e.message}`
        if (bgSeenRef.current.has(key)) return
        bgSeenRef.current.add(key)
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: `[Tool: Task]\n${e.message}`,
              timestamp: Date.now(),
              toolUseId: e.id,
            },
          ],
        }))
        return
      }

      if (e.type === 'completed') {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: `[Task ${e.id} completed]\n\n${e.report}`,
              timestamp: Date.now(),
            },
          ],
        }))
        return
      }

      if (e.type === 'failed') {
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: `[Task ${e.id} failed]\n\n${e.error}`,
              timestamp: Date.now(),
            },
          ],
        }))
      }
    })
    return off
  }, [])

  // ── Keyboard input ─────────────────────────────────────────
  useInput((input: string, key: any) => {
    if (key.ctrl && input === 'c') {
      if (state.isLoading && abortRef.current) {
        abortRef.current.abort()
        setState(prev => ({ ...prev, isLoading: false }))
        setStreamingText('')
        setSpinnerText('')
      }
      return
    }
    if (key.ctrl && input === 'd') process.exit(0)

    if (key.ctrl && input === 'p') {
      if (state.isLoading || state.pendingPermission) return
      setPaletteOpen(prev => !prev)
      setPaletteQuery('')
      setPaletteIndex(0)
      return
    }

    if (paletteOpen) {
      if (key.escape) {
        setPaletteOpen(false)
        setPaletteQuery('')
        setPaletteIndex(0)
        return
      }
      if (key.upArrow) {
        setPaletteIndex(i => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setPaletteIndex(i => Math.min(Math.max(0, paletteItems.length - 1), i + 1))
        return
      }
    }

    if (!paletteOpen && !state.isLoading && !state.pendingPermission) {
      if (key.tab || input === '\t') {
        if (suggestions.items.length === 0) return
        const step = key.shift ? -1 : 1
        const nextIndex =
          suggestCycle.key === suggestions.key
            ? (suggestCycle.index + step + suggestions.items.length) % suggestions.items.length
            : 0
        const picked = suggestions.items[nextIndex]
        if (!picked) return
        setSuggestCycle({ key: suggestions.key, index: nextIndex })
        setInputValue(picked.apply(inputValue))
        setHistoryIndex(-1)
        return
      }
    }

    if (key.upArrow && !state.isLoading && !paletteOpen && !state.pendingPermission) {
      const newIdx = Math.min(historyIndex + 1, inputHistory.length - 1)
      if (newIdx >= 0) { setHistoryIndex(newIdx); setSuggestCycle({ key: '', index: 0 }); setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '') }
      return
    }
    if (key.downArrow && !state.isLoading && !paletteOpen && !state.pendingPermission) {
      const newIdx = historyIndex - 1
      if (newIdx < 0) { setHistoryIndex(-1); setSuggestCycle({ key: '', index: 0 }); setInputValue('') }
      else { setHistoryIndex(newIdx); setSuggestCycle({ key: '', index: 0 }); setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '') }
      return
    }
  })

  const executeSlashCommand = useCallback(async (name: string, args: string) => {
    const cur = stateRef.current
    const cmd = getAllSlashCommands(cur.cwd).find(c => c.name.toLowerCase() === name.toLowerCase())
    if (!cmd) return
    try {
      const result = await cmd.execute(args, cur, setState)
      if (result) {
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { id: randomUUID(), role: 'assistant', content: result, timestamp: Date.now() }],
        }))
      }
    } catch (err: unknown) {
      setState(prev => ({ ...prev, error: (err as Error).message }))
    }
  }, [])

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return

    const cur = stateRef.current
    if (cur.pendingPermission) return
    if (cur.isLoading) return

    setInputValue('')
    setHistoryIndex(-1)
    setSuggestCycle({ key: '', index: 0 })
    setSuggestions({ key: '', items: [] })
    setInputHistory(prev => [...prev.slice(-99), trimmed])

    const classified = classifyUserInput(trimmed, cur.cwd)
    if (classified.kind === 'slash') {
      try {
        const result = await classified.command.execute(classified.args, cur, setState)
        if (result) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { id: randomUUID(), role: 'assistant', content: result, timestamp: Date.now() }],
          }))
        }
      } catch (err: unknown) {
        setState(prev => ({ ...prev, error: (err as Error).message }))
      }
      return
    }

    const userMsg: SessionMessage = { id: randomUUID(), role: 'user', content: classified.content, timestamp: Date.now() }

    setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true, error: null }))
    setStreamingText('')
    setSpinnerText('thinking...')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const { messages: newMsgs, inputTokens, outputTokens } = await runQuery({
        messages: [...cur.messages, userMsg],
        model: cur.model,
        cwd: cur.cwd,
        permissionMode: cur.permissionMode,
        planApproved: cur.planApproved,
        providerConfig: cur.providerConfig,
        apiKeyOverride,
        signal: abort.signal,
        onPermissionRequest: async (toolName, description) => {
          const latest = stateRef.current
          if (latest.permissionMode === 'auto') return 'always_allow'
          return new Promise<'allow_once' | 'always_allow' | 'deny'>((resolve) => {
            const pending: PendingPermission = {
              id: randomUUID(), toolName, description,
              resolve: (approved) => {
                setState(prev => ({ ...prev, pendingPermission: null }))
                resolve(approved)
              },
            }
            setState(prev => ({ ...prev, pendingPermission: pending }))
          })
        },
        onStreamChunk: (chunk) => {
          if (chunk.type === 'text_delta') {
            setStreamingText(prev => appendTailWindow(prev, chunk.text ?? '', 8_000))
          } else if (chunk.type === 'tool_start') {
            const name = chunk.toolName ?? ''
            setSpinnerText(name && name !== '…' ? `${name}…` : 'thinking...')
            setStreamingText('')
          } else if (chunk.type === 'tool_done') {
            setSpinnerText('thinking...')
          } else if (chunk.type === 'error') {
            setState(prev => ({ ...prev, error: chunk.error ?? 'Unknown error', isLoading: false }))
            setSpinnerText('')
            setStreamingText('')
          }
        },
      })

      setState(prev => {
        const combined = [...prev.messages, ...newMsgs]
        const updated: AppState = {
          ...prev,
          messages: combined,
          isLoading: false,
          inputTokens: prev.inputTokens + inputTokens,
          outputTokens: prev.outputTokens + outputTokens,
          pendingPermission: null,
          spinnerText: '',
        }
        saveSession({
          id: prev.sessionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cwd: prev.cwd,
          model: prev.model,
          messages: combined,
          inputTokens: updated.inputTokens,
          outputTokens: updated.outputTokens,
        }).catch(() => {})
        return updated
      })
    } catch (err: unknown) {
      const e = err as Error
      if (e.name !== 'AbortError') {
        setState(prev => ({ ...prev, isLoading: false, error: e.message, pendingPermission: null }))
      } else {
        setState(prev => ({ ...prev, isLoading: false, pendingPermission: null }))
      }
    }

    setStreamingText('')
    setSpinnerText('')
  }, [apiKeyOverride])

  // ── Render ─────────────────────────────────────────────────
  const visibleMessages = state.messages.filter(
    m => m.role !== 'system' || m.content.toString().startsWith('[Conversation'),
  )

  const hasInstructions = !!loadProjectInstructions(state.cwd)

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleMessages.length === 0 && (
          <Box flexDirection="column" paddingY={1}>
            <Text color="cyan" bold>{'  ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗ '}</Text>
            <Text color="cyan" bold>{'  ██╔════╝ ██║   ██║██╔══██╗████╗  ██║██╔════╝ '}</Text>
            <Text color="cyan" bold>{'  ██║  ███╗██║   ██║███████║██╔██╗ ██║██║  ███╗'}</Text>
            <Text color="cyan" bold>{'  ██║   ██║██║   ██║██╔══██║██║╚██╗██║██║   ██║'}</Text>
            <Text color="cyan" bold>{'  ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝'}</Text>
            <Text color="cyan" bold>{'   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ '}</Text>
            <Text color="cyan" bold>{'               CODE  ✦'}</Text>
            <Text> </Text>
            <Text color="gray">  Your AI coding assistant. Type <Text color="white">a task</Text> to get started.</Text>
            <Text color="gray">  Type <Text color="white">/help</Text> for commands · <Text color="white">/keys</Text> to manage API keys · <Text color="white">/providers</Text> to see models</Text>
            {hasInstructions && (
              <Text color="green" dimColor>  {figures.tick} Loaded instructions (CLAUDE.md/.claude/rules/)</Text>
            )}
            <Text> </Text>
          </Box>
        )}

        {visibleMessages.map(msg => <MessageView key={msg.id} message={msg} />)}

        {state.isLoading && streamingText && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="cyan" bold>{figures.square} Guang Code</Text>
            <Box paddingLeft={2} flexDirection="column">
              <Text>{streamingText}</Text>
              <Text color="cyan" dimColor>▌</Text>
            </Box>
          </Box>
        )}

        {state.isLoading && !streamingText && (
          <Box marginBottom={1}><Spinner text={spinnerText} /></Box>
        )}
      </Box>

      {state.pendingPermission && <PermissionRequest permission={state.pendingPermission} />}

      {state.error && (
        <Box paddingX={1} marginBottom={1}>
          <Text color="red">{figures.cross} {state.error}</Text>
        </Box>
      )}

      <StatusBar state={state} />

      {!state.isLoading && !paletteOpen && suggestions.items.length > 0 && (
        <Box paddingX={1} flexDirection="column" marginBottom={1}>
          <Text color="gray" dimColor>Tab to complete · Shift+Tab to reverse · Ctrl+P command palette</Text>
          {suggestions.items.map((s, i) => (
            <Text key={s.id} color={i === 0 ? 'cyan' : 'gray'} dimColor>{s.label}</Text>
          ))}
        </Box>
      )}

      {paletteOpen && (
        <Box paddingX={1} flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan">
          <Text color="cyan" bold>Command Palette</Text>
          <Box>
            <Text color="gray">{figures.pointer} </Text>
            <TextInput
              value={paletteQuery}
              onChange={(v) => { setPaletteQuery(v); setPaletteIndex(0) }}
              onSubmit={() => {
                const picked = paletteItems[paletteIndex]
                if (!picked) return
                setPaletteOpen(false)
                setPaletteQuery('')
                setPaletteIndex(0)
                if (picked.noArgs) {
                  executeSlashCommand(picked.name, '')
                } else {
                  setInputValue(`/${picked.name} `)
                  setSuggestCycle({ key: '', index: 0 })
                }
              }}
              placeholder="Type to search commands…"
            />
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {paletteItems.length === 0 ? (
              <Text color="gray" dimColor>No matches</Text>
            ) : (
              paletteItems.map((it, idx) => (
                <Text key={it.name} color={idx === paletteIndex ? 'black' : 'white'} backgroundColor={idx === paletteIndex ? 'cyan' : undefined}>
                  {`/${it.name}  ${it.description ?? ''}`}
                </Text>
              ))
            )}
          </Box>
          {paletteItems[paletteIndex] && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>Usage: {(paletteItems[paletteIndex]!.usage ?? `/${paletteItems[paletteIndex]!.name}${paletteItems[paletteIndex]!.noArgs ? '' : ' …'}`)}</Text>
              {(paletteItems[paletteIndex]!.examples ?? []).slice(0, 3).map((ex: string, i: number) => (
                <Text key={i} color="gray" dimColor>{`Example: ${ex.trim()}`}</Text>
              ))}
            </Box>
          )}
          <Text color="gray" dimColor>
            {paletteItems[paletteIndex]?.noArgs ? 'Enter to run · Esc to close · ↑↓ to navigate' : 'Enter to insert · Esc to close · ↑↓ to navigate'}
          </Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Text color="green" bold>{state.permissionMode === 'plan' ? '📋 ' : `${figures.pointer} `}</Text>
        {state.isLoading ? (
          <Text color="gray" dimColor>Press Ctrl+C to cancel…</Text>
        ) : state.pendingPermission ? (
          <Text color="gray" dimColor>Waiting for permission… (Y=allow, A=always, N/Esc=deny)</Text>
        ) : (
          !paletteOpen && (
            <TextInput
              value={inputValue}
              onChange={(v) => { setInputValue(v); setSuggestCycle({ key: '', index: 0 }) }}
              onSubmit={handleSubmit}
              placeholder="Ask Guang Code anything…"
            />
          )
        )}
      </Box>
      {!state.isLoading && !paletteOpen && activeSlashHelp && inputValue.startsWith('/') && (
        <Box paddingX={1} flexDirection="column">
          <Text color="gray" dimColor>{`Usage: ${activeSlashHelp.usage}`}</Text>
          {activeSlashHelp.examples.slice(0, 2).map((ex, i) => (
            <Text key={i} color="gray" dimColor>{`Example: ${ex.trim()}`}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
