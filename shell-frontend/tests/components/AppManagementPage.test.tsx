import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppManagementPage } from '../../src/components/AppManagementPage';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

const mockListApps = vi.fn();
const mockGetShellConfig = vi.fn();
const mockGetAppStates = vi.fn();
const mockResetAppSettings = vi.fn();
const mockSaveAppUserSettings = vi.fn();
const mockStartApp = vi.fn();
const mockStopApp = vi.fn();
const mockUninstallOfficialApp = vi.fn();
const mockGetDevToolsSettings = vi.fn();
const mockListOfficialApps = vi.fn();
const mockRefreshOfficialApps = vi.fn();
const mockListInstalledOfficialApps = vi.fn();
const mockInstallOfficialApp = vi.fn();
const mockUpdateOfficialApp = vi.fn();
const mockReadOfficialAppInstallLog = vi.fn();
const mockListOfficialAppReleases = vi.fn();

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    listApps: (...args: unknown[]) => mockListApps(...args),
    getShellConfig: (...args: unknown[]) => mockGetShellConfig(...args),
    getAppStates: (...args: unknown[]) => mockGetAppStates(...args),
    resetAppSettings: (...args: unknown[]) => mockResetAppSettings(...args),
    saveAppUserSettings: (...args: unknown[]) => mockSaveAppUserSettings(...args),
    startApp: (...args: unknown[]) => mockStartApp(...args),
    stopApp: (...args: unknown[]) => mockStopApp(...args),
    uninstallOfficialApp: (...args: unknown[]) => mockUninstallOfficialApp(...args),
    getDevToolsSettings: (...args: unknown[]) => mockGetDevToolsSettings(...args),
    saveDevToolsSettings: vi.fn(),
    listOfficialApps: (...args: unknown[]) => mockListOfficialApps(...args),
    refreshOfficialApps: (...args: unknown[]) => mockRefreshOfficialApps(...args),
    listInstalledOfficialApps: (...args: unknown[]) => mockListInstalledOfficialApps(...args),
    installOfficialApp: (...args: unknown[]) => mockInstallOfficialApp(...args),
    updateOfficialApp: (...args: unknown[]) => mockUpdateOfficialApp(...args),
    readOfficialAppInstallLog: (...args: unknown[]) => mockReadOfficialAppInstallLog(...args),
    listOfficialAppReleases: (...args: unknown[]) => mockListOfficialAppReleases(...args),
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
    mockStopApp.mockResolvedValue(undefined);
    mockUninstallOfficialApp.mockResolvedValue(undefined);
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: [] });
    mockListOfficialApps.mockResolvedValue([]);
    mockRefreshOfficialApps.mockResolvedValue([]);
    mockListInstalledOfficialApps.mockResolvedValue([]);
    mockInstallOfficialApp.mockResolvedValue(undefined);
    mockUpdateOfficialApp.mockResolvedValue(undefined);
    mockReadOfficialAppInstallLog.mockResolvedValue('');
    mockListOfficialAppReleases.mockResolvedValue([]);
    mockRefreshOfficialApps.mockImplementation(() => mockListOfficialApps());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('没有已安装应用时显示空状态', async () => {
    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('暂无已安装应用')).toBeInTheDocument());
  });

  it('首次打开应用管理会刷新官方市场以发现新版本', async () => {
    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    await waitFor(() => expect(mockRefreshOfficialApps).toHaveBeenCalledTimes(1));
  });

  it('官方应用卡片底部显示更新日志和更新入口', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '0.1.6',
        category: '效率',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43130' },
        process: {},
      },
    ]);
    mockListOfficialApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        description: '本地邮件管理',
        category: '效率',
        version: '0.1.7',
        icon: 'Mail',
        repository: 'http://dev03.ushopal.com:10083/ChenChuanFeng/atlas',
        revision: 'a'.repeat(40),
        runtime: 'binary',
        install: [],
        process: { command: ['mail-center'], working_directory: '.', ready_url: 'http://127.0.0.1:43130/health' },
        update_notes: '',
        update_available: true,
      },
    ]);
    mockListOfficialAppReleases.mockResolvedValue([
      {
        version: 'v0.1.7',
        title: 'v0.1.7',
        body: '修复同步问题',
        published_at: '2026-08-13T01:00:00Z',
        prerelease: false,
        url: 'http://dev03.ushopal.com:10083/ChenChuanFeng/atlas/-/releases/v0.1.7',
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '更新日志' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新 邮件管理 到 v0.1.7' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更新日志' }));
    expect(await screen.findByText('修复同步问题')).toBeInTheDocument();
    expect(mockListOfficialAppReleases).toHaveBeenCalledWith('official-mail');
  });

  it('内置应用在卡片底部显示图标设置入口，列表不直接显示重置按钮', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'with-settings',
        name: '有设置',
        description: '用于测试简介展示',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'builtin' },
      },
      {
        id: 'without-settings',
        name: '无设置',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'builtin' },
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    await screen.findByText('有设置');
    expect(screen.getByRole('button', { name: '有设置 设置' })).not.toHaveTextContent(
      '应用设置',
    );
    expect(screen.getByRole('button', { name: '无设置 设置' })).not.toHaveTextContent(
      '应用设置',
    );
    expect(screen.getByText('用于测试简介展示')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重置设置' })).not.toBeInTheDocument();
  });

  it('官方应用只在菜单中管理启动偏好，不提供壳内设置页', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);
    mockGetAppStates.mockResolvedValue([{ id: 'official-mail', status: 'running', pid: 123 }]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    await screen.findByText('邮件管理');
    expect(screen.queryByRole('button', { name: '邮件管理 设置' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('邮件管理')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '邮件管理 显示在主页' }));
    await waitFor(() =>
      expect(mockSaveAppUserSettings).toHaveBeenCalledWith('official-mail', {
        visible: false,
        startup_mode: 'manual',
      }),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: '随开搞启动' }));
    await waitFor(() =>
      expect(mockSaveAppUserSettings).toHaveBeenCalledWith('official-mail', {
        visible: false,
        startup_mode: 'with-aidea',
      }),
    );
  });

  it('启动中的应用显示统一生命周期状态', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);
    render(
      <AppManagementPage
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
        states={{ 'official-mail': { id: 'official-mail', status: 'starting', pid: null } }}
      />,
    );

    expect(await screen.findByText('启动中')).toBeInTheDocument();
  });

  it('启动中的应用不重复提供启动操作', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);

    render(
      <AppManagementPage
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
        states={{ 'official-mail': { id: 'official-mail', status: 'starting', pid: null } }}
      />,
    );

    fireEvent.keyDown(await screen.findByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });

    expect(await screen.findByRole('menuitem', { name: '启动中...' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('menuitem', { name: '启动' })).not.toBeInTheDocument();
  });

  it('启动失败后允许重试启动', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);

    render(
      <AppManagementPage
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
        states={{
          'official-mail': {
            id: 'official-mail',
            status: 'stopped',
            pid: null,
            issue: { level: 'warning', message: '端口已被占用', updated_at: 0 },
          },
        }}
      />,
    );

    fireEvent.keyDown(await screen.findByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });

    expect(await screen.findByRole('menuitem', { name: '重试启动' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '启动' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '重试启动' }));
    await waitFor(() => expect(mockStartApp).toHaveBeenCalledWith('official-mail'));
  });

  it('显示开关在悬浮 200ms 后说明其作用', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    const toggle = await screen.findByRole('switch', { name: '邮件管理 显示在主页' });
    vi.useFakeTimers();
    fireEvent.pointerMove(toggle);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(toggle).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('tooltip')).toHaveTextContent('显示在主页');
    vi.useRealTimers();
  });

  it('随开搞启动使用火箭图标', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });

    const startupItem = await screen.findByRole('menuitem', { name: '随开搞启动' });
    expect(startupItem.querySelector('.lucide-rocket')).not.toBeNull();
  });

  it('切换随开搞启动后保持更多菜单展开', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: '随开搞启动' }));

    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  });

  it('内置应用设置页通过显式注册表打开', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'dev-tools',
        name: 'DevTools',
        version: '1.0.0',
        category: '开发',
        status: 'active',
        ui: { mode: 'builtin' },
      },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'DevTools 设置' }));

    await waitFor(() => expect(mockGetDevToolsSettings).toHaveBeenCalled());
    expect(screen.getByRole('checkbox', { name: 'JSON 格式化' })).toBeChecked();
  });

  it('官方应用的进程和卸载操作收进更多菜单', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
        process: {},
      },
    ]);

    const onShowLog = vi.fn();
    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={onShowLog} />);

    expect(screen.queryByText('添加应用')).not.toBeInTheDocument();
    await screen.findByText('邮件管理');
    expect(screen.getByRole('button', { name: '邮件管理 更多操作' })).toBeInTheDocument();
  });

  it('统一显示已安装和可安装官方应用，并从对应位置执行操作', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        description: '本地邮件管理',
        version: '0.1.0',
        category: '效率',
        status: 'active',
        ui: { mode: 'webview', url: 'http://127.0.0.1:43130' },
        process: {},
      },
    ]);
    mockListOfficialApps.mockResolvedValue([
      {
        id: 'official-mail',
        name: '邮件管理',
        description: '本地邮件管理',
        category: '效率',
        version: '0.1.1',
        icon: 'Mail',
        repository: 'https://gitee.com/aidea-org/mail-manager.git',
        revision: 'a'.repeat(40),
        runtime: 'binary',
        install: [],
        artifact: {
          url: 'https://gitee.com/aidea-org/mail-manager/releases/download/v0.1.1/mail-center.tar.gz',
          sha256: 'b'.repeat(64),
        },
        process: {
          command: ['mail-center'],
          working_directory: '.',
          ready_url: 'http://127.0.0.1:43130/health',
        },
        update_notes: '修复同步',
        update_available: true,
        installed_version: '0.1.0',
      },
      {
        id: 'available-app',
        name: '待安装应用',
        description: '等待安装',
        category: '效率',
        version: '0.1.0',
        icon: 'Package',
        repository: 'https://gitee.com/aidea-org/available-app.git',
        revision: 'c'.repeat(40),
        runtime: 'binary',
        install: [],
        artifact: {
          url: 'https://gitee.com/aidea-org/available-app/releases/download/v0.1.0/available-app.tar.gz',
          sha256: 'd'.repeat(64),
        },
        process: {
          command: ['available-app'],
          working_directory: '.',
          ready_url: 'http://127.0.0.1:43131/health',
        },
        update_notes: '',
        update_available: false,
      },
    ]);
    mockListInstalledOfficialApps.mockResolvedValue([
      { id: 'official-mail', version: '0.1.0', revision: 'a'.repeat(40), status: 'installed' },
    ]);

    render(<AppManagementPage onAppsChanged={vi.fn()} onShowLog={vi.fn()} />);

    expect(await screen.findByText('可安装应用')).toBeInTheDocument();
    await screen.findByRole('button', { name: '安装 待安装应用' });
    expect(screen.getAllByText('邮件管理')).toHaveLength(1);
    expect(screen.getByText('待安装应用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装 待安装应用' })).toBeInTheDocument();
    const updateButton = screen.getByRole('button', { name: '更新 邮件管理 到 v0.1.1' });
    expect(updateButton).toBeInTheDocument();
    fireEvent.click(updateButton);
    await waitFor(() => expect(mockUpdateOfficialApp).toHaveBeenCalledWith('official-mail'));

    fireEvent.keyDown(screen.getByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: '更新' }));
    await waitFor(() => expect(mockUpdateOfficialApp).toHaveBeenCalledWith('official-mail'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '邮件管理 更多操作' })).toBeEnabled(),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: '卸载' }));
    expect(screen.getByRole('heading', { name: '确认卸载应用' })).toBeInTheDocument();
    expect(mockUninstallOfficialApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(mockUninstallOfficialApp).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: '邮件管理 更多操作' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: '卸载' }));
    fireEvent.click(screen.getByRole('button', { name: '确认卸载' }));
    await waitFor(() => expect(mockUninstallOfficialApp).toHaveBeenCalledWith('official-mail'));

    fireEvent.click(screen.getByRole('button', { name: '安装 待安装应用' }));
    await waitFor(() => expect(mockInstallOfficialApp).toHaveBeenCalledWith('available-app'));
  });

  it('按外部顺序显示应用并提供拖拽手柄', async () => {
    mockListApps.mockResolvedValue([
      {
        id: 'first',
        name: '第一个',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'builtin' },
      },
      {
        id: 'second',
        name: '第二个',
        version: '1.0.0',
        category: 'test',
        status: 'active',
        ui: { mode: 'builtin' },
      },
    ]);

    render(
      <AppManagementPage
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
        appOrder={['second', 'first']}
        onReorder={vi.fn()}
      />,
    );

    await screen.findByText('第二个');
    const names = screen.getAllByText(/第一个|第二个/).map((element) => element.textContent);
    expect(names).toEqual(['第二个', '第一个']);
    expect(screen.getAllByRole('button', { name: '拖动调整应用顺序' })).toHaveLength(2);
  });
});
