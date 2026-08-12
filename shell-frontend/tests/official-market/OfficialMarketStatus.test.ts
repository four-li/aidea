import { describe, expect, it } from 'vitest';
import { appActionLabel } from '../../src/builtin-apps/official-market';
import type { OfficialApp } from '../../src/types/official-app';

const app: OfficialApp = {
  id: 'demo',
  name: 'Demo',
  description: 'demo',
  category: 'tools',
  version: '0.1.0',
  icon: 'Package',
  repository: 'https://example.com/demo.git',
  revision: 'a'.repeat(40),
  runtime: 'node',
  install: [],
  process: { command: ['node', 'server.js'], working_directory: '.', ready_url: 'http://127.0.0.1:43120/health' },
  update_notes: '',
  update_available: false,
};

describe('appActionLabel', () => {
  it('未安装显示安装，已安装且没有新版本显示已安装', () => {
    expect(appActionLabel({ ...app, update_available: false }, false)).toBe('安装');
    expect(appActionLabel({ ...app, update_available: false }, true)).toBe('已安装');
  });

  it('市场版本更高时显示更新', () => {
    expect(appActionLabel({ ...app, update_available: true }, true)).toBe('更新');
  });
});
