# Serial Pilot 项目目录结构审查

## 📁 项目目录结构总览

```
Serial Pilot/
├── packages/                    # 核心产品代码（Monorepo 工作区）
├── _KeilProject/               # 嵌入式硬件测试项目
├── _Reference/                 # 参考项目库
├── tests/                      # 测试代码
├── .windsurf/                  # Windsurf IDE 配置
├── node_modules/               # 依赖
├── package.json                # 根项目配置
├── Plan.md                     # 执行计划文档
├── spec.md                     # 技术规格文档
└── README.md                   # 项目说明
```

---

## 🎯 核心产品：`packages/` （最重要）

这是**核心产品代码**，采用 Monorepo 架构，包含 2 个独立包：

### 1. serialpilot-mcp — MCP Server

| 文件 | 作用 |
|------|------|
| `src/index.ts` | MCP Server 入口，提供 8 个 AI 工具（list_serial_ports, connect_serial, wait_for_output 等） |

**职责**：作为协议转换层，让 AI（如 Windsurf/Cursor）通过 MCP 协议调用串口功能。

### 2. serialpilot-vscode — VS Code 扩展

| 文件 | 作用 |
|------|------|
| `src/extension.ts` | 扩展入口，管理串口连接、Webview UI |
| `src/bridge-server.ts` | 内嵌 HTTP Server，暴露 REST API 供 MCP Server 调用 |
| `src/types.ts` | 类型定义 |
| `media/` | 图标等资源 |
| `*.vsix` | 已打包的扩展安装包（当前版本 1.0.1） |

**职责**：独占串口连接，提供 Webview 可视化界面，内嵌 Bridge Server 让 MCP Server 通过 HTTP 调用。

---

## 🔧 硬件测试：`_KeilProject/`

```
_KeilProject/
└── freertos_hello/             # STM32F411 FreeRTOS 测试项目
    ├── Core/                   # 用户代码
    ├── Drivers/                # STM32 HAL 驱动
    ├── Middlewares/            # FreeRTOS 内核
    └── MDK-ARM/                # Keil 工程文件
```

**职责**：提供一个**真实的嵌入式设备**用于端到端测试。可以烧录固件到 STM32 开发板，然后让 AI 通过串口读取日志、分析问题。

---

## 📚 参考项目：`_Reference/`

包含 **10 个参考项目**，用于学习借鉴：

| 项目 | 参考价值 |
|------|---------|
| `COMTool/` | 串口调试工具 — 串口通信、插件化架构 |
| `mcp/` (AWS) | MCP Server 标准实现范式 |
| `continue/` | AI 编码助手 — MCP Client 实践、分层架构 |
| `vscode-extension-samples/` | 微软官方 VS Code 扩展示例 |
| `vscode-restclient/` | 成熟扩展的完整工程实践 |
| `vscode-generator-code/` | 扩展脚手架生成器 |
| `vscode-webview-ui-toolkit/` | Webview UI 组件库 |
| `vsc-serialport-helper/` | 串口辅助工具 |
| `awesome-mcp-servers/` | MCP Server 资源收集 |
| `servers/` | 其他 MCP Server 示例 |

---

## 🧪 测试代码：`tests/`

| 文件 | 作用 |
|------|------|
| `bridge-api.test.ts` | Bridge Server API 单元测试 |
| `mcp-tool.test.ts` | MCP Tool 测试 |
| `test-bridge-real-hw.ts` | 真实硬件 E2E 测试 |
| `test-bridge-standalone.ts` | 独立桥接测试 |
| `mocks/` | Mock 对象 |

---

## 📋 项目状态总结

根据 Plan.md，项目进度：

| Sprint | 状态 | 完成度 |
|--------|------|--------|
| Sprint 0: 工程准备 | ✅ 完成 | 100% |
| Sprint 1: Bridge + MCP | ✅ 完成 | 100% |
| Sprint 2: Wait + 闭环 | ✅ 完成 | 100% |
| Sprint 3: AI Rules | ✅ 基本完成 | 83% (S3.06 Cursor 适配待做) |
| Sprint 4: 产品化 | ⏳ 待开始 | 0% |

**当前版本**: v1.0.1

---

## 🎯 三个核心项目总结

| 项目 | 位置 | 核心职责 |
|------|------|---------|
| **serialpilot-vscode** | `packages/serialpilot-vscode/` | VS Code 扩展，管理串口连接、Webview UI、Bridge Server |
| **serialpilot-mcp** | `packages/serialpilot-mcp/` | MCP Server，让 AI 通过 MCP 协议调用串口功能 |
| **freertos_hello** | `_KeilProject/freertos_hello/` | STM32 测试固件，用于 E2E 硬件测试 |
