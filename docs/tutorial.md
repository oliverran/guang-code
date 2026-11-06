# 五分钟工具实验室

先体验一次真实的“读代码 → 复现问题 → 检查权限 → 修改 → 验证”，再决定是否接入模型。

这个终端教程不需要 API key。它使用固定的工具调用和补丁，不生成 AI 回复，也不测试模型的推理能力。文件读取、搜索、权限拒绝、文件修改和测试结果都由本仓库的实际代码运行，不是预录输出。

## 开始

在仓库根目录，使用 Node.js 22.12 或更新版本：

```bash
npm ci --workspaces=false
npm run tutorial
```

按提示逐步按 Enter；最后输入 `y` 才会修改临时样例。直接按 Enter 或输入 `n` 会拒绝修改。在任一提示输入 `q` 可退出。

如果你只想看完整输出，或在 CI / 无终端环境运行：

```bash
npm run tutorial -- --auto
```

`--auto` 明确使用脚本答案，**包含最后的修改批准**。它仍会真实运行工具与测试，但不代表用户现场批准了一次真实项目操作。

```bash
npm run tutorial -- --help
npm run test:tutorial
```

帮助命令不创建练习目录，也不加载工具依赖。教程不接受 `--cwd`，不能将现有项目当作练习目标。

## 你会看到什么

样例是一个购物车金额计算函数，金额单位为整数分。输入约定为非负整数的单价和数量，输入校验、税费与折扣不在这个练习范围内。

1. **读代码**：真实 `Glob` 列出两个 JavaScript 文件，`Grep` 找到 `totalCents`，`Read` 展示源代码和测试。
2. **复现问题**：固定的 `node --test` 调用得到 **2 个通过、2 个失败**。两个商品的正确金额是 `1250 × 2 + 350 × 3 = 3550`，原函数只得到 `1600`。失败是刻意保留的教学起点。
3. **先计划**：展示补丁，使用真实 `Edit` 的 Plan 模式尝试执行。工具应拒绝，教程还会核对文件未变化。
4. **检查审批**：真实 `ToolPipeline.addPermissionGate()` 先接收一次脚本提供的拒绝。教程验证执行器没有被调用，然后询问你是否批准刚才展示的修改。只有 `y` 才会进入 `Edit`。
5. **验证修复**：批准后重新运行相同测试，得到 **4 个通过、0 个失败**；核对文件仅发生展示的那一处替换。

成功结束时会出现：

```text
PASS: red tests → Plan blocked → permission denied → approved Edit → 4 green tests.
Temporary exercise removed. Your source example was not changed.
```

耗时、临时路径和 Node 测试输出的细节可能随平台与版本变化。上述通过数和失败数是教程会实际检查的结果。

## 隔离与边界

- 每次运行都把 [`examples/cart-total`](../examples/cart-total/) 复制到新的系统临时目录。仓库内样例保留原始错误，可反复练习。
- 子进程使用独立 `HOME` / `USERPROFILE` 和环境变量白名单，不继承 API key、模型地址、代理、`NODE_OPTIONS` 或用户配置。不加载 `QueryEngine`、模型供应商、Skills 或插件。
- 不启动 Web 服务、不请求外网、不运行 `BashTool` 或任意 shell 命令。搜索走没有外部 ripgrep 的 JavaScript 回退；测试只通过固定参数调用当前 Node 可执行文件。
- 正常完成、拒绝、`q`、输入关闭，以及可处理的 `Ctrl+C` / `SIGTERM` 都会清理临时副本。操作系统强制终止或断电可能留下 `guang-tutorial-*` 临时目录，可在确认没有教程运行后自行删除。
- **这是限定样例和执行路径的练习，不是操作系统沙箱。** Plan 模式、权限 gate 和路径检查不能据此被视为所有运行入口的完整安全保证。教程只验证所展示的 `Edit` 路径，终端 / Web 的完整权限行为仍以各自实现为准。
- 教程不会展示或验证模型调用、会话恢复、网络工具、真实 shell、Electron 或部署能力。

## 用真实模型做同一道题

这部分是可选的，**不属于离线教程**。接入模型后，代码、对话和工具输出可能发送给你的服务商，并按其规则计费。先确认数据规则，并在终端使用环境变量配置 API key；不要把 key 写进样例或提交到 Git。

### 1. 复制一份独立练习

在仓库根目录执行以下 Node 命令。它在仓库旁创建 `guang-practice`；如果该目录已经存在，会直接失败，不会覆盖你的已有练习。命令适用于 Bash 和 PowerShell：

```bash
node --input-type=module -e "import fs from 'node:fs/promises'; await fs.mkdir('../guang-practice'); await fs.cp('examples/cart-total', '../guang-practice', {recursive: true});"
node --test ../guang-practice/cart.test.js
```

第二条命令预期以非零退出码结束，显示 2 个失败。它不是安装失败。

### 2. 让模型先阅读

按[模型配置说明](usage.md#模型与-api-key)设置好服务商环境变量，选择账户可用的模型，再运行：

```bash
npm start -- --plan --model claude-sonnet-4-6 --cwd ../guang-practice
```

模型名只是仓库中的一个示例，不保证你的账户可用。可以输入：

```text
阅读 cart.js 和 cart.test.js，解释 totalCents 的问题和测试预期。
先给出最小修复方案，不要修改文件，不要运行命令，不要访问网络。
```

### 3. 检查方案后再修改

确认建议只针对数量计算后，用 `/mode default` 切回常规模式，再明确要求仅修改 `cart.js` 并检查工具请求。不要笼统批准未知命令。你也可以自己编辑文件，再在另一个终端手动运行：

```bash
node --test ../guang-practice/cart.test.js
```

修复后应该 4 个测试全部通过。真实模型的表述与调用顺序可能不同，也可能给出错误方案；离线教程通过不代表模型输出一定正确。

## 实现位置

- [`scripts/tutorial.mjs`](../scripts/tutorial.mjs)：参数检查、临时副本、环境隔离、退出清理。
- [`scripts/tutorial-worker.mjs`](../scripts/tutorial-worker.mjs)：五个步骤与实际工具调用。
- [`examples/cart-total`](../examples/cart-total/)：独立、无依赖的原始练习。
- [`tests/tutorial.test.mjs`](../tests/tutorial.test.mjs)：自动 / 交互、拒绝、重复运行、退出、环境隔离与副本保护回归测试。

这组回归测试也包含在 `npm run test:smoke` 和已有的 Node.js CI 矩阵中。它不替代浏览器或真实服务商测试。
