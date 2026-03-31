// ============================================================
//  Guang Code — Main REPL App Component
// ============================================================

import React, { useState, useCallback, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { AppState, SessionMessage, PendingPermission } from '../types/index.js'
import { MessageView } from './Message.js'
import { Spinner } from './Spinner.js'
import { PermissionRequest } from './PermissionRequest.js'
import { StatusBar } from './StatusBar.js'
import { runQuery } from '../utils/QueryEngine.js'
import { findSlashCommand } from '../commands/slashCommands.js'
import { saveSession } from '../utils/sessionStorage.js'
import { randomUUID } from 'crypto'

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
  const abortRef = useRef<AbortController | null>(null)

  // ── Keyboard input ─────────────────────────────────────────
  useInput((input: string, key: { ctrl: boolean; upArrow: boolean; downArrow: boolean }) => {
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

    if (key.upArrow && !state.isLoading) {
      const newIdx = Math.min(historyIndex + 1, inputHistory.length - 1)
      if (newIdx >= 0) { setHistoryIndex(newIdx); setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '') }
      return
    }
    if (key.downArrow && !state.isLoading) {
      const newIdx = historyIndex - 1
      if (newIdx < 0) { setHistoryIndex(-1); setInputValue('') }
      else { setHistoryIndex(newIdx); setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '') }
      return
    }
  })

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || state.isLoading) return

    setInputValue('')
    setHistoryIndex(-1)
    setInputHistory(prev => [...prev.slice(-99), trimmed])

    // Slash command?
    const slashMatch = findSlashCommand(trimmed)
    if (slashMatch) {
      try {
        const args = trimmed.slice(slashMatch.command.name.length + 1).trim()
        const result = await slashMatch.command.execute(args, state, setState)
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

    const userMsg: SessionMessage = { id: randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() }

    setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true, error: null }))
    setStreamingText('')
    setSpinnerText('thinking...')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const { messages: newMsgs, inputTokens, outputTokens } = await runQuery({
        messages: [...state.messages, userMsg],
        model: state.model,
        cwd: state.cwd,
        permissionMode: state.permissionMode,
        providerConfig: state.providerConfig,
        apiKeyOverride,
        signal: abort.signal,
        onPermissionRequest: async (toolName, description) => {
          if (state.permissionMode === 'auto') return true
          return new Promise<boolean>((resolve) => {
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
            setStreamingText(prev => prev + (chunk.text ?? ''))
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
  }, [state, apiKeyOverride, streamingText])

  // ── Render ─────────────────────────────────────────────────
  const visibleMessages = state.messages.filter(
    m => m.role !== 'system' || m.content.toString().startsWith('[Conversation'),
  )

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
            <Text> </Text>
          </Box>
        )}

        {visibleMessages.map(msg => <MessageView key={msg.id} message={msg} />)}

        {state.isLoading && streamingText && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="cyan" bold>◆ Guang Code</Text>
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
          <Text color="red">✗ {state.error}</Text>
        </Box>
      )}

      <StatusBar state={state} />

      <Box paddingX={1}>
        <Text color="green" bold>{state.permissionMode === 'plan' ? '📋 ' : '❯ '}</Text>
        {state.isLoading ? (
          <Text color="gray" dimColor>Press Ctrl+C to cancel…</Text>
        ) : (
          <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder="Ask Guang Code anything…" />
        )}
      </Box>
    </Box>
  )
}
