// ============================================================
//  Guang Code — Message Component
// ============================================================

import React from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import { renderMarkdown } from '../utils/markdown/index.js'
import type { SessionMessage } from '../types/index.js'

type MessageProps = {
  message: SessionMessage
  showTimestamp?: boolean
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageView({ message, showTimestamp = false }: MessageProps) {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content)

  // Tool interaction messages (dimmed)
  const isToolMsg = message.toolUseId !== undefined
  if (isToolMsg) {
    const isInput = content.startsWith('[Tool:')
    return (
      <Box flexDirection="column" marginBottom={0}>
        <Text color="gray" dimColor>
          {content.split('\n').slice(0, 3).join('\n')}
          {content.split('\n').length > 3 ? '\n...' : ''}
        </Text>
      </Box>
    )
  }

  // System messages
  if (message.role === 'system') {
    return (
      <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="yellow">
        <Text color="yellow" dimColor>{content}</Text>
      </Box>
    )
  }

  // User messages
  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="green" bold>{figures.play} You</Text>
          {showTimestamp && (
            <Text color="gray" dimColor>  {formatTime(message.timestamp)}</Text>
          )}
        </Box>
        <Box paddingLeft={2}>
          <Text>{content}</Text>
        </Box>
      </Box>
    )
  }

  // Assistant messages — render with basic markdown-like formatting
  if (message.role === 'assistant') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="cyan" bold>{figures.square} Guang Code</Text>
          {showTimestamp && (
            <Text color="gray" dimColor>  {formatTime(message.timestamp)}</Text>
          )}
        </Box>
        <Box paddingLeft={2} flexDirection="column">
          <AssistantText text={content} />
        </Box>
      </Box>
    )
  }

  return null
}

// Simple assistant text renderer with code block detection
function AssistantText({ text }: { text: string }) {
  // Use our new robust markdown renderer
  return (
    <Box flexDirection="column">
      <Text>{renderMarkdown(text)}</Text>
    </Box>
  )
}
