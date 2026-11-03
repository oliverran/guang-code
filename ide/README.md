# Guang Code IDE

**实验性的 Electron 桌面界面：在文件树、代码编辑器和 AI Chat 之间完成工作。**

[返回主项目](../README.md)

IDE 通过 npm workspace 与主项目放在同一仓库中，复用 `dist/` 后端和模型配置。界面使用 React、Monaco 和 xterm.js；文件操作、终端管理和聊天转发由 Electron 主进程处理。

## 开发启动

使用 **Node.js 22.12 或更新版本**及 npm。在仓库根目录运行：

```bash
npm ci
npm run ide
```

终端 / Web 的轻量安装命令 `npm ci --workspaces=false` 不安装完整 IDE 依赖。启动 IDE 前需要执行上面的完整安装，并按[主项目指南](../docs/usage.md#模型与-api-key)配置模型。

开发模式使用 Vite 前端（默认端口 5173）和共享后端（默认端口 5174）。如已启动独立 Web UI，请先停止占用端口的实例。`ide/dist/` 不随仓库提交，由构建脚本生成。

## 当前平台边界

- 终端面板目前通过 `/usr/bin/script` 和 macOS 风格的参数创建终端，不再依赖 `node-pty`。
- 终端尺寸更新目前只记录尺寸，没有完整的运行时 PTY resize 支持。
- 打包配置列出了 macOS、Windows 和 Linux 目标，但这不是所有平台都已验证可用的保证。
- 桌面仍需验证模型调用、工具审批和独立安装包完整性。需要直接在项目中使用编码助手时，优先从[主项目的终端入口](../README.md#快速开始)开始。

## 构建命令

在仓库根目录：

```bash
# 编译 Electron main / preload 和 React renderer
npm run ide:build

# 运行 electron-builder；不代表已验证或签名的发布包
npm run ide:package
```

打包配置位于 [`electron/builder.yml`](electron/builder.yml)，输出目录为 `ide/release/`。发布前需单独检查共享后端是否完整包含在产物中，以及签名、平台依赖和首次启动行为。

## 代码导览

| 目录 / 文件 | 职责 |
|---|---|
| [`src/main/index.ts`](src/main/index.ts) | Electron 入口 |
| [`src/main/backend.ts`](src/main/backend.ts) | 启动共享后端，跟踪就绪状态 |
| [`src/main/ipc.ts`](src/main/ipc.ts) | 文件操作和聊天事件桥接 |
| [`src/main/terminal.ts`](src/main/terminal.ts) | 终端子进程管理 |
| [`src/preload/index.ts`](src/preload/index.ts) | 向渲染进程暴露 `window.guang` 接口 |
| [`src/renderer/`](src/renderer/) | React 界面、编辑器、聊天与终端面板 |

Electron 窗口隔离设置不能代替后端工具审批，也不能据此推断主机文件已被隔离。使用可信项目和插件，保留 Git diff 检查与人工审核。

## 设计参考

- [Codex](https://github.com/openai/codex)：客户端与应用服务分离的设计。
- [Electron](https://www.electronjs.org/docs/latest/)：主进程、preload 与 renderer 的结构。
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) 和 [xterm.js](https://xtermjs.org/)：编辑器与终端界面。
