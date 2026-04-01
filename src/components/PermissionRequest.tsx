// ============================================================
//  Guang Code — Permission Request Component
// ============================================================

import React from 'react'
import { Box, Text, useInput } from 'ink'
import figures from 'figures'
import type { PendingPermission } from '../types/index.js'

type Props = {
  permission: PendingPermission
}

export function PermissionRequest({ permission }: Props) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      permission.resolve('allow_once')
    } else if (input === 'n' || input === 'N' || key.escape) {
      permission.resolve('deny')
    } else if (input === 'a' || input === 'A') {
      permission.resolve('always_allow')
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
      <Text color="yellow" bold>{figures.warning}  Permission Request</Text>
      <Text color="yellow" bold>Tool: {permission.toolName}</Text>
      <Box marginY={1} flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} color="gray">{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="green" bold>[Y/{figures.tick}] </Text>
        <Text color="green">Allow Once  </Text>
        <Text color="cyan" bold>[A] </Text>
        <Text color="cyan">Always Allow  </Text>
        <Text color="red" bold>[N/{figures.cross}] </Text>
        <Text color="red">Deny</Text>
      </Box>
    </Box>
  )
}
