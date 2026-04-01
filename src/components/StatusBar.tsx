// ============================================================
//  Guang Code — Status Bar
// ============================================================

import React from 'react'
import { Box, Text, Spacer } from 'ink'
import { useState, useEffect } from 'react'
import figures from 'figures'
import type { AppState } from '../types/index.js'

type Props = {
  state: AppState
}

const MODE_COLORS: Record<string, string> = {
  default: 'cyan',
  auto: 'green',
  plan: 'yellow',
}

const MODE_ICONS: Record<string, string> = {
  default: figures.circleFilled,
  auto: '⚡',
  plan: '📋',
}

export function StatusBar({ state }: Props) {
  const [columns, setColumns] = useState(process.stdout.columns ?? 80)
  useEffect(() => {
    const handler = () => setColumns(process.stdout.columns ?? 80)
    process.stdout.on('resize', handler)
    return () => { process.stdout.off('resize', handler) }
  }, [])
  const { model, permissionMode, inputTokens, outputTokens, cwd, isLoading } = state

  const totalTokens = inputTokens + outputTokens
  const tokenStr = totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k tokens` : ''
  const modeColor = MODE_COLORS[permissionMode] ?? 'white'
  const modeIcon = MODE_ICONS[permissionMode] ?? '●'

  // Shorten model name
  const shortModel = model
    .replace('claude-', '')
    .replace('-20241022', '')
    .replace('-20240229', '')
    .slice(0, 20)

  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      paddingX={1}
      width={columns}
    >
      {/* Left: logo */}
      <Text color="cyan" bold>GC </Text>
      <Text color="gray">│ </Text>

      {/* Model */}
      <Text color="white">{shortModel}</Text>
      <Text color="gray"> │ </Text>

      {/* Mode */}
      <Text color={modeColor}>{modeIcon} {permissionMode}</Text>
      <Text color="gray"> │ </Text>

      {/* CWD shortened */}
      <Text color="gray">{shortenPath(cwd)}</Text>

      <Spacer />
      <Box>
        {isLoading && <Text color="cyan">⟳ thinking  </Text>}
        {tokenStr && <Text color="gray" dimColor>{tokenStr}</Text>}
      </Box>
    </Box>
  )
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? '/root'
  const rel = p.startsWith(home) ? '~' + p.slice(home.length) : p
  if (rel.length <= 30) return rel
  const parts = rel.split('/')
  if (parts.length <= 3) return rel
  return `…/${parts.slice(-2).join('/')}`
}
