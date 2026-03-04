/**
 * MCP Tool 集成测试
 *
 * 测试 MCP Server 的 Tool 实现是否正确调用 Bridge Server API。
 * 使用 Mock HTTP Server 模拟 Bridge Server 响应。
 *
 * 对应 spec.md §8.2 MCP Tool 测试用例 (T-M01 ~ T-M05)
 * 对应 Plan.md S1.19
 *
 * 当前阶段 (S0.04)：框架验证 — 仅包含空测试用例
 * Sprint 1 实现 MCP Tool 后，在此填充完整测试逻辑
 */

import { describe, it, expect } from 'vitest';

describe('MCP Tool Integration', () => {

  describe('Bridge 不可达场景', () => {
    it.todo('T-M01: Bridge 未启动时调用 Tool 应返回 isError: true');
    it.todo('T-M02: 发现文件不存在时调用 Tool 应返回友好提示');
  });

  describe('正常调用场景', () => {
    it.todo('T-M03: list_serial_ports 应返回串口列表文本');
    it.todo('T-M04: connect_serial + read_serial_log 组合调用应返回日志');
    it.todo('T-M05: wait_for_output + 设备输出匹配应返回成功');
  });

  // 框架验证
  it('vitest 框架验证：MCP Tool 测试基础设施正常', () => {
    expect(typeof describe).toBe('function');
    expect(typeof it).toBe('function');
  });
});
