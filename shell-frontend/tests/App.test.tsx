import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  activeApp,
  mockDeliverDirectoryDrop,
  mockListApps,
  mockRecordBuiltinDiagnostic,
  mockSelectApp,
  nativeListeners,
  visibleApps,
} = vi.hoisted(() => ({
  activeApp: { id: 'hidden-app' },
  mockDeliverDirectoryDrop: vi.fn(),
  mockListApps: vi.fn(),
  mockRecordBuiltinDiagnostic: vi.fn<
    [id: string, source: string, level: string, event: string, message: string],
    Promise<void>
  >(() => Promise.resolve()),
  mockSelectApp: vi.fn(),
  nativeListeners: new Map<string, (event: { payload: unknown }) => void>(),
  visibleApps: [
    {
      id: 'home',
      name: '首页',
      version: '0.1.0',
      category: '工具',
      status: 'active' as const,
      ui: { mode: 'builtin' as const },
    },
    {
      id: 'dev-tools',
      name: 'DevTools',
      version: '0.3.3',
      category: '开发',
      status: 'active' as const,
      ui: { mode: 'builtin' as const },
    },
  ],
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
    nativeListeners.set(event, handler);
    return Promise.resolve(() => nativeListeners.delete(event));
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../src/components/TopBar', () => ({
  TopBar: ({
    onOpenDebug,
    onOpenDeveloperGuide,
  }: {
    onOpenDebug: () => void;
    onOpenDeveloperGuide: () => void;
  }) => (
    <div>
      <button type="button" onClick={onOpenDeveloperGuide}>
        打开开发手册
      </button>
      <button type="button" onClick={onOpenDebug}>
        打开调试
      </button>
    </div>
  ),
}));
vi.mock('../src/components/DebugPage', () => ({
  DebugPage: ({ onClose }: { onClose: () => void }) => (
    <div>
      调试页
      <button type="button" onClick={onClose}>
        返回主页面
      </button>
    </div>
  ),
}));
vi.mock('../src/components/LogWorkspace', () => ({
  LogWorkspace: () => null,
  targetFromManifest: (app: { id: string; name: string }) => ({
    scope: 'builtin',
    id: app.id,
    name: app.name,
  }),
}));
vi.mock('../src/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('../src/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('../src/components/ContentArea', () => ({
  ContentArea: ({
    activeApp,
    onBackToMain,
  }: {
    activeApp: { id: string } | null;
    onBackToMain: () => void;
  }) => (
    <div>
      {activeApp?.id ?? '没有活动应用'}
      <button type="button" onClick={onBackToMain}>
        返回主页面
      </button>
    </div>
  ),
}));
vi.mock('../src/hooks/useApps', () => ({
  useApps: () => ({
    apps: visibleApps,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useActiveApp', () => ({
  useActiveApp: () => ({ activeAppId: activeApp.id, selectApp: mockSelectApp }),
}));
vi.mock('../src/hooks/useProcessStatus', () => ({
  useProcessStatus: () => ({ states: {}, refresh: vi.fn() }),
}));
vi.mock('../src/hooks/useAppBridge', () => ({
  useAppBridge: () => ({ registerFrame: vi.fn(), deliverDirectoryDrop: mockDeliverDirectoryDrop }),
}));
vi.mock('../src/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));
vi.mock('../src/lib/ipc', () => ({
  ipc: {
    listApps: (...args: unknown[]) => mockListApps(...args),
    listAiServicePendingApprovals: vi.fn(() => Promise.resolve([])),
    resolveAiServiceApproval: vi.fn(() => Promise.resolve()),
    checkAideaUpdate: vi.fn(() => Promise.resolve(null)),
    recordBuiltinDiagnostic: (
      id: string,
      source: string,
      level: string,
      event: string,
      message: string,
    ) => mockRecordBuiltinDiagnostic(id, source, level, event, message),
    recordAideaDiagnostic: vi.fn(
      (_source: string, _level: string, _event: string, _message: string) => Promise.resolve(),
    ),
  },
}));

import App from '../src/App';

describe('主界面', () => {
  beforeEach(() => {
    mockListApps.mockClear();
    mockDeliverDirectoryDrop.mockClear();
    nativeListeners.clear();
  });

  it('仅在 Worktrace 是当前应用时转发原生目录拖入', async () => {
    activeApp.id = 'worktrace';
    mockListApps.mockResolvedValue([]);
    const firstView = render(<App />);

    await waitFor(() => expect(nativeListeners.get('aidea:directory-dropped')).toBeDefined());
    nativeListeners.get('aidea:directory-dropped')?.({ payload: { path: '/tmp/project' } });
    expect(mockDeliverDirectoryDrop).toHaveBeenCalledWith('/tmp/project');

    firstView.unmount();
    activeApp.id = 'dev-tools';
    render(<App />);
    await waitFor(() => expect(nativeListeners.get('aidea:directory-dropped')).toBeDefined());
    nativeListeners.get('aidea:directory-dropped')?.({ payload: { path: '/tmp/other-project' } });
    expect(mockDeliverDirectoryDrop).toHaveBeenCalledTimes(1);
  });

  it('未处理前端错误会记录到当前内置应用', async () => {
    activeApp.id = 'dev-tools';
    mockRecordBuiltinDiagnostic.mockClear();
    mockListApps.mockResolvedValue([]);
    render(<App />);

    window.dispatchEvent(new ErrorEvent('error', { message: 'render failed' }));
    await waitFor(() =>
      expect(mockRecordBuiltinDiagnostic).toHaveBeenCalledWith(
        'dev-tools',
        'frontend',
        'error',
        'frontend_unhandled_error',
        'render failed',
      ),
    );
  });

  it('不会把已隐藏应用的旧选中状态回退为开发手册', async () => {
    activeApp.id = 'hidden-app';
    mockListApps.mockResolvedValue([
      {
        id: 'developer-guide',
        name: '开发手册',
        version: '0.1.0',
        category: '开发',
        status: 'active',
        ui: { mode: 'builtin', entry: 'account-menu' },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(mockListApps).toHaveBeenCalledTimes(1));
    expect(screen.getByText('没有活动应用')).toBeInTheDocument();
  });

  it('从开发手册返回进入前的应用', async () => {
    activeApp.id = 'dev-tools';
    mockListApps.mockClear();
    mockSelectApp.mockClear();
    mockListApps.mockResolvedValue([
      {
        id: 'developer-guide',
        name: '开发手册',
        version: '0.1.0',
        category: '开发',
        status: 'active',
        ui: { mode: 'builtin', entry: 'account-menu' },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(mockListApps).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '打开开发手册' }));
    fireEvent.click(screen.getByRole('button', { name: '返回主页面' }));

    expect(mockSelectApp).toHaveBeenNthCalledWith(1, 'developer-guide');
    expect(mockSelectApp).toHaveBeenNthCalledWith(2, 'dev-tools');
  });

  it('进入前的应用不可用时返回首个应用', async () => {
    activeApp.id = 'hidden-app';
    mockListApps.mockClear();
    mockSelectApp.mockClear();
    mockListApps.mockResolvedValue([
      {
        id: 'developer-guide',
        name: '开发手册',
        version: '0.1.0',
        category: '开发',
        status: 'active',
        ui: { mode: 'builtin', entry: 'account-menu' },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(mockListApps).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '打开开发手册' }));
    fireEvent.click(screen.getByRole('button', { name: '返回主页面' }));

    expect(mockSelectApp).toHaveBeenNthCalledWith(2, 'home');
  });

  it('从调试页打开开发手册会先退出调试页', async () => {
    activeApp.id = 'dev-tools';
    mockListApps.mockClear();
    mockSelectApp.mockClear();
    mockListApps.mockResolvedValue([
      {
        id: 'developer-guide',
        name: '开发手册',
        version: '0.1.0',
        category: '开发',
        status: 'active',
        ui: { mode: 'builtin', entry: 'account-menu' },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(mockListApps).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '打开调试' }));
    expect(screen.getByText('调试页')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开开发手册' }));

    expect(screen.queryByText('调试页')).not.toBeInTheDocument();
    expect(mockSelectApp).toHaveBeenCalledWith('developer-guide');
  });
});
