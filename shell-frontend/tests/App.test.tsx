import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockListApps, visibleApps } = vi.hoisted(() => ({
  mockListApps: vi.fn(),
  visibleApps: [
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
vi.mock('../src/components/TopBar', () => ({ TopBar: () => null }));
vi.mock('../src/components/LogPanel', () => ({ LogPanel: () => null }));
vi.mock('../src/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('../src/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('../src/components/ContentArea', () => ({
  ContentArea: ({ activeApp }: { activeApp: { id: string } | null }) => (
    <div>{activeApp?.id ?? '没有活动应用'}</div>
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
  useActiveApp: () => ({ activeAppId: 'hidden-app', selectApp: vi.fn() }),
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
  },
}));

import App from '../src/App';

describe('主界面', () => {
  it('不会把已隐藏应用的旧选中状态回退为开发手册', async () => {
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
});
