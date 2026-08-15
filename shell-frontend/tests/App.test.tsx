import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { activeApp, mockListApps, mockRecordBuiltinDiagnostic, mockSelectApp, visibleApps } = vi.hoisted(() => ({
  activeApp: { id: 'hidden-app' },
  mockListApps: vi.fn(),
  mockRecordBuiltinDiagnostic: vi.fn<[id: string, source: string, message: string], Promise<void>>(
    () => Promise.resolve(),
  ),
  mockSelectApp: vi.fn(),
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

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../src/components/TopBar', () => ({
  TopBar: ({ onOpenDeveloperGuide }: { onOpenDeveloperGuide: () => void }) => (
    <button type="button" onClick={onOpenDeveloperGuide}>
      打开开发手册
    </button>
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
vi.mock('../src/hooks/useAppBridge', () => ({ useAppBridge: () => ({ registerFrame: vi.fn() }) }));
vi.mock('../src/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));
vi.mock('../src/lib/ipc', () => ({
  ipc: {
    listApps: (...args: unknown[]) => mockListApps(...args),
    checkAideaUpdate: vi.fn(() => Promise.resolve(null)),
    recordBuiltinDiagnostic: (id: string, source: string, message: string) =>
      mockRecordBuiltinDiagnostic(id, source, message),
    recordAideaDiagnostic: vi.fn(() => Promise.resolve()),
  },
}));

import App from '../src/App';

describe('主界面', () => {
  beforeEach(() => {
    mockListApps.mockClear();
  });

  it('未处理前端错误会记录到当前内置应用', async () => {
    activeApp.id = 'dev-tools';
    mockRecordBuiltinDiagnostic.mockClear();
    mockListApps.mockResolvedValue([]);
    render(<App />);

    window.dispatchEvent(new ErrorEvent('error', { message: 'render failed' }));
    await waitFor(() =>
      expect(mockRecordBuiltinDiagnostic).toHaveBeenCalledWith('dev-tools', 'frontend', 'render failed'),
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
});
