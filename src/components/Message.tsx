// ============================================================
//  Guang Code — Message Component
// ============================================================

import React from 'react'
import { Box, Text } from 'ink'
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
          <Text color="green" bold>▶ You</Text>
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
          <Text color="cyan" bold>◆ Guang Code</Text>
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
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let key = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        // End code block
        const codeContent = codeLines.join('\n')
        elements.push(
          <Box key={key++} flexDirection="column" marginY={0}>
            {codeLang && <Text color="gray" dimColor>{codeLang}</Text>}
            <Text color="yellow">{codeContent}</Text>
          </Box>
        )
        inCode = false
        codeLang = ''
        codeLines = []
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<Text key={key++} color="magenta" bold>{line.slice(4)}</Text>)
    } else if (line.startsWith('## ')) {
      elements.push(<Text key={key++} color="cyan" bold>{line.slice(3)}</Text>)
    } else if (line.startsWith('# ')) {
      elements.push(<Text key={key++} color="cyan" bold underline>{line.slice(2)}</Text>)
    }
    // Bullet points
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<Text key={key++}>{'  • '}{line.slice(2)}</Text>)
    }
    // Numbered list
    else if (/^\d+\. /.test(line)) {
      elements.push(<Text key={key++}>{line}</Text>)
    }
    // Bold (**text**)
    else if (line.includes('**')) {
      elements.push(<Text key={key++}>{line.replace(/\*\*([^*]+)\*\*/g, '$1')}</Text>)
    }
    // Empty line
    else if (line === '') {
      elements.push(<Text key={key++}>{''}</Text>)
    }
    // Regular text
    else {
      elements.push(<Text key={key++}>{line}</Text>)
    }
  }

  // Flush unclosed code block
  if (inCode && codeLines.length > 0) {
    elements.push(
      <Text key={key++} color="yellow">{codeLines.join('\n')}</Text>
    )
  }

  return <Box flexDirection="column">{elements}</Box>
}
