# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Serial Pilot is an AI-powered embedded serial debugging tool that enables AI to read serial logs, analyze issues, and form a debug loop. It consists of:
- **VS Code Extension** (`packages/serialpilot-vscode/`) — Serial monitor UI + Bridge Server (HTTP REST API)
- **MCP Server** (`packages/serialpilot-mcp/`) — Exposes serial tools to AI via MCP protocol
- **Keil Project** (`_KeilProject/`) — STM32F4 FreeRTOS test project

## Build Commands

```bash
# Build all workspaces
npm run build

# Build specific package
npm run build --workspace=packages/serialpilot-vscode
npm run build --workspace=packages/serialpilot-mcp

# Run tests
npm test                 # Single run
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage

# Clean build artifacts
npm run clean
```

## Architecture

```
AI IDE (Windsurf/Cursor)
    ↓ MCP Protocol (stdio)
serialpilot-mcp (MCP Server)
    ↓ HTTP REST (localhost)
serialpilot-vscode (Extension)
    ↓ serialport native binding
Hardware (STM32/ESP32)
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/serialpilot-vscode/src/extension.ts` | Extension entry point, Bridge Server, SerialManager |
| `packages/serialpilot-mcp/src/index.ts` | MCP Server implementation, 8 Tool definitions |
| `.windsurf/rules/serialpilot.md` | AI debugging workflow rules |
| `spec.md` | Full technical specification |

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_serial_status` | Check connection status |
| `list_serial_ports` | List available ports |
| `connect_serial` | Connect to port |
| `disconnect_serial` | Disconnect |
| `clear_serial_log` | Clear log buffer |
| `send_serial_data` | Send data to serial |
| `read_serial_log` | Read buffered logs |
| `wait_for_output` | Block until pattern matches |
| `send_and_wait` | Atomic send + wait for response |

## Development Notes

### Bridge Server
- Runs on random port (`127.0.0.1:0`), port written to `~/.serialpilot/bridge.json`
- Token authentication via `Authorization: Bearer <token>` header
- All responses are JSON

### Code Conventions
- TypeScript throughout
- VS Code extension uses webpack bundling
- MCP Server uses `@modelcontextprotocol/sdk` with Zod schemas
- User code regions marked with `/* USER CODE BEGIN */` and `/* USER CODE END */` (STM32 CubeMX style)

### Embedded Project
- MCU: STM32F411CEUx
- RTOS: FreeRTOS
- LED: PC13 (active-low)
- Button: PA0 (falling edge interrupt, internal pull-up)