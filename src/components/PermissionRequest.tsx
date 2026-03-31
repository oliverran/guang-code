// ============================================================
//  Guang Code — Permission Request Component
// ============================================================

import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { PendingPermission } from '../types/index.js'

type Props = {
  permission: PendingPermission
}

export function PermissionRequest({ permission }: Props) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      permission.resolve(true)
    } else if (input === 'n' || input === 'N' || key.escape) {
      permission.resolve(false)
    }
  })

  const lines = permission.description.split('\n')

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text color="yellow" bold>⚠  Permission Request</Text>
      <Text color="yellow" bold>Tool: {permission.toolName}</Text>
      <Box marginY={1} flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} color="white">{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="green" bold>[Y] </Text>
        <Text color="green">Allow  </Text>
        <Text color="red" bold>[N] </Text>
        <Text color="red">Deny</Text>
      </Box>
    </Box>
  )
}
