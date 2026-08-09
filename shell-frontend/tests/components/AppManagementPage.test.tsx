import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppManagementPage } from '../../src/components/AppManagementPage';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

const mockListApps = vi.fn();
const mockGetShellConfig = vi.fn();
const mockGetAppStates = vi.fn();
const mockResetAppSettings = vi.fn();
const mockSaveAppUserSettings = vi.fn();
const mockStartApp = vi.fn();

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    listApps: (...args: unknown[]) => mockListApps(...args),
    getShellConfig: (...args: unknown[]) => mockGetShellConfig(...args),
    getAppStates: (...args: unknown[]) => mockGetAppStates(...args),
    resetAppSettings: (...args: unknown[]) => mockResetAppSettings(...args),
    saveAppUserSettings: (...args: unknown[]) => mockSaveAppUserSettings(...args),
    startApp: (...args: unknown[]) => mockStartApp(...args),
  },
}));

describe('AppManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListApps.mockResolvedValue([]);
    mockGetShellConfig.mockResolvedValue({ app_settings: {} });
    mockGetAppStates.mockResolvedValue([]);
    mockResetAppSettings.mockResolvedValue(undefined);
    mockSaveAppUserSettings.mockResolvedValue(undefined);
    mockStartApp.mockResolvedValue(123);
  });

  it('没有已安装应用时显示空状态', async () => {
    render(
      <AppManagementPage onAppsChanged={vi.fn()} onOpenMarket={vi.fn()} onShowLog={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText('暂无已安装应用')).toBeInTheDocument());
  });

  it('每个应用都有设置入口，列表不直接显示重置按钮', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'with-settings',
        name: '有设置',
        version: '1.0.0',
        category: 'test',
        path: '',
        status: 'active',
        ui: { mode: 'builtin' },
        settings: { enabled: true },
      },
      {
        id: 'without-settings',
        name: '无设置',
        version: '1.0.0',
        category: 'test',
        path: '',
        status: 'active',
        ui: { mode: 'builtin' },
      },
    ]);

    render(
      <AppManagementPage onAppsChanged={vi.fn()} onOpenMarket={vi.fn()} onShowLog={vi.fn()} />,
    );

    await screen.findByText('有设置');
    expect(screen.getByRole('button', { name: '有设置 设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '无设置 设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重置设置' })).not.toBeInTheDocument();
  });

  it('进入应用详情后显示自启动和详情页内的重置按钮', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        path: '/tmp/mail',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: { start: 'mail', stop: 'SIGTERM', autostart: false },
        settings: { enabled: true, reset_command: ['node', 'reset.js'] },
      },
    ]);
    mockGetAppStates.mockResolvedValue([{ id: 'official-mail', status: 'running', pid: 123 }]);

    render(
      <AppManagementPage onAppsChanged={vi.fn()} onOpenMarket={vi.fn()} onShowLog={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '邮件管理 设置' }));

    expect(await screen.findByText('邮件管理设置')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '邮件管理 随 aIdea 启动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回应用管理' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '邮件管理 日志' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByRole('heading', { name: '确认重置应用配置' })).toBeInTheDocument();
    expect(
      screen.getByText('重置后将清除当前应用的所有用户配置，并恢复默认设置。此操作不可撤销。'),
    ).toBeInTheDocument();
    expect(mockResetAppSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mockResetAppSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }));
    await waitFor(() => expect(mockResetAppSettings).toHaveBeenCalledWith('official-mail'));
  });

  it('停止的官方应用进入设置前会先启动应用', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        path: '/tmp/mail',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: { start: 'mail', stop: 'SIGTERM', autostart: false },
        settings: { enabled: true },
      },
    ]);
    mockGetAppStates
      .mockResolvedValueOnce([{ id: 'official-mail', status: 'stopped', pid: null }])
      .mockResolvedValue([{ id: 'official-mail', status: 'running', pid: 123 }]);

    render(
      <AppManagementPage onAppsChanged={vi.fn()} onOpenMarket={vi.fn()} onShowLog={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '邮件管理 设置' }));

    await waitFor(() => expect(mockStartApp).toHaveBeenCalledWith('official-mail'));
    expect(await screen.findByText('邮件管理设置')).toBeInTheDocument();
  });
});
