# Serial Pilot 技术规格说明书 (Technical Specification)

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.1.0 |
| 最后更新 | 2026-02-28 |
| 状态 | DRAFT |
| 作者 | Serial Pilot Team |
| 审核人 | — |

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [模块规格](#3-模块规格)
4. [接口定义](#4-接口定义)
5. [团队分工与职责](#5-团队分工与职责)
6. [TODO 执行计划](#6-todo-执行计划)
7. [里程碑与交付时间线](#7-里程碑与交付时间线)
8. [测试策略](#8-测试策略)
9. [安全规范](#9-安全规范)
10. [风险登记簿](#10-风险登记簿)
11. [附录](#11-附录)

---

## 1. 项目概述

### 1.1 愿景

让 AI 在嵌入式开发中形成 **"写代码 → 提示烧录 → 读串口日志 → 分析问题 → 改代码"** 的闭环。

当前 AI 辅助编码工具（Windsurf / Cursor / Copilot）在 Web 开发中可以实时预览结果，但在嵌入式领域，AI 看不到代码运行的产物——串口日志。Serial Pilot 通过 **MCP 协议** 将串口日志能力暴露给 AI，使 AI 能够自主读取设备输出、分析错误、迭代修复。

### 1.2 产品定位

| 维度 | 说明 |
|------|------|
| 目标用户 | 使用 AI IDE（Windsurf/Cursor/Copilot）进行嵌入式开发的工程师 |
| 核心价值 | AI 自动读取串口日志并分析，将调试反馈周期从分钟级缩短到秒级 |
| 竞品现状 | 无直接竞品。现有串口助手（SSCOM、COMTool）均为纯手动操作工具，不具备 AI 接入能力 |
| MVP 范围 | 烧录由用户手动完成，AI 负责等待+读取+分析串口日志 |

### 1.3 术语表

| 术语 | 定义 |
|------|------|
| **MCP** | Model Context Protocol，Anthropic 发布的标准协议，定义 AI 与外部工具的交互方式 |
| **MCP Server** | 实现 MCP 协议的服务端进程，通过 stdio 与 AI Client 通信，暴露 Tool / Resource |
| **MCP Client** | AI IDE 中内置的 MCP 协议客户端（Windsurf Cascade、Cursor Agent 等） |
| **Tool** | MCP 中的函数调用单元，AI 可主动调用以执行操作并获取结果 |
| **Extension Host** | VS Code 扩展运行的宿主进程，与编辑器 UI 进程隔离 |
| **Webview** | VS Code 中嵌入的浏览器沙箱，用于渲染自定义 HTML UI |
| **Bridge Server** | 本项目中 VS Code 扩展内嵌的本地 HTTP 服务，作为 MCP Server 与串口的通信桥梁 |

### 1.4 项目现状（Baseline）

| 模块 | 当前版本 | 完成度 | 说明 |
|------|---------|--------|------|
| `serialpilot-vscode` | v0.5.3 | **90%** | 串口监视器 UI 功能完善（连接/HEX/时间戳/重连/计数/历史/回显），缺少 Bridge Server |
| `serialpilot-mcp` | v0.1.0 | **10%** | 6 个 MCP Tool 已声明 schema，全部为占位 stub，无真实实现 |
| ~~`embedlog-core`~~（已废弃） | v0.1.0 | **废弃** | 旧名，功能已内化到 vscode 扩展的 `SerialManager` 中，不再维护 |

---

## 2. 系统架构

### 2.1 架构总览

```
┌────────────────────────────────────────────────────────────┐
│                    AI IDE Layer                             │
│  Windsurf (Cascade) / Cursor (Agent) / VS Code (Copilot)   │
│                    ↕ MCP Protocol (stdio / JSON-RPC 2.0)   │
├────────────────────────────────────────────────────────────┤
│              serialpilot-mcp                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MCP Tool Handler                                    │  │
│  │  list_serial_ports / connect_serial / read_serial_log│  │
│  │  wait_for_output / send_serial_data / ...            │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │ HTTP Client (fetch localhost)       │
│                       ↕                                    │
├────────────────────────────────────────────────────────────┤
│              serialpilot-vscode (Extension Host)              │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │ SerialManager │  │ Bridge Server  │  │  Webview UI  │   │
│  │ (串口读写)    │  │ (HTTP REST)    │  │ (侧边栏面板) │   │
│  └──────┬───────┘  └───────┬────────┘  └──────┬───────┘   │
│         │                  │                   │           │
│         │    postMessage   │                   │           │
│         │ ←───────────────→│←─────────────────→│           │
│         ↕                                                  │
├────────────────────────────────────────────────────────────┤
│              Hardware Layer                                │
│  USB Serial (COM3 / /dev/ttyUSB0)                         │
│  Target MCU: ESP32 / STM32 / ...                          │
└────────────────────────────────────────────────────────────┘
```

### 2.2 进程模型

| 进程 | 生命周期 | 职责 |
|------|---------|------|
| **VS Code Extension Host** | VS Code 窗口打开时启动 | 运行 `serialpilot-vscode` 扩展，管理串口、Bridge Server、Webview |
| **MCP Server Process** | AI Client 首次调用 Tool 时由 IDE 启动（stdio） | 运行 `serialpilot-mcp`，接收 AI 的 Tool 调用，转发 HTTP 请求到 Bridge |
| **Webview Renderer** | 侧边栏面板可见时创建 | 渲染串口监视器 UI，通过 `postMessage` 与 Extension Host 通信 |

### 2.3 通信协议栈

```
AI ←──MCP (stdio, JSON-RPC 2.0)──→ MCP Server
MCP Server ←──HTTP REST (localhost, JSON)──→ Bridge Server (Extension)
Extension ←──postMessage (structured clone)──→ Webview
Extension ←──serialport (native binding)──→ Hardware
```

### 2.4 服务发现机制

Bridge Server 启动后需要让 MCP Server 知道监听端口。采用 **文件发现** 方案：

1. 扩展激活时，Bridge Server 绑定 `127.0.0.1:0`（随机可用端口）
2. 将 `{ port, pid, startedAt }` 写入 **发现文件**：
   - Windows: `%USERPROFILE%\.serialpilot\bridge.json`
   - macOS/Linux: `~/.serialpilot/bridge.json`
3. MCP Server 启动时读取发现文件获取端口
4. 扩展 `deactivate()` 时删除发现文件

**发现文件格式**：
```json
{
  "port": 19800,
  "pid": 12345,
  "token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "instanceId": "uuid-v4",
  "version": "0.9.0",
  "startedAt": "2026-02-28T11:00:00.000Z"
}
```

> `instanceId` 用于区分多个 VS Code 窗口实例，便于未来扩展多实例选择。

---

## 3. 模块规格

### 3.1 serialpilot-vscode（VS Code 扩展）

#### 3.1.1 现有功能（已完成，无需改动）

| 功能 | 实现位置 | 状态 |
|------|---------|------|
| 串口列举 (`SerialPort.list()`) | `SerialManager.listPorts()` | ✅ |
| 串口连接/断开 | `SerialManager.connect()` / `disconnect()` | ✅ |
| 文本/HEX 双模式接收 | `SerialManager._processReceivedData()` | ✅ |
| 文本/HEX 双模式发送 | `SerialManager.send()` | ✅ |
| 可选时间戳 | `SerialConfig.showTimestamp` | ✅ |
| 自动重连 | `SerialManager._startReconnect()` | ✅ |
| RX/TX 字节计数 | `SerialManager._rxBytes` / `_txBytes` | ✅ |
| 发送历史（含删除） | Webview `history-dropdown` 组件 | ✅ |
| 发送回显 (Echo) | Webview `optEcho` checkbox + `doSend()` | ✅ |
| 拖拽调整日志区/发送区 | Webview `resize-handle` | ✅ |
| 配置持久化 (globalState) | `SerialPanelProvider._saveConfig()` | ✅ |
| 状态栏集成 | `updateStatusBar()` | ✅ |
| 日志环形缓冲 (5000行) | `SerialManager._logBuffer[]` | ✅ |

#### 3.1.2 新增功能：Bridge Server

在 `extension.ts` 的 `activate()` 中新增一个 Node.js `http.createServer`，暴露 REST API 供 MCP Server 调用。

**技术约束**：
- 使用 Node.js 内置 `http` 模块，**零外部依赖**
- 仅绑定 `127.0.0.1`，禁止外网访问
- 支持 Token 认证（Header: `Authorization: Bearer <token>`）
- Token 写入发现文件，MCP Server 读取后自动携带

**生命周期**：
```
activate()
  └→ startBridgeServer()
       ├→ http.createServer(handleRequest)
       ├→ server.listen(0, '127.0.0.1')  // 随机端口
       └→ writeBridgeFile({ port, pid, token })

deactivate()
  └→ stopBridgeServer()
       ├→ server.close()
       └→ deleteBridgeFile()
```

### 3.2 serialpilot-mcp（MCP Server）

#### 3.2.1 职责

纯粹的 **协议转换层**：接收 AI 的 MCP Tool 调用 → 转换为 HTTP 请求 → 发给 Bridge Server → 返回结果给 AI。

#### 3.2.2 依赖

| 包 | 用途 |
|----|------|
| `@modelcontextprotocol/sdk` | MCP Server SDK (已有) |
| `zod` | Tool 参数校验 (已有) |
| Node.js 内置 `http` | HTTP Client，请求 Bridge Server |

**不再依赖旧 `embedlog-core` 包**，已从 `package.json` 中移除（旧名，项目已更名为 Serial Pilot）。

#### 3.2.3 HTTP Client 封装

```typescript
// 内部 helper，所有 Tool 共用
async function bridgeRequest(method: string, path: string, body?: object): Promise<any>
```

- 从发现文件读取 `port` + `token`
- 失败时返回结构化错误：`{ error: "Bridge server not running. Please open VS Code with Serial Pilot extension." }`
- 请求超时：普通请求 5s，`/api/log/wait` 根据 `timeout` 参数动态设置

### 3.3 ~~embedlog-core~~（已废弃，旧名）

**决定：标记为 deprecated，从 workspace 中移除。**

理由：
1. `serialpilot-vscode` 的 `SerialManager` 功能更完善（HEX 双模、自动重连、计数器）
2. MCP Server 不直接操作串口，通过 HTTP 桥接
3. 避免维护两套串口代码

操作：
- 根 `package.json` 的 `workspaces` 已移除旧 `packages/embedlog-core`
- 目录保留但不参与构建，添加 `DEPRECATED.md` 说明

---

## 4. 接口定义

### 4.1 Bridge Server REST API

Base URL: `http://127.0.0.1:{port}`

所有响应均为 `Content-Type: application/json`。

#### 4.1.1 `GET /api/status`

获取当前串口连接状态。

**Response 200:**
```json
{
  "connected": true,
  "port": "COM3",
  "baudRate": 115200,
  "rxBytes": 10240,
  "txBytes": 512,
  "bufferedLines": 86,
  "isReconnecting": false
}
```

#### 4.1.2 `GET /api/ports`

列出系统中可用的串口设备。

**Response 200:**
```json
{
  "ports": [
    {
      "path": "COM3",
      "manufacturer": "Silicon Labs",
      "vendorId": "10C4",
      "productId": "EA60",
      "serialNumber": "0001"
    }
  ]
}
```

#### 4.1.3 `POST /api/connect`

连接到指定串口。如果当前已连接，先断开再连接。

**Request Body:**
```json
{
  "port": "COM3",
  "baudRate": 115200,
  "dataBits": 8,
  "parity": "none",
  "stopBits": 1
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Connected to COM3 @ 115200"
}
```

**Response 400 (连接失败):**
```json
{
  "success": false,
  "error": "Access denied: COM3 is in use by another application"
}
```

#### 4.1.4 `POST /api/disconnect`

断开当前串口连接。

**Response 200:**
```json
{
  "success": true
}
```

#### 4.1.5 `GET /api/log`

读取日志缓冲区中最近 N 行日志。

**Query Parameters:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `lines` | number | 50 | 返回最近 N 行 |

**Response 200:**
```json
{
  "lines": [
    "[12:00:01.234] System Ready",
    "[12:00:01.456] GPIO5 configured as output",
    "[12:00:02.000] LED ON"
  ],
  "totalBuffered": 86
}
```

#### 4.1.6 `POST /api/send`

向串口发送数据。

**Request Body:**
```json
{
  "data": "AT+RST",
  "hexMode": false,
  "lineEnding": "crlf"
}
```

**Response 200:**
```json
{
  "success": true,
  "bytesSent": 8
}
```

#### 4.1.7 `POST /api/clear`

清空日志缓冲区和 RX/TX 计数器。

**Response 200:**
```json
{
  "success": true
}
```

#### 4.1.8 `GET /api/log/wait` ⭐ 关键接口

阻塞等待串口输出匹配指定 pattern。这是实现"等待烧录完成"的核心 API。

**Query Parameters:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pattern` | string | (必填) | 正则表达式或纯文本匹配模式 |
| `timeout` | number | 30 | 等待超时秒数 (1-120) |
| `fromNow` | boolean | true | 仅匹配调用后的新日志（忽略历史日志） |

**Response 200 (匹配成功):**
```json
{
  "found": true,
  "matchedLine": "[12:00:05.678] System Ready",
  "matchedAt": "2026-02-28T04:00:05.678Z",
  "waitedMs": 3200,
  "recentLogs": [
    "Booting...",
    "Initializing peripherals...",
    "System Ready"
  ]
}
```

**Response 200 (超时):**
```json
{
  "found": false,
  "waitedMs": 30000,
  "recentLogs": [
    "Booting...",
    "(no more output)"
  ],
  "hint": "Device may not have been flashed yet, or the expected pattern was not printed."
}
```

**实现要点**：
- 调用时记录当前日志缓冲区位置作为起点
- 轮询（每 200ms）检查新日志是否包含 `pattern`
- 匹配成功立即返回，无需等待 timeout
- HTTP 连接保持直到匹配成功或超时

### 4.2 MCP Tool 接口

共 8 个 Tool，全部为 `serialpilot-mcp` 通过 HTTP 调用 Bridge Server 实现。

| Tool ID | 描述 | 参数 Schema | 映射 API |
|---------|------|-------------|----------|
| `list_serial_ports` | 列出可用串口 | `{}` | `GET /api/ports` |
| `connect_serial` | 连接串口 | `{ port: string, baudRate?: number, dataBits?, parity?, stopBits? }` | `POST /api/connect` |
| `disconnect_serial` | 断开串口 | `{}` | `POST /api/disconnect` |
| `read_serial_log` | 读取日志 | `{ lines?: number }` | `GET /api/log` |
| `send_serial_data` | 发送数据 | `{ data: string, hexMode?: boolean, lineEnding?: string }` | `POST /api/send` |
| `get_serial_status` | 获取状态 | `{}` | `GET /api/status` |
| `wait_for_output` | 等待特定输出 | `{ pattern: string, timeout?: number }` | `GET /api/log/wait` |
| `clear_serial_log` | 清空日志 | `{}` | `POST /api/clear` |

---

## 5. 团队分工与职责

### 5.1 角色定义

| 角色代号 | 角色名称 | 职责范围 |
|---------|---------|---------|
| **FE** | 前端工程师 (Extension + Webview) | VS Code 扩展开发：Bridge Server、Webview UI、扩展生命周期管理 |
| **BE** | 后端工程师 (MCP Server) | MCP Server 开发：Tool 实现、HTTP Client、服务发现、错误处理 |
| **QA** | 测试工程师 | 端到端测试、硬件实测、边界条件测试、自动化测试脚本 |
| **PE** | 提示词工程师 (Prompt Engineer) | AI Rules 编写、调试工作流设计、错误模式库、用户体验优化 |
| **PM** | 项目经理 | 进度跟踪、里程碑验收、风险管理、团队协调 |

### 5.2 模块所有权

```
packages/serialpilot-vscode/
  ├── src/extension.ts        → FE (Owner) / BE (Review)
  │   ├── SerialManager       → FE：已有代码，仅新增 getLogBuffer() 暴露接口
  │   ├── BridgeServer (NEW)  → FE：新增 HTTP Server 模块
  │   └── SerialPanelProvider → FE：已有代码，小幅适配
  └── media/                  → FE：已有 Webview UI，本阶段无改动

packages/serialpilot-mcp/
  └── src/index.ts            → BE (Owner) / FE (Review)
      ├── HTTP Client helper  → BE：新增 bridgeRequest() 通用函数
      └── 8 个 Tool 实现       → BE：替换所有 stub 为 HTTP 调用

.windsurf/rules/              → PE (Owner)
  └── serialpilot.md             → PE：AI 调试规则与工作流

tests/                        → QA (Owner)
  ├── bridge-api.test.ts      → QA：Bridge Server API 单元测试
  ├── mcp-tool.test.ts        → QA：MCP Tool 集成测试
  └── e2e/                    → QA：端到端闭环测试（需硬件）
```

### 5.3 协作矩阵 (RACI)

| 任务 | FE | BE | QA | PE | PM |
|------|----|----|----|----|-----|
| Bridge Server 开发 | **R** | C | I | I | A |
| REST API 实现 | **R** | C | I | I | A |
| MCP Tool 实现 | C | **R** | I | I | A |
| HTTP Client 开发 | I | **R** | I | I | A |
| 服务发现机制 | **R** | **R** | I | I | A |
| wait_for_output 实现 | **R** | **R** | I | C | A |
| AI Rules 编写 | I | I | C | **R** | A |
| 单元测试 | C | C | **R** | I | A |
| 端到端测试 | C | C | **R** | C | A |
| 安全审计 | C | C | **R** | I | A |
| 文档更新 | C | C | I | C | **R** |

> R = Responsible（执行）, A = Accountable（负责）, C = Consulted（咨询）, I = Informed（知会）

---

## 6. TODO 执行计划

### 6.0 任务编号规则

格式：`{Sprint}.{序号}` — 例如 `S1.03` 表示 Sprint 1 的第 3 个任务。

依赖关系用 `→` 表示：`S1.03 → S1.01` 意为 S1.03 依赖 S1.01 完成。

### 6.1 Sprint 0：工程准备（Day 1-2）

> 目标：清理遗留代码，统一开发环境，建立协作基础

| ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|----|------|-------|------|---------|------|
| S0.01 | 废弃旧 `embedlog-core`（已更名为 Serial Pilot）：从根 `package.json` 的 `workspaces` 移除 | FE | — | `npm install` 不再处理 core 包，构建不报错 | 0.5h |
| S0.02 | `serialpilot-mcp` 的 `package.json` 移除对旧 `embedlog-core` 的依赖 | BE | S0.01 | `npm install` 通过，`tsc` 编译通过 | 0.5h |
| S0.03 | `SerialManager` 新增 `getLogBuffer(): string[]` 公开方法 | FE | — | 返回日志缓冲区副本（已有 `getLogBuffer()` 但需确认可访问性） | 0.5h |
| S0.04 | 建立 `tests/` 目录结构，配置测试框架（vitest 或 jest） | QA | — | `npm test` 可运行空测试用例 | 2h |
| S0.05 | 编写 Bridge Server API 的 Mock 测试桩 | QA | S0.04 | 测试桩能模拟 SerialManager 的基本行为 | 2h |

> **📚 实施参考**
>
> | 任务 | 参考项目 | 参考文件 | 参考要点 |
> |------|---------|---------|----------|
> | S0.04 | `_Reference/servers/src/filesystem/` | `vitest.config.ts` | vitest 配置模板：`globals: true`, `environment: 'node'`, coverage 配置 |
> | S0.05 | `_Reference/servers/src/filesystem/` | `__tests__/path-validation.test.ts` | 测试桩编写模式：`describe/it/expect` 结构、环境检测、临时目录管理 |

### 6.2 Sprint 1：Bridge Server（Day 3-7）

> 目标：扩展内嵌 HTTP Server，暴露 REST API，MCP Server 能调通基础接口

| ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|----|------|-------|------|---------|------|
| **S1.01** | **Bridge Server 骨架**：在 `extension.ts` 新增 `BridgeServer` 类，`activate()` 中启动 | FE | S0.03 | `http.createServer` 启动成功，监听随机端口，控制台输出端口号 | 6h |
| **S1.02** | **服务发现文件**：Bridge 启动后写入 `~/.serialpilot/bridge.json`，`deactivate()` 删除 | FE | S1.01 | 文件包含 `{ port, pid, token, version, startedAt }`，扩展退出后文件被删除 | 2h |
| **S1.03** | **API: GET /api/status**：返回连接状态 | FE | S1.01 | `curl localhost:{port}/api/status` 返回正确 JSON | 1h |
| **S1.04** | **API: GET /api/ports**：返回可用串口列表 | FE | S1.01 | 返回系统真实串口信息 | 1h |
| **S1.05** | **API: POST /api/connect**：连接指定串口 | FE | S1.01 | POST 请求后串口连接成功，Webview UI 同步更新 | 2h |
| **S1.06** | **API: POST /api/disconnect**：断开串口 | FE | S1.01 | POST 请求后串口断开，Webview UI 同步更新 | 1h |
| **S1.07** | **API: GET /api/log**：读取日志缓冲区 | FE | S1.01 | `?lines=10` 返回最近 10 行日志 | 1h |
| **S1.08** | **API: POST /api/send**：发送数据到串口 | FE | S1.01 | 串口接收到发送的数据 | 1.5h |
| **S1.09** | **API: POST /api/clear**：清空日志缓冲区 | FE | S1.01 | 清空后 GET /api/log 返回空数组 | 0.5h |
| **S1.10** | **Token 认证中间件**：校验 `Authorization: Bearer <token>` | FE | S1.02 | 无 token 或错误 token 返回 401 | 1.5h |
| **S1.11** | **MCP HTTP Client**：`bridgeRequest()` 通用函数，读取发现文件、携带 token | BE | S1.02 | 能成功请求 Bridge Server 任意端点 | 3h |
| **S1.12** | **MCP Tool 实现：list_serial_ports** | BE | S1.11, S1.04 | AI 调用返回真实串口列表 | 1h |
| **S1.13** | **MCP Tool 实现：connect_serial** | BE | S1.11, S1.05 | AI 调用后串口连接成功 | 1h |
| **S1.14** | **MCP Tool 实现：disconnect_serial** | BE | S1.11, S1.06 | AI 调用后串口断开 | 0.5h |
| **S1.15** | **MCP Tool 实现：read_serial_log** | BE | S1.11, S1.07 | AI 调用返回日志内容 | 1h |
| **S1.16** | **MCP Tool 实现：send_serial_data** | BE | S1.11, S1.08 | AI 调用后串口收到数据 | 1h |
| **S1.17** | **MCP Tool 实现：get_serial_status** | BE | S1.11, S1.03 | AI 调用返回连接状态 | 0.5h |
| **S1.18** | **MCP Tool 实现：clear_serial_log** | BE | S1.11, S1.09 | AI 调用后日志被清空 | 0.5h |
| **S1.19** | **Windsurf 联调**：配置 `mcp_config.json`，在 Cascade 中测试基础 Tool | BE+FE | S1.12~S1.18 | AI 能列出串口、连接、读取日志 | 2h |
| **S1.20** | **Bridge API 单元测试** | QA | S1.03~S1.09 | 覆盖所有 API 端点的正常/异常场景 | 4h |

> **📚 实施参考**
>
> | 任务 | 参考项目 | 参考文件 | 参考要点 |
> |------|---------|---------|----------|
> | S1.01 | `_Reference/vscode-extension-samples/webview-view-sample/` | `src/extension.ts` | `WebviewViewProvider` 生命周期管理、`activate()` 中初始化模式、CSP 安全策略 |
> | S1.01 | `_Reference/vsc-serialport-helper/` | `src/extension.js`, `src/SerialPort.js` | VS Code 串口扩展架构参考：TreeDataProvider、串口管理、事件回调模式 |
> | S1.03~S1.09 | `_Reference/vscode-restclient/` | `src/extension.ts` | HTTP 请求处理模式、Controller 架构、命令注册模式 |
> | S1.05 | `_Reference/COMTool/` | `COMTool/conn/conn_serial.py` | 串口连接参数全集（baudrate/bytesize/parity/stopbits/flowcontrol/rts/dtr）、状态机管理 |
> | S1.05 | `_Reference/vsc-serialport-helper/` | `src/comment.js` | 串口连接/断开/发送流程、HEX 数据解析、文件发送模式 |
> | S1.10 | `_Reference/servers/src/filesystem/` | `index.ts` L41-93 | 路径校验 + 权限控制模式，可参考其安全校验思路应用于 Token 认证 |
> | S1.11 | `_Reference/servers/src/filesystem/` | `index.ts` L162-223 | `McpServer` 实例创建 + `server.registerTool()` 模式（Zod Schema + handler） |
> | S1.12~S1.18 | `_Reference/servers/src/everything/tools/` | `echo.ts` | **单个 Tool 的标准开发模板**：独立 Schema 定义 → config 对象 → `registerTool()` 封装 |
> | S1.12~S1.18 | `_Reference/servers/src/everything/server/` | `index.ts` | Server Factory 模式：模块化注册 Tool/Resource/Prompt、capabilities 配置、cleanup 生命周期 |
> | S1.20 | `_Reference/servers/src/filesystem/` | `__tests__/*.test.ts`, `vitest.config.ts` | API 测试用例结构、正常/异常场景覆盖 |

### 6.3 Sprint 2：Wait 机制 + 闭环（Day 8-12）

> 目标：实现 `wait_for_output` 等待机制，跑通 "AI等待烧录→读日志→分析" 闭环

| ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|----|------|-------|------|---------|------|
| **S2.01** | **API: GET /api/log/wait**：日志等待接口实现 | FE | S1.01 | 设备输出匹配 pattern 后立即返回；超时返回 `found: false` | 10h |
| **S2.02** | **SerialManager 新增日志订阅机制**：`onNewLog(callback)` 支持增量监听 | FE | S0.03 | wait API 能监听到连接后新增的日志行，不依赖轮询 | 3h |
| **S2.03** | **MCP Tool 实现：wait_for_output** | BE | S2.01, S1.11 | AI 调用后阻塞直到匹配或超时 | 2h |
| **S2.04** | **HTTP Client 动态超时**：`wait_for_output` 的 HTTP 超时 = `timeout + 5s` 余量 | BE | S2.03 | 不会因 HTTP 超时早于 wait 超时导致误报 | 1h |
| **S2.05** | **端到端闭环测试（ESP32）** | QA | S2.03 | 完整流程：clear → 提示烧录 → wait → read_log → 验证日志内容 | 6h |
| **S2.06** | **端到端闭环测试（STM32）** | QA | S2.03 | 同上，验证 STM32 + ST-Link 场景 | 6h |
| **S2.07** | **Bridge Server 优雅关闭**：deactivate 时等待进行中的 wait 请求完成 | FE | S2.01 | 扩展关闭不会导致 MCP 侧收到连接重置错误 | 2h |
| **S2.08** | **MCP 错误处理增强**：Bridge 不可达时返回友好提示而非 crash | BE | S1.11 | `isError: true` + 明确提示 "请打开 VS Code 并确认 Serial Pilot 已激活" | 2h |

> **📚 实施参考**
>
> | 任务 | 参考项目 | 参考文件 | 参考要点 |
> |------|---------|---------|----------|
> | S2.01, S2.03 | `_Reference/servers/src/everything/tools/` | `trigger-long-running-operation.ts` | **长时间运行操作模式**：`progressToken` 进度通知、分步延时、超时控制。`wait_for_output` 可参考此模式实现阻塞等待 |
> | S2.07 | `_Reference/servers/src/everything/server/` | `index.ts` L106-118 | Server cleanup 生命周期：`stopSimulatedLogging` / `stopSimulatedResourceUpdates`，参考其优雅关闭模式 |
> | S2.05~S2.06 | `_Reference/vsc-serialport-helper/` | `src/SerialPort.js` | 串口开关状态管理、事件监听回调、错误处理模式 |
> | S2.05~S2.06 | `_Reference/COMTool/` | `COMTool/conn/conn_serial.py` L36-98 | 串口连接状态机（`ConnectionStatus`）、断开重连、线程安全处理 |
> | S2.08 | `_Reference/servers/src/filesystem/` | `index.ts` L80-88 | 不可访问时的友好错误处理：`console.error` + 退出模式，可参考转化为 `isError: true` 返回 |

### 6.4 Sprint 3：AI 提示词工程（Day 13-16）

> 目标：编写 Windsurf Rules，让 AI 知道如何正确使用 MCP Tool 完成嵌入式调试

| ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|----|------|-------|------|---------|------|
| **S3.01** | **编写 `.windsurf/rules/serialpilot.md`**：AI 调试工作流规则 | PE | S2.03 | 规则文件包含完整的调试工作流、Tool 使用指南、安全约束 | 4h |
| **S3.02** | **定义标准调试工作流**：check_status → clear → prompt_flash → wait → read → analyze | PE | S3.01 | 工作流在 3 个以上测试场景中正确运行 | 3h |
| **S3.03** | **错误模式知识库**：Panic、HardFault、Watchdog、StackOverflow 等常见错误的分析模板 | PE | — | 涵盖 ESP32 + STM32 至少 10 种常见错误 | 4h |
| **S3.04** | **安全约束规则**：最大重试 3 次、超时处理、不确定时询问用户 | PE | S3.01 | AI 在 3 次失败后停止重试并汇报 | 2h |
| **S3.05** | **Windsurf 实战测试**：故意引入 Bug，验证 AI 能否通过日志自动定位并修复 | PE+QA | S3.02 | 3 个测试场景中 AI 至少成功修复 2 个 | 6h |
| **S3.06** | **Cursor 适配验证**：确认 MCP Server 在 Cursor 中同样可用 | BE | S2.03 | Cursor Agent 能调用所有 Tool 并获得正确结果 | 2h |

> **📚 实施参考**
>
> | 任务 | 参考项目 | 参考文件 | 参考要点 |
> |------|---------|---------|----------|
> | S3.01 | `_Reference/continue/` | `extensions/cli/spec/mcp.md` | Continue.dev 的 MCP 规格定义方式，参考其如何描述 Tool 接口供 AI 理解 |
> | S3.03 | `_Reference/COMTool/` | `COMTool/conn/conn_serial.py` L197-229 | 串口配置变更时的错误处理模式（端口设置失败、波特率异常等），可提炼为 AI 错误模式知识库素材 |
> | S3.06 | `_Reference/awesome-mcp-servers/` | `README.md` | MCP 生态全景：了解现有 MCP Server 的类别和模式，确认 Serial Pilot 在 Embedded Systems 📟 品类中的定位 |
> | S3.06 | `_Reference/vscode-extension-samples/mcp-extension-sample/` | `src/extension.ts` | `vscode.lm.registerMcpServerDefinitionProvider` API：VS Code 原生 MCP 集成方式，评估是否适用于 Cursor 适配 |

### 6.5 Sprint 4：产品化 + 发布（Day 17-25）

> 目标：安全加固、配置自动化、文档完善、打包发布 v0.9.0-beta

| ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|----|------|-------|------|---------|------|
| **S4.01** | **安全加固**：Bridge Server 仅绑定 `127.0.0.1`，Token 使用 `crypto.randomUUID()` | FE | S1.10 | 外部网络无法访问，无 token 请求返回 401 | 2h |
| **S4.02** | **命令：`serialpilot.configureMCP`**：生成 MCP 配置片段到剪贴板 + 打开 IDE 设置页引导用户粘贴 | FE | — | 命令执行后配置 JSON 已在剪贴板，并提示用户粘贴位置 | 2h |
| **S4.03** | **扩展设置项**：`serialpilot.bridge.port`（固定端口，可选）、`serialpilot.bridge.enabled`（开关） | FE | S1.01 | 用户可在 VS Code Settings 中配置 Bridge 行为 | 2h |
| **S4.04** | **MCP Server 构建脚本**：产出独立可运行的 `dist/index.js` | BE | — | `node dist/index.js` 可直接运行，无需 workspace 环境 | 2h |
| **S4.05** | **更新 README.md**：完整使用指南（安装、配置、工作流、FAQ） | PM | S3.01 | 新用户按文档操作能在 30 分钟内跑通闭环 | 4h |
| **S4.06** | **更新 serialpilot-vscode/README.md**：扩展详情页内容 | PM | S4.05 | VS Code 扩展详情页显示完整功能介绍 | 2h |
| **S4.07** | **VSIX 打包 v0.9.0-beta** | FE | S4.01~S4.03 | VSIX 安装后所有功能正常，包含 README | 1h |
| **S4.08** | **MCP Server 打包 + 安装说明** | BE | S4.04 | 用户能按说明配置并运行 MCP Server | 1h |
| **S4.09** | **回归测试**：全量功能验证 | QA | S4.07, S4.08 | 所有 Webview 功能 + 所有 MCP Tool + 闭环测试 通过 | 4h |
| **S4.10** | **Release Notes 编写** | PM | S4.09 | 包含新功能列表、已知限制、升级指南 | 1h |

> **📚 实施参考**
>
> | 任务 | 参考项目 | 参考文件 | 参考要点 |
> |------|---------|---------|----------|
> | S4.02 | `_Reference/vscode-extension-samples/mcp-extension-sample/` | `src/extension.ts` | **MCP 配置自动化的核心参考**：`vscode.lm.registerMcpServerDefinitionProvider` API + `McpStdioServerDefinition` 构造。评估是否可用此 API 替代手动写入 `mcp_config.json` |
> | S4.03 | `_Reference/vsc-serialport-helper/` | `package.json` | 扩展配置贡献点（`contributes.configuration`）的定义模式，参考其串口参数配置项的声明方式 |
> | S4.04 | `_Reference/servers/src/filesystem/` | `package.json`, `tsconfig.json` | MCP Server 独立构建配置：`bin` 字段、`scripts.build`、TypeScript 编译选项 |
> | S4.07 | `_Reference/vscode-generator-code/` | 项目根目录 | VS Code 扩展脚手架模板，参考标准 VSIX 打包结构和 `.vscodeignore` 配置 |

---

## 7. 里程碑与交付时间线

```
Week 1                    Week 2                    Week 3                    Week 4
│                         │                         │                         │
├─ Sprint 0 (Day 1-2)    │                         │                         │
│  工程准备、废弃 core     │                         │                         │
│                         │                         │                         │
├─ Sprint 1 (Day 3-7) ───┤                         │                         │
│  Bridge Server          │                         │                         │
│  REST API ×8            │                         │                         │
│  MCP Tool ×8            │                         │                         │
│  Windsurf 联调          │                         │                         │
│                         │                         │                         │
│                         ├─ Sprint 2 (Day 8-12) ──┤                         │
│                         │  wait_for_output        │                         │
│                         │  闭环测试               │                         │
│                         │                         │                         │
│                         │                         ├─ Sprint 3 (Day 13-16)  │
│                         │                         │  AI Rules               │
│                         │                         │  错误模式库             │
│                         │                         │  实战测试               │
│                         │                         │                         │
│                         │                         ├─ Sprint 4 (Day 17-25) ─┤
│                         │                         │  安全加固               │
│                         │                         │  文档 + 打包            │
│                         │                         │  Release v0.9.0-beta    │
│                         │                         │                         │
▼ M1: Bridge 可用         ▼ M2: 闭环验证            ▼ M3: AI 自主调试         ▼ M4: v0.9.0-beta
```

### 里程碑验收标准

| 里程碑 | 日期 | 验收标准 |
|--------|------|---------|
| **M1: Bridge 可用** | Day 7 | AI 通过 MCP 成功列出串口、连接、读取日志（≥3 行真实串口输出） |
| **M2: 闭环验证** | Day 12 | 完整流程跑通：AI clear → 用户烧录 → AI wait 成功 → AI 读取日志并分析 |
| **M3: AI 自主调试** | Day 16 | AI 能根据串口日志中的错误信息，自动修改代码并提示用户重新烧录 |
| **M4: v0.9.0-beta** | Day 25 | VSIX + MCP Server 打包完成，文档齐全，回归测试通过 |

---

## 8. 测试策略

### 8.1 测试层次

| 层次 | 覆盖范围 | 工具 | 负责人 |
|------|---------|------|--------|
| **单元测试** | Bridge Server API handler、HTTP Client helper | vitest / jest | QA |
| **集成测试** | MCP Tool → HTTP → Bridge → SerialManager（Mock 串口） | vitest + mock | QA |
| **端到端测试** | AI → MCP → Bridge → 真实串口 → 真实设备 | 手动 + 脚本 | QA + FE |
| **Prompt 测试** | AI 能否正确理解 Rules 并执行调试工作流 | 手动（Windsurf/Cursor 对话） | PE |

### 8.2 测试用例清单

#### Bridge Server API 测试

| 编号 | 用例 | 预期 |
|------|------|------|
| T-B01 | 无 Token 请求任意 API | 返回 401 Unauthorized |
| T-B02 | 错误 Token 请求 | 返回 401 Unauthorized |
| T-B03 | GET /api/ports（无设备插入） | 返回 `{ ports: [] }` |
| T-B04 | GET /api/ports（有设备） | 返回包含设备信息的数组 |
| T-B05 | POST /api/connect（合法端口） | 返回 `{ success: true }`，状态变为 connected |
| T-B06 | POST /api/connect（非法端口） | 返回 `{ success: false, error: "..." }` |
| T-B07 | POST /api/connect（已连接时再连接） | 自动断开旧连接，连接新端口 |
| T-B08 | POST /api/disconnect（未连接） | 返回 `{ success: true }`（幂等） |
| T-B09 | GET /api/log（缓冲区为空） | 返回 `{ lines: [], totalBuffered: 0 }` |
| T-B10 | GET /api/log?lines=5（缓冲区有 100 行） | 返回最后 5 行 |
| T-B11 | POST /api/send（未连接） | 返回 `{ success: false }` |
| T-B12 | POST /api/send（HEX 格式错误） | 返回 `{ success: false, error: "Invalid HEX" }` |
| T-B13 | GET /api/log/wait（pattern 匹配） | 在输出匹配 pattern 后立即返回 `{ found: true }` |
| T-B14 | GET /api/log/wait（超时） | 等待 timeout 秒后返回 `{ found: false }` |
| T-B15 | GET /api/log/wait（串口未连接） | 立即返回错误 |

#### MCP Tool 测试

| 编号 | 用例 | 预期 |
|------|------|------|
| T-M01 | Bridge 未启动时调用任意 Tool | 返回 `isError: true`，提示用户启动扩展 |
| T-M02 | 发现文件不存在时调用 Tool | 同上 |
| T-M03 | list_serial_ports 正常调用 | 返回串口列表文本 |
| T-M04 | connect_serial + read_serial_log 组合 | 连接后读取到真实日志 |
| T-M05 | wait_for_output + 设备重启 | 设备重启输出后 wait 返回成功 |

### 8.3 硬件测试矩阵

| 设备 | 芯片 | 烧录方式 | 串口类型 | 波特率 |
|------|------|---------|---------|--------|
| ESP32-DevKitC | ESP32 | esptool (USB) | CP2102 USB-UART | 115200 |
| STM32F103C8T6 (Blue Pill) | STM32F103 | ST-Link + OpenOCD | USART1 → USB-TTL | 115200 |
| Arduino Uno | ATmega328P | avrdude (USB) | CH340 USB-UART | 9600 |

---

## 9. 安全规范

### 9.1 网络安全

| 措施 | 说明 |
|------|------|
| **本地绑定** | Bridge Server 仅绑定 `127.0.0.1`，拒绝 `0.0.0.0` |
| **Token 认证** | 每次启动生成随机 UUID Token，写入发现文件，MCP Server 读取后在 HTTP Header 中携带 |
| **无外部请求** | MCP Server 和 Bridge Server 均不访问任何外部网络 |

### 9.2 硬件安全

| 措施 | 说明 |
|------|------|
| **串口独占** | 仅 VS Code 扩展持有串口句柄，MCP Server 无法直接操作硬件 |
| **无自动烧录** | MVP 版本不包含自动烧录功能，避免 AI 误操作损坏设备 |
| **操作审计** | Bridge Server 对所有 connect / send 操作记录日志（输出到 VS Code Output Channel） |

### 9.3 数据安全

| 措施 | 说明 |
|------|------|
| **内存中存储** | 日志缓冲区仅存于内存，不写入磁盘文件 |
| **发现文件权限** | `bridge.json` 使用 `0o600` 权限（仅当前用户可读写） |

---

## 10. 风险登记簿

| ID | 风险 | 概率 | 影响 | 等级 | 缓解措施 | Owner |
|----|------|------|------|------|---------|-------|
| R01 | 串口被其他软件占用，connect 失败 | 高 | 中 | 🟡 | API 返回明确错误信息，AI 提示用户关闭占用软件 | FE |
| R02 | Bridge Server 端口冲突 | 低 | 中 | 🟢 | 使用 port=0 让 OS 分配，避免硬编码端口 | FE |
| R03 | 扩展未启动时 MCP 调用 | 高 | 中 | 🟡 | MCP 返回 `isError: true`，提示 "请先打开 VS Code 并确认 Serial Pilot 已激活" | BE |
| R04 | AI 误判日志含义，错误修改代码 | 中 | 高 | 🟡 | Rules 中明确"不确定时询问用户"，限制最大重试 3 次 | PE |
| R05 | wait_for_output 超时导致 AI 停滞 | 中 | 中 | 🟡 | 超时后返回已收集的日志 + 提示信息，AI 可决定重试或询问用户 | FE+BE |
| R06 | serialport 原生模块加载失败 | 低 | 高 | 🟡 | 已有懒加载防御机制；VSIX 打包时包含预编译二进制 | FE |
| R07 | 发现文件被用户误删 | 低 | 低 | 🟢 | MCP 检测到文件不存在时给出明确提示 | BE |
| R08 | 多个 VS Code 窗口同时运行 Serial Pilot | 中 | 中 | 🟡 | 发现文件含 `instanceId` 区分实例，后启动覆盖（last-writer-wins），未来可支持实例选择 | FE |
| R09 | macOS/Linux 串口权限不足（需 dialout 组） | 中 | 中 | 🟡 | API 返回明确权限错误信息，README 包含各平台串口权限配置指南 | QA |

---

## 11. 附录

### 11.1 第一代 MVP 完整工作流时序图

```
User              AI (Windsurf)        MCP Server          Bridge (Extension)     Device
 │                     │                    │                      │                 │
 │  "实现 LED 闪烁"     │                    │                      │                 │
 │────────────────────→│                    │                      │                 │
 │                     │                    │                      │                 │
 │                     │ get_serial_status   │                      │                 │
 │                     │───────────────────→│  GET /api/status     │                 │
 │                     │                    │─────────────────────→│                 │
 │                     │                    │←─────────────────────│                 │
 │                     │←───────────────────│  { connected: true } │                 │
 │                     │                    │                      │                 │
 │                     │  (写代码 main.c)    │                      │                 │
 │                     │                    │                      │                 │
 │                     │ clear_serial_log    │                      │                 │
 │                     │───────────────────→│  POST /api/clear     │                 │
 │                     │                    │─────────────────────→│                 │
 │                     │←───────────────────│                      │                 │
 │                     │                    │                      │                 │
 │  "请编译烧录"        │                    │                      │                 │
 │←────────────────────│                    │                      │                 │
 │                     │                    │                      │                 │
 │                     │ wait_for_output     │                      │                 │
 │                     │  (pattern="Ready")  │                      │                 │
 │                     │───────────────────→│  GET /api/log/wait   │                 │
 │                     │                    │─────────────────────→│  (开始监听)      │
 │                     │                    │                      │                 │
 │  (用户编译 + 烧录)   │                    │                      │                 │
 │──────────────────────────────────────────────────────────────────────────────────→│
 │                     │                    │                      │                 │
 │                     │                    │                      │  串口收到:       │
 │                     │                    │                      │  "Booting..."   │
 │                     │                    │                      │  "System Ready" │
 │                     │                    │                      │←────────────────│
 │                     │                    │  { found: true }     │                 │
 │                     │                    │←─────────────────────│                 │
 │                     │←───────────────────│                      │                 │
 │                     │                    │                      │                 │
 │                     │ read_serial_log     │                      │                 │
 │                     │───────────────────→│  GET /api/log        │                 │
 │                     │                    │─────────────────────→│                 │
 │                     │←───────────────────│  { lines: [...] }    │                 │
 │                     │                    │                      │                 │
 │                     │  (分析日志，确认成功)│                      │                 │
 │  "LED 闪烁已成功！"  │                    │                      │                 │
 │←────────────────────│                    │                      │                 │
```

### 11.2 发现文件路径约定

| 操作系统 | 路径 |
|---------|------|
| Windows | `%USERPROFILE%\.serialpilot\bridge.json` |
| macOS | `~/.serialpilot/bridge.json` |
| Linux | `~/.serialpilot/bridge.json` |

### 11.3 Windsurf MCP 配置模板

```json
{
  "mcpServers": {
    "serialpilot": {
      "command": "node",
      "args": ["D:/_Code/__selfproject/01-Serial Pilot/Serial Pilot/packages/serialpilot-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

### 11.4 依赖清单

#### serialpilot-vscode
| 依赖 | 版本 | 用途 |
|------|------|------|
| vscode (engine) | ^1.85.0 | VS Code API |
| serialport | ^13.0.0 | 串口通信 |
| Node.js http (内置) | — | Bridge Server |
| Node.js crypto (内置) | — | Token 生成 |

#### serialpilot-mcp
| 依赖 | 版本 | 用途 |
|------|------|------|
| @modelcontextprotocol/sdk | ^1.12.1 | MCP Server SDK |
| zod | (SDK 内置) | 参数校验 |
| Node.js http (内置) | — | HTTP Client |
| Node.js fs (内置) | — | 读取发现文件 |

### 11.5 参考项目索引 (`_Reference/`)

> 以下为项目 `_Reference/` 目录中各参考项目的价值分析和任务关联映射。
> 开发人员在执行对应 Sprint 任务时，应优先参考标注的文件和模式。

| # | 参考项目 | 类型 | 核心价值 | 关联任务 |
|---|---------|------|---------|---------|
| R1 | **`servers/src/filesystem/`** | MCP 官方参考 Server | MCP Tool 注册模式（`server.registerTool()` + Zod Schema）、vitest 配置、单元测试模式、安全路径校验 | S0.04, S0.05, S1.10, S1.11, S1.20, S2.08, S4.04 |
| R2 | **`servers/src/everything/`** | MCP 官方 Everything Server | Server Factory 模式、**模块化 Tool 组织**（每个 Tool 独立文件）、**长时间运行操作 + 进度通知**、cleanup 生命周期 | S1.01, S1.12~S1.18, S2.01, S2.03, S2.07 |
| R3 | **`vsc-serialport-helper/`** | VS Code 串口扩展 | VS Code 串口扩展实现参考：TreeDataProvider、串口连接/断开/发送流程、HEX 数据处理、配置持久化、多平台 native 模块 | S1.01, S1.05, S2.05~S2.06, S4.03 |
| R4 | **`COMTool/`** | Python 串口工具 | 串口参数全集（baudrate/bytesize/parity/stopbits/flowcontrol/RTS/DTR）、连接状态机、串口检测、错误处理模式 | S1.05, S2.05~S2.06, S3.03 |
| R5 | **`vscode-extension-samples/webview-view-sample/`** | VS Code 官方示例 | `WebviewViewProvider` 生命周期、CSP 安全策略（nonce）、postMessage 通信、资源 URI 处理 | S1.01 |
| R6 | **`vscode-extension-samples/mcp-extension-sample/`** | VS Code 官方 MCP 示例 | `vscode.lm.registerMcpServerDefinitionProvider` API、`McpStdioServerDefinition` 动态注册 MCP Server | S3.06, S4.02 |
| R7 | **`vscode-restclient/`** | VS Code REST 客户端扩展 | Controller 架构模式、HTTP 请求处理、命令注册模式、模块化代码组织 | S1.03~S1.09, S1.11 |
| R8 | **`awesome-mcp-servers/`** | MCP 生态目录 | MCP Server 生态全景、品类定位（Embedded Systems 📟）、竞品/同类分析 | S3.06, S4.05 |
| R9 | **`continue/`** | Continue.dev AI IDE 扩展 | 大规模 AI IDE 扩展架构、MCP 集成模式、扩展生命周期管理 | S3.01 |
| R10 | **`vscode-generator-code/`** | VS Code 扩展脚手架 | 扩展项目模板、`package.json` 标准配置、`.vscodeignore` 最佳实践、VSIX 打包结构 | S4.07 |
| R11 | **`vscode-webview-ui-toolkit/`** | Webview UI 组件库 | Webview UI 组件参考（⚠️ 已废弃 2025-01-01）、主题适配、无障碍访问模式 | 仅供 UI 改进参考 |
| R12 | **`mcp/`** (AWS MCP Servers) | AWS 官方 MCP 集合 | 企业级 MCP Server 模式、大规模 Tool 实现、生产级错误处理 | S1.12~S1.18, S2.08 |

#### 关键参考路径速查

```
# MCP Tool 开发必读（S1.11~S1.18）
_Reference/servers/src/everything/tools/echo.ts              # 单 Tool 模板
_Reference/servers/src/everything/server/index.ts            # Server Factory
_Reference/servers/src/filesystem/index.ts                   # registerTool + Zod

# Bridge Server 开发必读（S1.01~S1.09）
_Reference/vsc-serialport-helper/src/extension.js            # 扩展激活模式
_Reference/vsc-serialport-helper/src/SerialPort.js           # 串口管理
_Reference/vscode-extension-samples/webview-view-sample/src/extension.ts  # Webview 生命周期

# wait_for_output 实现必读（S2.01~S2.03）
_Reference/servers/src/everything/tools/trigger-long-running-operation.ts  # 长运行 + 进度

# 测试框架必读（S0.04~S0.05, S1.20）
_Reference/servers/src/filesystem/vitest.config.ts           # vitest 配置
_Reference/servers/src/filesystem/__tests__/                 # 测试用例结构

# MCP 配置自动化必读（S4.02）
_Reference/vscode-extension-samples/mcp-extension-sample/src/extension.ts  # MCP 定义 Provider
```
