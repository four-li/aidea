import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadVisibleApps } from '../src/lib/manifest-loader';
import type { AppManifest } from '../src/types/manifest';

// mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('loadVisibleApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只返回 status=active 的子应用', async () => {
    const mockApps: AppManifest[] = [
      {
        id: 'sample-app',
        name: '示例应用',
        version: '0.1.0',
        category: 'dev-workflow',
        path: '/tmp/sample-app',
        status: 'active',
        ui: { mode: 'webview', url: 'http://localhost:5317' },
        process: {
          start: 'python -m engine.web.app',
          stop: 'SIGTERM',
          autostart: false,
        },
      },
      {
        id: 'legacy-tool',
        name: 'Legacy',
        version: '0.1.0',
        category: 'tools',
        path: '/some/legacy',
        status: 'disabled',
        ui: { mode: 'webview', url: 'http://localhost:9999' },
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(mockApps).mockResolvedValueOnce({ app_settings: {} });

    const result = await loadVisibleApps();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sample-app');
  });

  it('隐藏应用不会出现在可见应用列表', async () => {
    const mockApps: AppManifest[] = [
      {
        id: 'sample-app',
        name: '示例应用',
        version: '0.1.0',
        category: 'tools',
        path: '/tmp/sample-app',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:1' },
      },
    ];
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockApps)
      .mockResolvedValueOnce({
        app_settings: { 'sample-app': { visible: false, startup_mode: 'manual' } },
      });

    await expect(loadVisibleApps()).resolves.toEqual([]);
  });

  it('旧配置缺少 app_settings 时仍能加载应用', async () => {
    const mockApps: AppManifest[] = [
      {
        id: 'sample-app',
        name: '示例应用',
        version: '0.1.0',
        category: 'tools',
        path: '/tmp/sample-app',
        status: 'active',
        ui: { mode: 'builtin' },
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(mockApps).mockResolvedValueOnce({});

    await expect(loadVisibleApps()).resolves.toEqual(mockApps);
  });

  it('invoke 失败时抛出原始错误', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('IPC 调用失败'));
    await expect(loadVisibleApps()).rejects.toThrow('IPC 调用失败');
  });
});
