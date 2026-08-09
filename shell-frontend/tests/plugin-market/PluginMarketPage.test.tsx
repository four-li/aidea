import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginMarketPage } from '../../src/builtin-apps/plugin-market';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const mockListOfficialPlugins = vi.fn();
const mockRefreshOfficialPlugins = vi.fn();
const mockListInstalledOfficialPlugins = vi.fn();

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    listOfficialPlugins: (...args: unknown[]) => mockListOfficialPlugins(...args),
    refreshOfficialPlugins: (...args: unknown[]) => mockRefreshOfficialPlugins(...args),
    listInstalledOfficialPlugins: (...args: unknown[]) => mockListInstalledOfficialPlugins(...args),
  },
}));

describe('PluginMarketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOfficialPlugins.mockResolvedValue([
      {
        id: 'demo',
        name: 'Demo',
        description: 'demo',
        category: '工具',
        version: '0.1.0',
        icon: 'Package',
        repository: 'https://example.com/demo.git',
        revision: 'a'.repeat(40),
        runtime: 'node',
        install: [],
        process: { command: ['node', 'server.js'], working_directory: '.', ready_url: 'http://127.0.0.1:43120/health' },
        update_notes: '',
        update_available: false,
      },
    ]);
    const installed = [
      { id: 'demo', version: '0.1.0', revision: 'a'.repeat(40), status: 'installed' },
    ];
    mockRefreshOfficialPlugins.mockResolvedValueOnce([
      {
        id: 'demo',
        name: 'Demo',
        description: 'demo',
        category: '工具',
        version: '0.1.0',
        icon: 'Package',
        repository: 'https://example.com/demo.git',
        revision: 'a'.repeat(40),
        runtime: 'node',
        install: [],
        process: { command: ['node', 'server.js'], working_directory: '.', ready_url: 'http://127.0.0.1:43120/health' },
        update_notes: '',
        update_available: false,
      },
    ]);
    mockListInstalledOfficialPlugins.mockResolvedValue(installed);
  });

  it('同版本已安装时显示已安装状态而不是更新按钮', async () => {
    render(<PluginMarketPage />);

    await waitFor(() => expect(screen.getByText('已安装')).toBeInTheDocument());
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && (element.textContent?.includes('已安装 v0.1.0') ?? false),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });
});
