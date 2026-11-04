# Guang Code

**在自己的代码仓库里，用你选择的模型读代码、定位问题、完成修改。**

A multi-provider AI coding assistant with a terminal UI, a local web interface, and an experimental Electron IDE.

[快速开始](#快速开始) · [模型与使用指南](docs/usage.md) · [架构导览](docs/architecture.md) · [桌面 IDE](ide/README.md)

## 适合做什么

- **读懂项目**：搜索文件、追踪调用关系，让模型结合当前仓库解释代码。
- **逐步修改**：先在 Plan 模式讨论方案，再按需执行编辑、命令和测试；检查工具请求与最终 diff。
- **选择模型**：接入 Anthropic、OpenAI、MiniMax，或配置 OpenAI-compatible 服务，不绑定单一模型供应商。
- **保留工作上下文**：恢复会话，使用项目指令、Skills 和记忆模块组织长期工作。
- **研究 agent 工作流**：查看工具审批、会话事件、上下文压缩与 MCP 接入的实现，按需扩展。

当前以**克隆仓库后运行**为主。终端是主要入口，Web UI 便于本机查看和交互，Electron IDE 仍是实验性子项目。模型调用需要自己的 API key，费用由对应服务商收取。

## 快速开始

### 1. 安装终端 / Web 依赖

准备 Git、**Node.js 22.12 或更新版本**及随附的 npm。建议使用仍在支持期内的 Node.js LTS 版本；根 `package.json` 和 CI 均以 22.12.0 为最低版本。

```bash
git clone https://github.com/oliverran/guang-code.git
cd guang-code
npm ci --workspaces=false
npm start -- --help
```

`--workspaces=false` 跳过可选的 Electron workspace。终端和 Web 的代码已在 `dist/` 中，无需前端构建，但仍需要安装 npm 依赖。

### 2. 配置模型，打开你的项目

以 Anthropic 为例，先在当前终端设置 `ANTHROPIC_API_KEY` 环境变量，再运行：

```bash
npm start -- --plan --model claude-sonnet-4-6 --cwd /path/to/your-project
```

将 `/path/to/your-project` 换成自己的项目路径，将模型名换成账户实际可用的模型。示例模型名来自仓库注册表，不代表服务商一定为你的账户开放。

其他供应商使用 `OPENAI_API_KEY`、`MINIMAX_API_KEY` 或 `GC_API_KEY`；自定义兼容接口另设 `GC_BASE_URL`。参见[环境变量与模型路由](docs/usage.md#模型与-api-key)，包含 Bash 和 PowerShell 示例。

### 3. 从一个小任务开始

在终端会话里输入：

```text
先阅读这个项目，说明入口、主要模块和测试命令。不要修改文件。
```

也可以试试：

- “定位这个报错的调用链，列出你需要验证的假设，先不要修改代码。”
- “为这个函数设计边界测试，先给出测试计划。”
- “解释最近的 git diff，指出可能遗漏的兼容性问题。”

使用 `/help` 查看命令，`/model` 切换模型，`/sessions` 查看会话。Plan 模式会阻止文件写入、编辑及部分其他操作；准备执行时，用 `/mode default` 切回常规模式并逐项检查工具请求。它不是操作系统级隔离，建议从干净的 Git 工作区开始。

## 本地 Web UI

完成上面的依赖安装和 API 环境变量配置后，在仓库根目录运行：

```bash
npm run ui -- --no-open
```

打开终端输出的地址，默认是 `http://127.0.0.1:5173`。界面包含 Chat、Sessions、Skills、Plugins 和 SDK 页面。选择与 API key 匹配的模型后再发送消息。

- 改端口：`npm run ui -- --port=8080 --no-open`
- 操作自己的项目：`npm run ui -- --cwd "/path/to/your project" --no-open`
- 查看启动参数：`npm run ui -- --help`（不会启动服务）
- 停止服务：在启动它的终端按 `Ctrl+C`
- 未指定 `--cwd` 时，工作目录仍是 **guang-code 仓库本身**。启动时检查输出中的 `Project` 路径；路径不存在或不是目录时会直接报错。
- Web 的工具审批行为与终端不同，不能假设终端中的操作都能在 Web 中完成。

**请保持本机访问。** 当前 HTTP 服务没有内置登录鉴权，不要将 `--public` 或 `--host=0.0.0.0` 当作可直接对外部署的方案。

## 桌面 IDE（实验性）

`ide/` 提供 Electron 界面，集成文件树、Monaco 编辑器、聊天面板和终端面板。它复用同一个后端，不需要单独配置另一套模型服务。

```bash
# 在仓库根目录，安装包含 IDE 的完整依赖
npm ci
npm run ide
```

目前终端面板使用 macOS 的 `/usr/bin/script` 调用方式。Windows / Linux 的桌面功能与安装包需要进一步验证，不能仅凭打包配置推断支持情况。详见 [IDE 开发说明](ide/README.md)。

## 自动化检查

安装终端 / Web 依赖后，可以在本地运行：

```bash
npm run test:smoke
```

GitHub Actions 会在 Pull Request 和推送到 `main` 时检查 JavaScript 语法，并在 Node.js **22.12.0、22.x、24.x、26.x** 上运行这组测试。每个任务使用 `npm ci --workspaces=false` 从锁文件安装依赖，跳过可选的 Electron workspace。

测试覆盖文件搜索、未安装 ripgrep 时的 Grep 回退、PM 通配符导入、终端 `--help`、Markdown / YAML 加载，以及本机 Web 页面和列表接口。Web 启动检查还覆盖项目目录选择、带空格的路径、参数错误、帮助输出和自动分配端口。启动测试使用临时目录和隔离环境，不需要 API key，也不会调用模型服务。

当前 CI 使用 Linux，不包含真实模型响应、浏览器交互或 Electron 构建测试；通过这组检查不代表这些路径已完成验证。

## 使用边界

- **代码与数据**：模型请求可能包含项目代码、工具输出和会话内容。使用前确认所选模型服务符合项目的数据要求。
- **API key**：优先使用环境变量。通过 `/keys` 保存时，Windows 使用 DPAPI，其他平台的配置文件按明文保存；不要提交密钥或含密钥的配置。
- **权限与插件**：审批、输出脱敏和路径检查能帮助控制风险，但不能保证阻止所有危险操作或秘密泄漏。仅运行可信插件，不要把插件执行环境当作强安全沙箱。
- **运行状态**：当前文档针对仓库代码。历史版本说明、CLI 显示版本与 `package.json` 版本尚未统一；不要据此推断某个已发布安装包的功能。

## 继续了解

- [使用指南](docs/usage.md)：模型配置、会话恢复、常见启动问题。
- [架构导览](docs/architecture.md)：从入口到工具执行，按真实文件定位实现。
- [IDE 开发说明](ide/README.md)：桌面开发、构建与已知限制。
- [历史变更记录](CHANGELOG.md)：保留已有开发记录；当前启动方式以上文为准。
- [Issues](https://github.com/oliverran/guang-code/issues)：反馈问题时附上操作系统、Node 版本、运行命令和脱敏后的报错。

## 致谢与许可

项目的终端交互和模块设计参考 Claude Code 与 DeepSeek Harness。仓库中的 [`deepseek-harness/`](deepseek-harness/) 是单独的参考代码树，不是运行终端 / Web UI 的必要步骤。

根目录目前没有 `LICENSE` 文件，因此这里不声明整个项目为 MIT。引用的第三方代码与依赖应遵循各自的许可；复用或分发前请确认相应授权。
