# Serial Pilot — VS Code Serial Monitor

> AI 驱动的嵌入式串口调试助手，让 AI 能读串口日志、分析代码问题、形成调试闭环。

Serial Pilot 是一个 VS Code 侧边栏扩展，提供完整的串口监视器功能，专为嵌入式开发设计。它与 Serial Pilot MCP Server 协同，实现 **"写代码 → 烧录 → 读串口 → AI 分析 → 改代码"** 的自动化调试闭环。

## 功能特性

### 串口连接

- **自动扫描** — 启动时自动列出可用串口，支持手动刷新
- **完整参数** — 波特率（支持手动输入任意值）、数据位、校验位、停止位
- **自动重连** — 设备拔出后重插自动恢复连接
- **状态指示** — 侧边栏面板 + VS Code 底部状态栏双重显示连接状态

### 日志显示

- **实时接收** — 基于原始 `data` 事件，低延迟逐行输出
- **HEX 接收** — 独立的 HEX Recv 开关，以十六进制格式显示接收数据
- **时间戳** — 可选为每行日志添加毫秒级时间戳
- **高性能** — 后端 5000 行环形缓冲 + 前端 500 行 DOM 裁剪，防止内存溢出
- **RX/TX 计数** — 实时显示收发字节数

### 数据发送

- **多行输入** — textarea 支持多行编辑，`Enter` 换行，`Ctrl+Enter`（macOS: `Cmd+Enter`）发送
- **发送保留** — 发送后内容不清空，选中全部文本方便重复发送
- **HEX 发送** — 独立的 HEX Send 开关，支持 `41 42 0D 0A` 格式发送原始字节
- **发送历史** — 最近 20 条记录，下拉选择快速复用
- **换行符选择** — 支持 LF / CRLF / CR / None 四种模式

### 界面设计

- **可调布局** — 日志区与发送区之间有拖拽分隔条，可自由调整比例
- **配置持久化** — 串口参数、显示选项、发送历史跨会话保存
- **发送内容持久化** — textarea 内容通过 `setState/getState` 保留
- **主题适配** — 完全跟随 VS Code 主题（亮色 / 暗色 / 高对比度）

## 安装

### 从 VSIX 安装

```bash
# 在项目根目录构建打包
cd packages/serialpilot-vscode
node pack.js

# 安装到 VS Code
code --install-extension serialpilot-vscode-x.x.x.vsix
```

### 从源码开发

```bash
# 安装依赖（在 monorepo 根目录）
npm install

# 构建
cd packages/serialpilot-vscode
npx webpack --config webpack.config.js

# 在 VS Code 中按 F5 启动调试
```

## 使用方法

1. 打开 VS Code 侧边栏，找到 **Serial Pilot: Serial Monitor** 面板
2. 从 **Port** 下拉框选择串口（点击刷新按钮刷新列表）
3. 设置波特率（默认 115200），如需修改高级参数可展开 **Advanced**
4. 点击 **Open** 连接串口
5. 日志区域实时显示接收数据
6. 在底部 textarea 输入命令，`Ctrl+Enter` 发送

## 技术架构

```
extension.ts (Extension Host)
|-- SerialManager        — 串口管理（连接/断开/收发/重连）
|-- SerialPanelProvider  — Webview 生命周期 + 消息路由
|-- StatusBar            — VS Code 底部状态栏集成
|-- GlobalState          — 配置 & 发送历史持久化

media/
|-- main.js              — Webview 前端脚本（UI 交互 + 消息通信）
|-- main.css             — 主样式（响应式布局 + VS Code 主题变量）
|-- reset.css            — CSS Reset
|-- vscode.css           — VS Code Webview 基础样式
```

### 通信机制

Extension Host 与 Webview 之间通过 `postMessage` 双向通信：

| 方向 | 消息类型 | 说明 |
|------|----------|------|
| Webview -> Extension | `refreshPorts` | 请求刷新串口列表 |
| Webview -> Extension | `connect` / `disconnect` | 连接/断开串口 |
| Webview -> Extension | `sendData` | 发送数据（含 `hexSend` 标志） |
| Webview -> Extension | `updateSettings` | 更新显示设置 |
| Webview -> Extension | `saveSendHistory` | 持久化发送历史 |
| Extension -> Webview | `updatePorts` | 返回串口列表 |
| Extension -> Webview | `updateStatus` | 连接状态变更 |
| Extension -> Webview | `appendLog` | 追加日志文本 |
| Extension -> Webview | `updateCounters` | RX/TX 字节计数 |
| Extension -> Webview | `restoreConfig` | 恢复持久化配置 |

## 依赖

- **[serialport](https://serialport.io/)** — Node.js 串口库（含原生 `.node` 二进制）
- **VS Code ^1.85.0** — Webview View API

## 项目路线

Serial Pilot 项目的最终目标是让 AI 深度参与嵌入式调试：

- [x] **Phase 1** — VS Code 串口监视器基础功能
- [ ] **Phase 2** — MCP Server 集成，暴露串口 Tool 给 AI
- [ ] **Phase 3** — AI 自动分析串口日志，定位代码问题
- [ ] **Phase 4** — 完整调试闭环（写代码 -> 烧录 -> 读日志 -> AI 修复）

## License

MIT