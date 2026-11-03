# 使用指南

[返回 README](../README.md)

## 模型与 API key

模型路由由 [`inferProvider()`](../dist/utils/config.js) 与 [`createProvider()`](../dist/providers/index.js) 决定。启动时用 `--model` 显式指定模型，避免依赖配置中可能过时的默认值。

| 模型名规则 | 供应商 | API key 环境变量 | 自定义地址 |
|---|---|---|---|
| `claude*` | Anthropic | `ANTHROPIC_API_KEY` | 当前工厂未提供环境变量覆盖 |
| `gpt*`、`o1*`、`o3*`、`o4*` | OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| `minimax*`、`abab*` | MiniMax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| 其他名称 | OpenAI-compatible | `GC_API_KEY`，或回退到 `OPENAI_API_KEY` | `GC_BASE_URL`，或回退到 `OPENAI_BASE_URL` |

名称匹配不区分大小写。自定义兼容接口也遵循这张路由表：例如以 `gpt` 开头的模型应配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。兼容性取决于服务商实际提供的接口、模型和工具调用能力，不是对任意服务的保证。

### Bash：在当前 shell 中设置 key

下面的输入不会显示在终端中：

```bash
read -rs -p "Anthropic API key: " ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY
printf '\n'
npm start -- --plan --model claude-sonnet-4-6 --cwd /path/to/your-project
```

使用其他供应商时，替换变量名和模型名。不要把真实 key 写进仓库文件、截图或提交记录。

### PowerShell：在当前会话中设置 key

```powershell
$secret = Read-Host "Anthropic API key" -AsSecureString
$env:ANTHROPIC_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
Remove-Variable secret
npm start -- --plan --model claude-sonnet-4-6 --cwd "C:\path\to\your-project"
```

环境变量在子进程中仍是明文，不等同于加密存储。使用完后可用 `Remove-Item Env:ANTHROPIC_API_KEY` 清除当前 PowerShell 中的变量，Bash 中使用 `unset ANTHROPIC_API_KEY`。

### 可选：保存常用配置

配置位置是 `~/.guang-code/config.json`。修改现有配置时保留原有字段。例如，下面仅展示兼容服务的非秘密设置：

```json
{
  "defaultModel": "your-model-id",
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://your-provider.example/v1"
    }
  }
}
```

字段是 `baseUrl`，不是 `baseURL`。API key 仍可从环境变量读取。`/keys <provider> <key>` 会将 key 保存到配置，不作为推荐的首次配置方式。Windows 的存储实现使用 DPAPI，其他平台使用明文，见 [`secureStore.js`](../dist/utils/secureStore.js)。

## 终端入口

从仓库根目录运行，替换示例中的模型名和项目路径：

```bash
# 查看参数，不发起模型请求
npm start -- --help

# 给出初始任务，并保留交互会话
npm start -- --plan --model YOUR_MODEL_ID --cwd /path/to/project "说明项目结构，不修改文件"

# 恢复最近的第一个会话（也支持 session ID 或前缀）
npm start -- --resume 1
```

恢复会话会使用已保存的模型和工作目录。初始 prompt 不是非交互批处理模式，程序仍进入终端 UI。

如果当前不在 guang-code 根目录，可直接使用入口文件的绝对路径：

```bash
node /path/to/guang-code/dist/main.js --model YOUR_MODEL_ID --cwd /path/to/project
```

目前根包没有 `bin` 或 `main` 字段，也没有根 `index.js`。`npm link` 不会注册可用的 `gc` / `guang` 命令，`node .` 也不是有效入口。

### 常用会话命令

| 命令 | 用途 |
|---|---|
| `/help` | 查看当前实现的命令 |
| `/model` | 查看模型列表或切换模型 |
| `/providers` | 查看供应商与 key 配置状态 |
| `/mode plan` | 进入计划模式 |
| `/mode default` | 回到常规审批模式 |
| `/sessions` | 查看最近会话 |
| `/session new` | 新建会话 |
| `/skills` | 查看可用 Skills |

完整实现见 [`slashCommands.js`](../dist/commands/slashCommands.js)。已有权限规则可能改变默认审批结果；使用前检查项目和全局配置。

## 常见问题

### 安装提示 `EBADENGINE` 或 Node 版本不支持

运行 `node --version`，使用 Node 22.12 或更新版本。当前锁定依赖的要求高于根包仍声明的 Node 18。

### 找不到模块

在 guang-code 根目录执行 `npm ci --workspaces=false`。`dist/` 已提交不等于无需依赖。锁文件的下载地址使用 npm 镜像，安装需要能访问对应地址。

### `No API key found` 或模型不可用

核对模型路由表、环境变量名称和服务商账户权限。更换了 shell 后，需要重新设置环境变量；模型列表不是服务商授权列表。

### 终端提示 raw mode 不可用

Ink UI 需要交互终端。使用普通终端直接启动，不要把交互会话接入不支持 TTY 的管道。

### Web UI 已打开，但不能执行与终端相同的操作

当前 Web 后端在权限回调中会拒绝部分高风险工具请求，并不是终端审批 UI 的完整替代。需要在其他项目里进行完整编码工作时，优先用终端入口及 `--cwd`。

### 端口冲突

使用 `npm run ui -- --port=8080 --no-open`，或在自己启动服务的终端按 `Ctrl+C`。IDE 的开发前端默认使用 5173，后端默认使用 5174，不要同时启动占用这些端口的 Web 实例。
