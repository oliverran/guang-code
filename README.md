# Guang Code

> A terminal AI coding assistant inspired by Claude Code.  
> Supports **Anthropic Claude**, **OpenAI GPT / o-series**, **MiniMax**, and any **OpenAI-compatible API** (DeepSeek, Qwen, Groq, …).

```
  ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗
  ██╔════╝ ██║   ██║██╔══██╗████╗  ██║██╔════╝
  ██║  ███╗██║   ██║███████║██╔██╗ ██║██║  ███╗
  ██║   ██║██║   ██║██╔══██║██║╚██╗██║██║   ██║
  ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝
   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝
               CODE  ✦
```

---

## Requirements

| Dependency | Version | How to install |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org or `brew install node` |
| npm | ≥ 8 | bundled with Node |
| TypeScript | ≥ 5 | installed automatically |

---

## Changelog

### v1.1.0 (2026-04-02)

- Security & permissions: unified tool permission gate; `--auto` is now safe-by-default (denies unsafe tools unless rules allow)
- Filesystem: blocks workspace escape + UNC paths; safer path matching for permission rules
- Web: WebFetch URL validation + SSRF guards (blocks loopback/private/link-local by default)
- Secrets: memory injection secret scanning; tool input/history redaction for sensitive fields
- Keys (Windows): `/keys` stores provider keys via DPAPI encryption and auto-migrates old plaintext keys
- Context efficiency: Anthropic prompt caching; token budget nudging; auto conversation compaction
- Models: expanded Anthropic/OpenAI/openai-compatible model list

### v1.0.0

- Initial release: terminal REPL, tools (Read/Edit/Write/LS/Grep/Glob/Bash/WebFetch), sessions, hooks, MCP integration

---

## Quick Start (run from source)

```bash
# 1. Clone / copy the project to your machine
git clone <repo-url> guang-code
cd guang-code

# 2. Install dependencies
npm install

# 3. Build
npm run build         # → compiles src/ → dist/

# 4. Set at least one API key
export ANTHROPIC_API_KEY=sk-ant-...     # Anthropic Claude
# or
export OPENAI_API_KEY=sk-...            # OpenAI GPT / o-series
# or
export MINIMAX_API_KEY=eyJ...           # MiniMax

# 5. Run
node dist/main.js
```

### Windows notes

- If PowerShell blocks `npm` scripts (`npm.ps1`), use `npm.cmd` (or change execution policy).
- `npm run build` uses `bash build.sh`. On Windows, run it in **WSL** or **Git Bash**.
- If you only need a TypeScript check on Windows:

```powershell
npx.cmd tsc -p tsconfig.json --noEmit
```

---

## Install Globally (so you can type `guang` anywhere)

```bash
# Inside the project directory:
# Recommended (build + link):
npm run install-global

# Or manually:
# npm run build           # compile first
# npm link                # creates a global symlink

# Now you can run from any directory:
guang
gc                      # short alias
```

To uninstall:
```bash
npm unlink guang-code
```

> **macOS tip:** if `npm link` fails with permission errors, use a Node version manager like
> [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) so npm's global bin is in your home directory.

---

## API Key Setup

Keys can be set in three ways (highest priority first):

### 1. Environment variables (for the current shell session)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export MINIMAX_API_KEY=eyJ...
export GC_API_KEY=...          # generic key for openai-compatible providers
export GC_BASE_URL=https://api.deepseek.com/v1   # base URL for openai-compatible
```

Add these to `~/.zshrc` or `~/.bashrc` to make them permanent.

### 2. Inside the REPL with `/keys`

```
/keys anthropic sk-ant-...
/keys openai sk-...
/keys minimax eyJ...
/keys openai-compatible <key>
```

Keys are saved to `~/.guang-code/config.json` (Windows uses DPAPI-encrypted storage when set via `/keys`).

### 3. CLI flag (one-shot override)

```bash
guang --api-key sk-ant-... "explain this code"
```

---

## Supported Models

| Model ID | Provider | Context | Notes |
|---|---|---|---|
| `claude-sonnet-4-6` | anthropic | 200K | Latest Sonnet |
| `claude-opus-4-6` | anthropic | 200K | Latest Opus |
| `claude-haiku-4-5-20251001` | anthropic | 200K | Latest Haiku |
| `claude-3-7-sonnet-20250219` | anthropic | 200K | Claude 3.7 Sonnet |
| `claude-3-5-sonnet-20241022` | anthropic | 200K | Stable Sonnet |
| `claude-3-5-haiku-20241022` | anthropic | 200K | Cheapest Claude |
| `claude-3-opus-20240229` | anthropic | 200K | Claude 3 Opus |
| `gpt-4.1` | openai | 128K | GPT-4.1 |
| `gpt-4.1-mini` | openai | 128K | GPT-4.1 Mini |
| `gpt-4o` | openai | 128K | Flagship GPT |
| `gpt-4o-mini` | openai | 128K | Cheapest GPT |
| `o1` | openai | 200K | Reasoning |
| `o1-mini` | openai | 200K | Fast reasoning |
| `o3` | openai | 200K | Deep reasoning |
| `o4-mini` | openai | 200K | Fast reasoning |
| `MiniMax-Text-01` | minimax | 1M | 1M context window |
| `abab6.5s-chat` | minimax | 245K | |
| `deepseek-chat` | openai-compatible | 64K | Needs `GC_BASE_URL` |
| `deepseek-reasoner` | openai-compatible | 64K | DeepSeek-R1 |
| `qwen-plus` | openai-compatible | 128K | Needs `GC_BASE_URL` |
| `qwen-max` | openai-compatible | 128K | Needs `GC_BASE_URL` |
| `glm-4` | openai-compatible | 128K | Needs `GC_BASE_URL` |

Switch models at any time with:
```
/model gpt-4o
/model MiniMax-Text-01
/model deepseek-chat
```

List all models with:
```
/providers
```

Or at startup:
```bash
guang -m gpt-4o
guang -m abab6.5s-chat
```

---

## OpenAI-Compatible Providers (DeepSeek, Qwen, Groq, etc.)

Any provider with an OpenAI-compatible API works:

```bash
# DeepSeek
export GC_API_KEY=<deepseek-key>
export GC_BASE_URL=https://api.deepseek.com/v1
guang -m deepseek-chat

# Qwen (DashScope)
export GC_API_KEY=<dashscope-key>
export GC_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
guang -m qwen-max

# Groq
export GC_API_KEY=<groq-key>
export GC_BASE_URL=https://api.groq.com/openai/v1
guang -m llama-3.1-70b-versatile
```

Or save in the REPL:
```
/keys openai-compatible <your-key>
```

Then set `GC_BASE_URL` in your shell for the right endpoint.

---

## Usage

```bash
guang                              # start interactive REPL
gc                                 # start interactive REPL (short alias)
guang "explain this codebase"      # send initial prompt
guang -m gpt-4o                    # use a specific model
guang --auto                       # auto-approve all tool calls
guang --plan                       # read-only plan mode
guang -r <sessionId>               # resume a previous session
guang --cwd /path/to/project       # set working directory
```

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Show all commands and keyboard shortcuts |
| `/providers` | List all supported models and check which API keys are set |
| `/keys <provider> <key>` | Save an API key (e.g. `/keys anthropic sk-ant-...`) |
| `/model [name]` | Show model list or switch model |
| `/mode default\|auto\|plan` | Switch permission mode |
| `/style [name]` | Switch output style (`default` / `explanatory` / `learning`) |
| `/permissions ...` | Manage fine-grained permission rules |
| `/cost` | Show token usage and estimated cost |
| `/compact` | Compress conversation history |
| `/sessions` | List recent saved sessions |
| `/commit` | Create a git commit with AI-generated message |
| `/tasks` | List background sub-agent tasks |
| `/task-cancel <id\|name>` | Cancel a running background task |
| `/task-retry <id\|name>` | Retry a completed/failed task |
| `/send <id\|name> <msg>` | Send a follow-up message to a running task |
| `/clear` | Clear conversation history |
| `/exit` | Exit Guang Code |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Send message |
| `Ctrl+C` | Cancel current request |
| `Ctrl+D` | Exit |
| `↑` / `↓` | Browse input history |

---

## Permission Modes

| Mode | Behavior |
|---|---|
| `default` | Asks for confirmation before bash commands and file writes |
| `auto` | Executes all tools without asking (fastest, use with care) |
| `plan` | Read-only — shows a plan, executes nothing until you approve |

---

## Fine-Grained Permissions (rules)

In addition to the global modes above, Guang Code supports rule-based decisions: `allow` / `deny` / `ask`.

- Global rules: `~/.guang-code/config.json` → `permissionRules`
- Project rules: `<project>/.guang/permissions.json` (higher priority than global)

Examples:

```text
/permissions add allow Read
/permissions add deny Write path=**/.env
/permissions add ask Bash command=*npm*
```

Project rule file format (`.guang/permissions.json`) is a JSON array:

```json
[
  { "effect": "deny", "tool": "Write", "path": "**/.env" },
  { "effect": "ask", "tool": "Bash", "command": "*git push*" },
  { "effect": "allow", "tool": "Read" }
]
```

---

## Output Style

Output style affects the assistant behavior by injecting an extra system prompt segment.

```text
/style                # show current + available
/style explanatory     # adds brief implementation insights
/style learning        # asks for user choices on meaningful decisions
```

---

## Available Tools

| Tool | Description |
|---|---|
| `Task` | Launch a background sub-agent for focused research |
| `SendMessage` | Send a follow-up message to a running background task |
| `Read` | Read a file with line numbers |
| `Write` | Create or overwrite a file |
| `Edit` | Precise string-replacement editing |
| `Bash` | Execute shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `LS` | List directory contents |
| `WebFetch` | Fetch a URL and return its content |

MCP tools are loaded dynamically from `.guang/mcp.json` and appear as additional tools at runtime.

---

## Session Persistence

Sessions are automatically saved to `~/.guang-code/sessions/`.  
Resume a previous session with:

```bash
guang -r <session-id>   # first 8 chars of the ID shown in /sessions
```

---

## Project Structure

```
src/
  main.tsx                   # CLI entry point (Commander.js)
  types/index.ts             # All TypeScript types
  providers/
    AnthropicProvider.ts     # Anthropic Claude (native streaming)
    OpenAIProvider.ts        # OpenAI + any OpenAI-compatible API
    MiniMaxProvider.ts       # MiniMax (fetch-based SSE streaming)
    index.ts                 # Provider registry + createProvider()
  utils/
    QueryEngine.ts           # Core LLM loop (provider-agnostic)
    config.ts                # Config file manager (~/.guang-code/config.json)
    claudeMd.ts              # CLAUDE.md / rules loader (hierarchy + @include)
    projectInstructions.ts   # Instruction injection wrapper
    permissions.ts           # Fine-grained permission rules engine
    outputStyle.ts           # Output style prompt injection
    sessionStorage.ts        # Session persistence
  tools/
    BashTool.ts              # Shell execution + safety checks
    FileReadTool.ts          # File reading
    FileWriteTool.ts         # File creation/overwrite
    FileEditTool.ts          # Precise string-replacement editing
    GlobTool.ts              # File pattern matching
    GrepTool.ts              # Content search
    ListDirTool.ts           # Directory listing
    WebFetchTool.ts          # URL fetching
    AgentTool.ts             # Background agent runner
    SendMessageTool.ts       # Messaging a running agent
    index.ts                 # Tool registry
  components/
    App.tsx                  # Main REPL (React/Ink)
    Message.tsx              # Message renderer
    Spinner.tsx              # Loading animation
    StatusBar.tsx            # Bottom status bar
    PermissionRequest.tsx    # Y/N permission dialog
  commands/
    slashCommands.ts         # /help /keys /providers /model etc.
```

---

## Config File

`~/.guang-code/config.json` stores your preferences:

```json
{
  "version": 1,
  "defaultModel": "claude-3-5-sonnet-20241022",
  "defaultMode": "default",
  "outputStyle": "default",
  "providers": {
    "anthropic":  { "apiKey": "sk-ant-..." },
    "openai":     { "apiKey": "sk-..." },
    "minimax":    { "apiKey": "eyJ..." },
    "openai-compatible": { "apiKey": "...", "baseUrl": "https://api.deepseek.com/v1" }
  },
  "permissionRules": [
    { "effect": "deny", "tool": "Write", "path": "**/.env" }
  ]
}
```

You can edit this file directly or use `/keys` and `/model` in the REPL.

---

## Project-Level Settings (`.guang/`)

Guang Code reads optional per-project settings from a `.guang/` folder in your repo:

- `.guang/mcp.json` — MCP servers configuration (stdio-based)
- `.guang/hooks.json` — session/tool lifecycle hooks
- `.guang/commands/*.md` — custom reusable `/xxx` commands (markdown templates)
- `.guang/permissions.json` — fine-grained permission rules (JSON array)

---

## License

MIT
