// ============================================================
//  Guang Code — Core Type Definitions
// ============================================================

// ------------------------------------------------------------------
// Message types
// ------------------------------------------------------------------
export type Role = 'user' | 'assistant' | 'system'

export type TextContent = {
  type: 'text'
  text: string
}

export type ToolUseContent = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultContent = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent

export type Message = {
  role: Role
  content: MessageContent[] | string
  timestamp: number
}

// ------------------------------------------------------------------
// Tool types
// ------------------------------------------------------------------
export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, {
    type: string
    description: string
    enum?: string[]
    default?: unknown
  }>
  required?: string[]
}

export type ToolPermissionMode = 'ask' | 'auto' | 'deny'

export type ToolDef = {
  name: string
  description: string
  inputSchema: ToolInputSchema
  permissionMode?: ToolPermissionMode
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

export type ToolResult = {
  content: string
  isError?: boolean
}

export type ToolContext = {
  cwd: string
  permissionMode: PermissionMode
  onPermissionRequest: (toolName: string, description: string) => Promise<boolean | 'always_allow' | 'allow_once' | 'deny'>
  model?: string
  providerConfig?: GcConfig
  apiKeyOverride?: string
}

// ------------------------------------------------------------------
// Permission modes
// ------------------------------------------------------------------
export type PermissionMode = 'default' | 'auto' | 'plan'

// ------------------------------------------------------------------
// Provider types
// ------------------------------------------------------------------

/** Supported LLM provider IDs */
export type ProviderId = 'anthropic' | 'openai' | 'minimax' | 'openai-compatible'

/** Per-provider config stored in ~/.guang-code/config.json */
export type ProviderConfig = {
  apiKey: string
  /** For openai-compatible: custom base URL */
  baseUrl?: string
  /** Display name override */
  displayName?: string
}

// ------------------------------------------------------------------
// Output styles
// ------------------------------------------------------------------
export type OutputStyle = 'default' | 'explanatory' | 'learning'

// ------------------------------------------------------------------
// Permission rules
// ------------------------------------------------------------------
export type PermissionEffect = 'allow' | 'deny' | 'ask'

export type PermissionRule = {
  id?: string
  effect: PermissionEffect
  tool?: string
  path?: string
  command?: string
  description?: string
}

/** Full config file shape */
export type GcConfig = {
  version: 1
  /** Default model to use at startup */
  defaultModel: string
  /** Default permission mode */
  defaultMode: PermissionMode
  /** API keys and settings per provider */
  providers: Partial<Record<ProviderId, ProviderConfig>>
  /** Always allow rules for tool permissions */
  alwaysAllowRules?: string[]
  /** Enable automatic sub-agent delegation for some requests */
  autoDelegate?: boolean
  /** Output style applied to system prompt */
  outputStyle?: OutputStyle
  /** Fine-grained tool permission rules */
  permissionRules?: PermissionRule[]
}

/** Runtime provider resolution result */
export type ResolvedProvider = {
  id: ProviderId
  apiKey: string
  baseUrl?: string
  model: string
}

// ------------------------------------------------------------------
// LLMProvider interface — every backend must implement this
// ------------------------------------------------------------------

/** Normalized tool call returned by provider streaming */
export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

/** Streaming chunk events emitted by a provider */
export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; partialJson: string }
  | { type: 'tool_call_end'; toolCall: ToolCall }
  | { type: 'done'; stopReason: string; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }

/** Normalized chat message for provider APIs */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> }
  | { role: 'assistant'; content: string | Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> }

/** Tool definition shape sent to provider */
export type ProviderTool = {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

/** The unified provider interface */
export interface LLMProvider {
  readonly id: ProviderId
  /** Stream a chat completion, yielding StreamChunks */
  streamChat(opts: {
    model: string
    system: string
    messages: ChatMessage[]
    tools: ProviderTool[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunk>
}

// ------------------------------------------------------------------
// Session / App state
// ------------------------------------------------------------------
export type SessionMessage = {
  id: string
  role: Role
  content: string | MessageContent[]
  timestamp: number
  toolUseId?: string
}

export type AppState = {
  messages: SessionMessage[]
  isLoading: boolean
  permissionMode: PermissionMode
  model: string
  /** Active provider config (resolved at startup) */
  providerConfig: GcConfig
  inputTokens: number
  outputTokens: number
  cwd: string
  sessionId: string
  pendingPermission: PendingPermission | null
  error: string | null
  spinnerText: string
  planApproved: boolean
}

export type PendingPermission = {
  id: string
  toolName: string
  description: string
  resolve: (result: 'allow_once' | 'always_allow' | 'deny') => void
}

// ------------------------------------------------------------------
// Slash commands
// ------------------------------------------------------------------
export type SlashCommand = {
  name: string
  description: string
  execute: (args: string, state: AppState, setState: SetState) => Promise<string | null>
}

export type SetState = (updater: (prev: AppState) => AppState) => void

// ------------------------------------------------------------------
// QueryEngine stream chunk (UI-facing, higher-level than StreamChunk)
// ------------------------------------------------------------------
export type OnStreamChunk = (chunk: {
  type: 'text_delta' | 'tool_start' | 'tool_done' | 'done' | 'error'
  text?: string
  toolName?: string
  toolResult?: string
  error?: string
  inputTokens?: number
  outputTokens?: number
}) => void
