import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { DebugPage } from '../../src/components/DebugPage';

describe('调试页', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'list_diagnostic_summaries') {
        return Promise.resolve([
          { scope: 'aidea', app_id: null, warn_count: 1 },
          { scope: 'official', app_id: 'mail-center', warn_count: 2 },
        ]);
      }
      if (command === 'read_diagnostic_log') return Promise.resolve('2026-08-16 02:48:04  ERROR  process  启动失败\n');
      return Promise.resolve(undefined);
    });
  });

  it('按来源展示应用并读取预选应用的平台事件', async () => {
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <DebugPage
        apps={[
          {
            id: 'mail-center',
            name: '邮件中心',
            category: '效率',
            version: '0.2.0',
            status: 'active',
            ui: { mode: 'webview', url: 'http://127.0.0.1:43130' },
          },
        ]}
        initialTarget={{ scope: 'official', appId: 'mail-center' }}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect((await screen.findAllByText('邮件中心')).length).toBe(2);
    const settingsButton = screen.getByRole('button', { name: '打开日志设置' });
    expect(settingsButton).toHaveClass('h-9', 'w-9');
    fireEvent.click(settingsButton);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    const backButton = screen.getByRole('button', { name: '返回主页面' });
    expect(backButton).toHaveClass('h-9', 'w-9');
    fireEvent.click(backButton);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('.lucide-bug')).toHaveClass('text-muted-foreground');
    expect(screen.getByRole('heading', { name: 'aIdea' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '内置应用' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '官方应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^邮件中心/ })).toBeInTheDocument();
    expect(screen.getByText('2 条 WARN 及以上 · 最近 200 行')).toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('read_diagnostic_log', {
        request: { scope: 'official', app_id: 'mail-center', channel: 'runtime' },
      }),
    );
    expect(await screen.findByText(/启动失败/)).toBeInTheDocument();
  });
});
