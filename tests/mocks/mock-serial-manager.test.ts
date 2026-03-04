/**
 * MockSerialManager 自身行为验证
 *
 * 确保 Mock 测试桩正确模拟 SerialManager 的核心行为，
 * 以便 Sprint 1 中 Bridge API 测试可以放心使用。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockSerialManager } from './mock-serial-manager';

describe('MockSerialManager', () => {
  let mock: MockSerialManager;

  beforeEach(() => {
    mock = new MockSerialManager();
    mock.setMockPorts([
      { path: 'COM3', manufacturer: 'Silicon Labs', vendorId: '10C4', productId: 'EA60' },
      { path: 'COM5', manufacturer: 'FTDI' },
    ]);
  });

  // ---- listPorts ----

  describe('listPorts', () => {
    it('应返回注入的模拟串口列表', async () => {
      const ports = await mock.listPorts();
      expect(ports).toHaveLength(2);
      expect(ports[0].path).toBe('COM3');
      expect(ports[1].manufacturer).toBe('FTDI');
    });

    it('未注入时应返回空列表', async () => {
      const emptyMock = new MockSerialManager();
      const ports = await emptyMock.listPorts();
      expect(ports).toHaveLength(0);
    });
  });

  // ---- connect / disconnect ----

  describe('connect / disconnect', () => {
    it('应能成功连接已知端口', async () => {
      const ok = await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      expect(ok).toBe(true);
      expect(mock.isConnected).toBe(true);
      expect(mock.currentPath).toBe('COM3');
      expect(mock.currentBaudRate).toBe(115200);
    });

    it('空端口应连接失败', async () => {
      const ok = await mock.connect({
        port: '', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      expect(ok).toBe(false);
      expect(mock.isConnected).toBe(false);
    });

    it('设置失败端口应连接失败', async () => {
      mock.setPortFail('COM3');
      const ok = await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      expect(ok).toBe(false);
    });

    it('断开后 isConnected 应为 false', async () => {
      await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      await mock.disconnect();
      expect(mock.isConnected).toBe(false);
    });

    it('重复连接应先断开旧连接', async () => {
      const cfg = {
        port: 'COM3', baudRate: 115200, dataBits: 8 as const,
        parity: 'none' as const, stopBits: 1 as const, lineEnding: 'lf' as const,
        showTimestamp: false, hexMode: false,
      };
      await mock.connect(cfg);
      await mock.connect({ ...cfg, port: 'COM5', baudRate: 9600 });
      expect(mock.isConnected).toBe(true);
      expect(mock.currentPath).toBe('COM5');
      expect(mock.currentBaudRate).toBe(9600);
    });
  });

  // ---- 日志缓冲区 ----

  describe('日志缓冲区', () => {
    it('simulateLog 应添加日志到缓冲区', () => {
      mock.simulateLog('System Ready');
      mock.simulateLog('LED ON');
      const logs = mock.getLogBuffer();
      expect(logs).toEqual(['System Ready', 'LED ON']);
    });

    it('simulateLogs 应批量添加日志', () => {
      mock.simulateLogs(['Booting...', 'Init OK', 'System Ready']);
      expect(mock.getLogBuffer()).toHaveLength(3);
    });

    it('getLogBuffer 应返回副本（不影响内部状态）', () => {
      mock.simulateLog('line1');
      const buf = mock.getLogBuffer();
      buf.push('tampered');
      expect(mock.getLogBuffer()).toHaveLength(1);
    });

    it('clearLog 应清空缓冲区', () => {
      mock.simulateLogs(['a', 'b', 'c']);
      mock.clearLog();
      expect(mock.getLogBuffer()).toHaveLength(0);
    });
  });

  // ---- 发送数据 ----

  describe('send', () => {
    beforeEach(async () => {
      await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
    });

    it('连接后应能成功发送文本数据', async () => {
      const ok = await mock.send('AT+RST', false, 'crlf');
      expect(ok).toBe(true);
      expect(mock.txBytes).toBeGreaterThan(0);
      expect(mock.getSendHistory()).toHaveLength(1);
      expect(mock.getSendHistory()[0].data).toBe('AT+RST');
    });

    it('未连接时发送应返回 false', async () => {
      await mock.disconnect();
      const ok = await mock.send('test', false, 'lf');
      expect(ok).toBe(false);
    });

    it('无效 HEX 数据应返回 false', async () => {
      const ok = await mock.send('ZZ', true, 'none');
      expect(ok).toBe(false);
    });

    it('有效 HEX 数据应发送成功', async () => {
      const ok = await mock.send('41 42 0D 0A', true, 'none');
      expect(ok).toBe(true);
      expect(mock.txBytes).toBe(4);
    });
  });

  // ---- 计数器 ----

  describe('计数器', () => {
    it('simulateLog 应增加 rxBytes', () => {
      mock.simulateLog('Hello');
      expect(mock.rxBytes).toBeGreaterThan(0);
    });

    it('resetCounters 应重置 RX/TX', async () => {
      mock.simulateLog('data');
      await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      await mock.send('test', false, 'lf');
      mock.resetCounters();
      expect(mock.rxBytes).toBe(0);
      expect(mock.txBytes).toBe(0);
    });
  });

  // ---- 新日志订阅 ----

  describe('新日志订阅（onNewLog / offNewLog）', () => {
    it('订阅后 simulateLog 应触发回调', () => {
      const received: string[] = [];
      mock.onNewLog((line) => received.push(line));
      mock.simulateLog('event1');
      mock.simulateLog('event2');
      expect(received).toEqual(['event1', 'event2']);
    });

    it('取消订阅后不再触发回调', () => {
      const received: string[] = [];
      const cb = (line: string) => received.push(line);
      mock.onNewLog(cb);
      mock.simulateLog('before');
      mock.offNewLog(cb);
      mock.simulateLog('after');
      expect(received).toEqual(['before']);
    });
  });

  // ---- reset ----

  describe('reset', () => {
    it('reset 应恢复所有状态到初始值', async () => {
      mock.simulateLogs(['a', 'b']);
      await mock.connect({
        port: 'COM3', baudRate: 115200, dataBits: 8,
        parity: 'none', stopBits: 1, lineEnding: 'lf',
        showTimestamp: false, hexMode: false,
      });
      await mock.send('test', false, 'lf');
      mock.setPortFail('COM3');

      mock.reset();

      expect(mock.isConnected).toBe(false);
      expect(mock.getLogBuffer()).toHaveLength(0);
      expect(mock.rxBytes).toBe(0);
      expect(mock.txBytes).toBe(0);
      expect(mock.getSendHistory()).toHaveLength(0);
      expect(await mock.listPorts()).toHaveLength(0);
    });
  });
});
