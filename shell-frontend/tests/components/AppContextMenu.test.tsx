import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextMenu } from '../../src/components/AppContextMenu';

const mockStartApp = vi.fn();

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    startApp: (...args: unknown[]) => mockStartApp(...args),
    stopApp: vi.fn(),
  },
}));

describe('AppContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartApp.mockResolvedValue(123);
  });

  it('启动失败后允许重试启动', async () => {
    render(
      <AppContextMenu
        app={{
          id: 'official-mail',
          name: '邮件管理',
          version: '1.0.0',
          category: 'test',
          status: 'active',
          ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
          process: {},
          issue: { level: 'warning', message: '端口已被占用', updated_at: 0 },
        }}
        state={{ id: 'official-mail', status: 'stopped', pid: null }}
        onRefresh={vi.fn()}
        onShowLog={vi.fn()}
      >
        <button type="button">邮件管理</button>
      </AppContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '邮件管理' }));

    expect(await screen.findByRole('menuitem', { name: '重试启动' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '重试启动' }));
    await waitFor(() => expect(mockStartApp).toHaveBeenCalledWith('official-mail'));
  });

  it('内置应用右键不显示空菜单', () => {
    render(
      <AppContextMenu
        app={{
          id: 'dev-tools',
          name: 'DevTools',
          version: '1.0.0',
          category: 'test',
          status: 'active',
          ui: { mode: 'builtin' },
        }}
        onRefresh={vi.fn()}
        onShowLog={vi.fn()}
      >
        <button type="button">DevTools</button>
      </AppContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'DevTools' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
