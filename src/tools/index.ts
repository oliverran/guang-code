// ============================================================
//  Guang Code — Tool Base
// ============================================================

import type { ToolDef } from '../types/index.js'
import { BashTool } from './BashTool.js'
import { FileReadTool } from './FileReadTool.js'
import { FileWriteTool } from './FileWriteTool.js'
import { FileEditTool } from './FileEditTool.js'
import { GlobTool } from './GlobTool.js'
import { GrepTool } from './GrepTool.js'
import { WebFetchTool } from './WebFetchTool.js'
import { ListDirTool } from './ListDirTool.js'
import { AgentTool } from './AgentTool.js'
import { SendMessageTool } from './SendMessageTool.js'

export function getTools(): ToolDef[] {
  return [
    AgentTool,
    SendMessageTool,
    BashTool,
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
    ListDirTool,
  ]
}

export function getToolByName(name: string): ToolDef | undefined {
  return getTools().find(t => t.name === name)
}
