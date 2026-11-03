# 架构导览

[返回 README](../README.md)

主应用在 `dist/` 中以 JavaScript 运行，桌面界面在 `ide/` 中以 TypeScript / React 开发。下面是阅读当前实现的入口，不是独立 SDK 发布或跨客户端兼容性承诺。

## 从入口到模型请求

1. [`dist/main.js`](../dist/main.js) 解析模型、工作目录、权限模式和会话恢复参数，启动 Ink 终端 UI。
2. [`App.js`](../dist/components/App.js) 处理交互和会话状态。
3. [`QueryEngine.js`](../dist/utils/QueryEngine.js) 组织上下文、模型调用和工具循环。
4. [`providers/index.js`](../dist/providers/index.js) 按模型名选择 Anthropic、OpenAI、MiniMax 或兼容接口。
5. [`tools/index.js`](../dist/tools/index.js) 注册读取、编辑、搜索、Shell 等工具。

## 按能力查找代码

| 能力 | 入口 | 阅读重点 |
|---|---|---|
| 配置与 key | [`config.js`](../dist/utils/config.js)、[`secureStore.js`](../dist/utils/secureStore.js) | 配置加载、环境变量优先级、平台差异 |
| 工具权限 | [`permissions.js`](../dist/utils/permissions.js)、[`toolPipeline.js`](../dist/utils/toolPipeline.js) | 模式、规则、审批与执行前后处理 |
| 会话 | [`sessionStorage.js`](../dist/utils/sessionStorage.js)、[`sessionES.js`](../dist/utils/sessionES.js) | 会话保存与恢复、事件日志、投影和归档 |
| 上下文压缩 | [`compaction.js`](../dist/utils/compaction.js) | 策略注册与压缩结果 |
| 项目上下文 | [`projectInstructions.js`](../dist/utils/projectInstructions.js)、[`skillLoader.js`](../dist/utils/skillLoader.js) | 项目指令、Skills 的作用域与加载 |
| 记忆 | [`memoryRegistry.js`](../dist/utils/memoryRegistry.js)、[`storage/`](../dist/utils/storage/) | 记忆组织、存储后端及回退 |
| 插件 | [`pluginManager.js`](../dist/utils/pluginManager.js) | 提案、审批、激活、文件访问策略 |
| MCP 客户端 | [`mcpClient.js`](../dist/utils/mcpClient.js)、[`McpTool.js`](../dist/tools/McpTool.js) | 外部 MCP 工具连接与调用 |
| 服务接口 | [`sdkInterop.js`](../dist/utils/sdkInterop.js) | JSON-RPC、MCP 方法适配和 ACP 风格的发布订阅 |
| Web UI | [`webServer.js`](../dist/utils/webServer.js)、[`ui/index.html`](../dist/ui/index.html) | HTTP 路由、SSE 对话与单页界面 |
| 桌面界面 | [`ide/src/`](../ide/src/) | Electron main / preload / renderer 三层结构 |

## Web 与桌面复用

[`scripts/start-ui.mjs`](../scripts/start-ui.mjs) 启动 HTTP 服务，默认绑定 `127.0.0.1`。浏览器页面调用 `/api/ui/*` 与 `/sdk/v1`；聊天通过 SSE 接收事件。

桌面 [`BackendManager`](../ide/src/main/backend.ts) 启动同一脚本，[IPC 层](../ide/src/main/ipc.ts)把后端事件转发给渲染界面。桌面的文件操作和终端管理也有独立主进程实现，因此不能把 Web、终端和桌面的权限行为视为完全相同。

`sdkInterop.js` 是仓库内模块；根 `package.json` 没有将它作为 `@guang-code/sdk` 发布或导出。对外接入前应逐项测试所需方法和传输，不要把方法名称相似视为完整协议一致性认证。

## 扩展前先确认边界

- 工具管线中有超时、审批、输出处理等机制，具体效果取决于调用路径与配置。
- 插件执行包含无法加载 VM 时的动态执行回退；只加载可信插件。文件白名单和进程内 VM 不能替代系统隔离。
- HTTP 服务没有内置账户鉴权。开发和调试时保留本机绑定。
- 脱敏基于模式匹配，不能保证识别所有秘密；提交日志前仍需人工检查。

## 参考代码树

[`deepseek-harness/`](../deepseek-harness/) 是单独的参考实现，包含它自己的包、文档和测试。它不是根 `package.json` 的 npm workspace，终端 / Web 的快速开始不需要先构建它。该目录中的测试或覆盖率结果也不能自动当作 Guang Code 主应用的验证结果。
