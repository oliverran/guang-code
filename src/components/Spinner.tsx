// ============================================================
//  Guang Code — Spinner Component
// ============================================================

import React, { useState, useEffect } from 'react'
import { Text } from 'ink'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TOOL_FRAMES = ['◐', '◓', '◑', '◒']

type SpinnerProps = {
  text?: string
  type?: 'default' | 'tool'
  color?: string
}

export function Spinner({ text = '', type = 'default', color = 'cyan' }: SpinnerProps) {
  const [frame, setFrame] = useState(0)
  const frames = type === 'tool' ? TOOL_FRAMES : FRAMES

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 80)
    return () => clearInterval(timer)
  }, [frames.length])

  return (
    <Text color={color}>
      {frames[frame]}
      {text ? ` ${text}` : ''}
    </Text>
  )
}
