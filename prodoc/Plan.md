# Serial Pilot 执行计划

> **定位**：本文档为项目执行追踪文档，聚焦于"谁做什么、何时完成、如何验收"。
> 技术细节（架构图、API 定义、接口规格、测试用例）请参阅 [`spec.md`](./spec.md)。

| 字段 | 值 |
|------|-----|
| 文档版本 | v2.0.0 |
| 最后更新 | 2026-02-28 |
| 关联规格 | [spec.md](./spec.md) v1.1.0 |

---

## 一、项目概述

**愿景**：让 AI 在嵌入式开发中形成 **"写代码 → 提示烧录 → 读串口日志 → 分析问题 → 改代码"** 的闭环。

**MVP 边界**：烧录由用户手动完成，AI 负责等待 + 读取 + 分析串口日志。

**核心架构**：VS Code 扩展独占串口并内嵌 Bridge Server (HTTP REST)，MCP Server 作为协议转换层通过 HTTP 调用扩展，AI 通过 MCP 协议调用 MCP Server。

> 详细架构图、进程模型、通信协议栈见 `spec.md` §2

---

## 二、关键架构决策

| # | 决策 | 理由 | 参考 |
|---|------|------|------|
| D1 | **废弃旧 `embedlog-core`（已更名为 Serial Pilot）** | `SerialManager` 功能更完善，MCP Server 通过 HTTP 桥接不需要 core 层 | spec.md §3.3 |
| D2 | **Bridge Server 使用 Node.js 内置 `http` 模块** | 零外部依赖，减少扩展体积 | spec.md §3.1.2 |
| D3 | **服务发现使用文件方案 (`~/.serialpilot/bridge.json`)** | 简单可靠，跨平台，支持 Token 认证 | spec.md §2.4 |
| D4 | **Bridge Server 仅绑定 `127.0.0.1`** | 安全要求，禁止外网访问 | spec.md §9.1 |
| D5 | **Token 认证：每次启动生成 `crypto.randomUUID()`** | 防止本地恶意进程调用 Bridge API | spec.md §9.1 |
| D6 | **MCP Server 不直接操作串口** | 避免与扩展的串口连接冲突 | spec.md §2.2 |

---

## 三、角色与职责

| 代号 | 角色 | 核心职责 |
|------|------|---------|
| **FE** | 前端/扩展工程师 | Bridge Server 开发、REST API 实现、扩展生命周期管理 |
| **BE** | 后端/MCP 工程师 | MCP Tool 实现、HTTP Client (`bridgeRequest()`)、服务发现 |
| **QA** | 测试工程师 | 单元/集成/E2E 测试、硬件实测 |
| **PE** | 提示词工程师 | AI Rules 编写、调试工作流设计、错误模式库 |
| **PM** | 项目经理 | 进度跟踪、文档、里程碑验收、发布管理 |

> 详细 RACI 矩阵见 `spec.md` §5.3

---

## 四、Sprint 执行计划

### 任务编号规则

- 格式：`S{Sprint}.{序号}` — 例如 `S1.03` 表示 Sprint 1 的第 3 个任务
- 依赖：`S1.03 → S1.01` 意为 S1.03 依赖 S1.01 完成
- 状态：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 已完成

---

### Sprint 0：工程准备（Day 1-2）

> **目标**：清理遗留代码，统一开发环境，建立协作基础
> **Definition of Done**：`npm install` 通过、`tsc` 编译通过、测试框架可运行

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S0.01 | 废弃旧 `embedlog-core`（已更名为 Serial Pilot）：从根 `package.json` 的 `workspaces` 移除 | FE | — | `npm install` 不再处理 core 包，构建不报错 | 0.5h |
| [x] | S0.02 | `serialpilot-mcp` 的 `package.json` 移除对旧 `embedlog-core` 的依赖，清理 import | BE | S0.01 | `npm install` 通过，`tsc` 编译通过 | 0.5h |
| [x] | S0.03 | 确认 `SerialManager.getLogBuffer()` 可被 Bridge Server 调用 | FE | — | 返回 `string[]` 日志缓冲区副本 | 0.5h |
| [x] | S0.04 | 建立 `tests/` 目录，配置测试框架（vitest） | QA | — | `npm test` 可运行空测试用例 | 2h |
| [x] | S0.05 | 编写 Bridge Server API 的 Mock 测试桩 | QA | S0.04 | 测试桩能模拟 SerialManager 的基本行为 | 2h |

---

### Sprint 1：Bridge Server + MCP 接入（Day 3-7）

> **目标**：扩展内嵌 HTTP Server，暴露 REST API，MCP Server 通过 HTTP 调通所有基础接口
> **Definition of Done**：在 Windsurf 中调用 `list_serial_ports` / `connect_serial` / `read_serial_log` 返回真实数据

#### 1A. Bridge Server（FE 负责）

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S1.01 | **Bridge Server 骨架**：新增 `BridgeServer` 类，`activate()` 中启动 `http.createServer`，监听 `127.0.0.1:0` | FE | S0.03 | Server 启动成功，输出端口号到 Output Channel | 6h |
| [x] | S1.02 | **服务发现文件**：启动后写入 `~/.serialpilot/bridge.json`（含 port/pid/token），`deactivate()` 删除 | FE | S1.01 | 文件正确写入与删除，token 使用 `crypto.randomUUID()` | 2h |
| [x] | S1.03 | **API: GET /api/status** | FE | S1.01 | 返回 `{ connected, port, baudRate, rxBytes, txBytes, bufferedLines, isReconnecting }` | 1h |
| [x] | S1.04 | **API: GET /api/ports** | FE | S1.01 | 返回系统真实串口信息数组 | 1h |
| [x] | S1.05 | **API: POST /api/connect** | FE | S1.01 | 请求后串口连接成功，Webview UI 同步更新状态 | 2h |
| [x] | S1.06 | **API: POST /api/disconnect** | FE | S1.01 | 请求后串口断开，幂等（未连接时也返回 success） | 1h |
| [x] | S1.07 | **API: GET /api/log** | FE | S1.01 | `?lines=10` 返回最近 10 行日志，含 `totalBuffered` | 1h |
| [x] | S1.08 | **API: POST /api/send** | FE | S1.01 | 支持 `{ data, hexMode, lineEnding }` 参数，串口收到数据 | 1.5h |
| [x] | S1.09 | **API: POST /api/clear** | FE | S1.01 | 清空后 GET /api/log 返回空数组，RX/TX 计数器重置 | 0.5h |
| [x] | S1.10 | **Token 认证中间件** | FE | S1.02 | 无 token / 错误 token 返回 `401 Unauthorized` | 1.5h |

#### 1B. MCP Server 接入（BE 负责）

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S1.11 | **HTTP Client 封装**：`bridgeRequest(method, path, body?)` 通用函数 | BE | S1.02 | 读取 `bridge.json` 获取 port/token，能请求任意 API | 3h |
| [x] | S1.12 | **Tool: list_serial_ports** → `GET /api/ports` | BE | S1.11, S1.04 | AI 调用返回真实串口列表 | 1h |
| [x] | S1.13 | **Tool: connect_serial** → `POST /api/connect` | BE | S1.11, S1.05 | AI 调用后串口连接成功 | 1h |
| [x] | S1.14 | **Tool: disconnect_serial** → `POST /api/disconnect` | BE | S1.11, S1.06 | AI 调用后串口断开 | 0.5h |
| [x] | S1.15 | **Tool: read_serial_log** → `GET /api/log` | BE | S1.11, S1.07 | AI 调用返回日志内容 | 1h |
| [x] | S1.16 | **Tool: send_serial_data** → `POST /api/send` | BE | S1.11, S1.08 | AI 调用后串口收到数据 | 1h |
| [x] | S1.17 | **Tool: get_serial_status** → `GET /api/status` | BE | S1.11, S1.03 | AI 调用返回连接状态 | 0.5h |
| [x] | S1.18 | **Tool: clear_serial_log** → `POST /api/clear` | BE | S1.11, S1.09 | AI 调用后日志被清空 | 0.5h |

#### 1C. 联调与测试

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S1.19 | **Windsurf 联调**：配置 `mcp_config.json`，在 Cascade 中测试 8 个基础 Tool | BE+FE | S1.12~S1.18 | AI 能列出串口、连接、读取日志、发送数据 | 2h |
| [x] | S1.20 | **Bridge API 单元测试** | QA | S1.03~S1.09 | 覆盖所有 API 端点的正常/异常场景（含 401） | 4h |

---

### Sprint 2：Wait 机制 + 闭环验证（Day 8-12）

> **目标**：实现 `wait_for_output` 等待机制，跑通完整闭环
> **Definition of Done**：AI 执行 clear → 提示烧录 → wait_for_output 匹配成功 → 读取日志并输出分析

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S2.01 | **SerialManager 新增日志订阅**：`subscribeNewLog(cb)` / `unsubscribeNewLog(cb)` | FE | S0.03 | wait API 能增量监听新日志，不依赖轮询 | 3h |
| [x] | S2.02 | **API: GET /api/log/wait**：支持 `pattern` + `timeout` + `fromNow` 参数 | FE | S1.01, S2.01 | pattern 匹配后立即返回 `{ found: true }`；超时返回 `{ found: false }` + 已收集日志 | 10h |
| [x] | S2.03 | **Tool: wait_for_output** → `GET /api/log/wait` | BE | S2.02, S1.11 | AI 调用后阻塞直到匹配或超时 | 2h |
| [x] | S2.04 | **HTTP Client 动态超时**：wait_for_output 的 HTTP 超时 = `timeout + 5s` 余量 | BE | S2.03 | 不会因 HTTP 超时早于 wait 超时导致误报 | 1h |
| [x] | S2.05 | **Bridge Server 优雅关闭**：deactivate 时等待进行中的 wait 请求完成 | FE | S2.02 | 扩展关闭不会导致 MCP 侧收到连接重置错误 | 2h |
| [x] | S2.06 | **MCP 错误处理增强**：Bridge 不可达时返回 `isError: true` + 友好提示 | BE | S1.11 | 提示内容："请打开 VS Code 并确认 Serial Pilot 已激活" | 2h |
| [x] | S2.07 | **端到端闭环测试（ESP32/STM32）** | QA | S2.03 | 完整流程跑通：clear → 提示烧录 → wait → read_log → 验证 | 8h |

---

### Sprint 3：AI 提示词工程（Day 13-16）

> **目标**：编写 AI Rules，让 AI 能自主完成嵌入式调试闭环
> **Definition of Done**：故意引入 Bug，AI 通过日志自动定位并修复，3 个测试场景成功 ≥ 2 个

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [x] | S3.01 | **编写 `.windsurf/rules/serialpilot.md`**：完整调试工作流规则 | PE | S2.03 | 包含 Tool 使用指南、标准工作流、安全约束 | 4h |
| [x] | S3.02 | **标准调试工作流定义**：check_status → clear → prompt_flash → wait → read → analyze → loop | PE | S3.01 | 工作流在 ≥ 3 个场景中正确运行 | 3h |
| [x] | S3.03 | **错误模式知识库**：ESP32/STM32 常见错误（Panic/HardFault/Watchdog/StackOverflow 等） | PE | — | 涵盖 ≥ 10 种常见错误的分析模板 | 4h |
| [x] | S3.04 | **安全约束**：最大重试 3 次、超时处理、不确定时询问用户 | PE | S3.01 | AI 在 3 次失败后停止重试并汇报用户 | 2h |
| [x] | S3.05 | **Windsurf 实战测试**：故意引入 Bug，验证 AI 闭环修复能力 | PE+QA | S3.02 | 3 个场景中 AI 至少成功修复 2 个 | 6h |
| [ ] | S3.06 | **Cursor 适配验证**：确认 MCP Server 在 Cursor 中可用 | BE | S2.03 | Cursor Agent 能调用所有 Tool 并获得正确结果 | 2h |

---

### Sprint 4：产品化 + 发布 v0.9.0-beta（Day 17-25）

> **目标**：安全加固、配置自动化、文档完善、打包发布
> **Definition of Done**：新用户按文档操作能在 30 分钟内跑通完整闭环

| 状态 | ID | 任务 | Owner | 依赖 | 验收标准 | 预估 |
|------|----|------|-------|------|---------|------|
| [ ] | S4.01 | **安全加固最终审查**：确认 127.0.0.1 绑定 + Token 认证 + 文件权限 | FE | S1.10 | 安全审计通过 | 2h |
| [ ] | S4.02 | **命令 `serialpilot.configureMCP`**：生成 MCP 配置片段到剪贴板 + 打开 IDE 设置页引导用户粘贴 | FE | — | 命令执行后配置 JSON 已在剪贴板，提示用户粘贴位置 | 2h |
| [ ] | S4.03 | **扩展设置项**：`serialpilot.bridge.port`（可选固定端口）、`serialpilot.bridge.enabled`（开关） | FE | S1.01 | 用户可在 VS Code Settings 中配置 | 2h |
| [ ] | S4.04 | **MCP Server 独立构建**：产出独立可运行的 `dist/index.js` | BE | — | `node dist/index.js` 可直接运行 | 2h |
| [ ] | S4.05 | **更新项目 README.md**：安装指南 + 配置说明 + 工作流演示 + FAQ | PM | S3.01 | 新用户按文档 30 分钟跑通 | 4h |
| [ ] | S4.06 | **更新 serialpilot-vscode/README.md**：扩展详情页内容 | PM | S4.05 | 扩展详情页显示完整功能介绍 | 2h |
| [ ] | S4.07 | **VSIX 打包 v0.9.0-beta** | FE | S4.01~S4.03 | 安装后全部功能正常 | 1h |
| [ ] | S4.08 | **MCP Server 打包 + 安装说明** | BE | S4.04 | 用户能按说明配置并运行 | 1h |
| [ ] | S4.09 | **回归测试**：全量功能验证 | QA | S4.07, S4.08 | Webview 功能 + 所有 MCP Tool + 闭环测试 通过 | 4h |
| [ ] | S4.10 | **Release Notes** | PM | S4.09 | 包含新功能列表、已知限制、升级指南 | 1h |

---

## 五、里程碑

```
Day 1-2          Day 3-7          Day 8-12         Day 13-16        Day 17-25
  │                │                │                │                │
  S0               S1               S2               S3               S4
  工程准备          Bridge + MCP     Wait + 闭环       AI Rules         产品化
  │                │                │                │                │
  ▼                ▼                ▼                ▼                ▼
  M0               M1               M2               M3               M4
```

| 里程碑 | 验收时间 | 验收标准 | 验收人 |
|--------|---------|---------|--------|
| **M0: 工程就绪** | Day 2 | `npm install` + `tsc` 通过，core 已废弃，测试框架可运行 | PM |
| **M1: Bridge 可用** | Day 7 | AI 通过 MCP 成功列出串口、连接、读取 ≥ 3 行真实串口日志 | PM+FE |
| **M2: 闭环验证** | Day 12 | 完整流程：AI clear → 用户烧录 → AI wait 成功 → AI 读取并分析日志 | PM+QA |
| **M3: AI 自主调试** | Day 16 | AI 能根据串口日志错误信息自动修改代码并提示重新烧录，≥ 2/3 测试通过 | PM+PE |
| **M4: v0.9.0-beta** | Day 25 | VSIX + MCP Server 打包完成，文档齐全，回归测试通过 | PM |

---

## 六、工时统计

| Sprint | FE 工时 | BE 工时 | QA 工时 | PE 工时 | PM 工时 | 合计 |
|--------|---------|---------|---------|---------|---------|------|
| S0 | 1h | 0.5h | 4h | — | — | 5.5h |
| S1 | 17.5h | 9.5h | 4h | — | — | 31h |
| S2 | 15h | 5h | 8h | — | — | 28h |
| S3 | — | 2h | — | 19h | — | 21h |
| S4 | 7h | 3h | 4h | — | 7h | 21h |
| **合计** | **40.5h** | **20h** | **20h** | **19h** | **7h** | **106.5h** |

---

## 七、风险追踪

| ID | 风险 | 概率 | 影响 | 等级 | 缓解措施 | Owner | 状态 |
|----|------|------|------|------|---------|-------|------|
| R01 | 串口被其他软件占用 | 高 | 中 | 🟡 | API 返回明确错误，AI 提示用户关闭占用软件 | FE | Open |
| R02 | Bridge Server 端口冲突 | 低 | 中 | 🟢 | 使用 `port=0` 让 OS 分配随机端口 | FE | Open |
| R03 | 扩展未启动时 MCP 调用 | 高 | 中 | 🟡 | MCP 返回 `isError: true` + 提示启动扩展 | BE | Open |
| R04 | AI 误判日志含义 | 中 | 高 | 🟡 | Rules 明确"不确定时询问用户"，最大重试 3 次 | PE | Open |
| R05 | wait_for_output 超时 | 中 | 中 | 🟡 | 超时返回已收集日志 + 提示信息 | FE+BE | Open |
| R06 | serialport 原生模块加载失败 | 低 | 高 | 🟡 | 已有懒加载防御；VSIX 含预编译二进制 | FE | Open |
| R07 | 发现文件被误删 | 低 | 低 | 🟢 | MCP 检测文件不存在时给出明确提示 | BE | Open |
| R08 | 多 VS Code 窗口同时运行 | 中 | 中 | 🟡 | 发现文件含 `instanceId` 区分实例，后启动覆盖（last-writer-wins） | FE | Open |
| R09 | macOS/Linux 串口权限不足 | 中 | 中 | 🟡 | API 返回明确权限错误，README 包含各平台配置指南 | QA | Open |

---

## 八、MVP 工作流参考

```
User: "帮我实现一个 LED 闪烁功能，500ms 间隔"

AI (Windsurf Cascade):
  1. 写代码 → 生成 main.c / freertos.c
  2. get_serial_status → 确认串口已连接
  3. clear_serial_log → 清空旧日志
  4. 告诉用户: "代码已生成，请编译烧录。烧录完成后我会自动读取串口日志。"
  5. wait_for_output(pattern="Ready", timeout=30)
     → 阻塞等待，用户此时编译 + 烧录
  6. 设备重启，串口输出 "System Ready"
  7. wait_for_output 返回: { found: true, matchedLine: "System Ready" }
  8. read_serial_log(lines=20) → 读取完整日志
  9. 分析日志:
     - 看到 "LED: GPIO5 configured" → 成功，汇报用户
     - 看到 "Error: Invalid GPIO" → 修改代码，回到步骤 2
  10. 最多重试 3 次，超过则汇报用户并停止
```

> 完整时序图见 `spec.md` §11.1

---

## 九、配置参考

### Windsurf MCP 配置

```json
// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "serialpilot": {
      "command": "node",
      "args": ["<项目路径>/packages/serialpilot-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

### 发现文件格式 (`~/.serialpilot/bridge.json`)

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

---

## 十、进度日志

> 按日期记录关键进展和决策变更，便于团队同步。

| 日期 | 事项 | 备注 |
|------|------|------|
| 2026-02-28 | 项目执行计划 v2.0 编写完成 | 对齐 spec.md v1.0，新增 Sprint 0、工时统计、风险追踪 |
| 2026-02-28 | **Sprint 0 全部完成** | S0.01~S0.05 全部通过验收：core 已废弃、依赖清理、vitest 框架搭建、MockSerialManager 测试桩（22 pass / 20 todo） |
| 2026-02-28 | **评估报告调整** | 采纳建议：关键任务工时上调、bridge.json 增加 instanceId、S4.02 改为剪贴板+引导、版本改 v0.9.0-beta、新增 R09 风险 |
| 2026-02-28 | **Sprint 1 全部完成** | S1.01~S1.20 全部通过：BridgeServer 提取为独立模块（bridge-server.ts + types.ts）、7 个 MCP Tool 接入 bridgeRequest、43 个测试通过。S1.19 Windsurf 联调成功：全部 7 个 Tool 在 Cascade 中返回正确结果 |
| 2026-02-28 | **Sprint 2 全部完成** | S2.01~S2.07 全部通过。S2.07 E2E 硬件测试：STM32 COM11 验证成功（list/connect/send ver/read Firmware Version/boot banner 捕获） |
| 2026-02-28 | **Sprint 3 完成** | S3.01~S3.05 全部通过。S3.05 实战验证：新增 AT 指令→烧录→闭环测试成功（send "at" → 返回 "ok"）。仅剩 S3.06 Cursor 适配（可选） |
| | | |
