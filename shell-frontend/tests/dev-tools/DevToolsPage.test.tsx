import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevToolsPage } from '../../src/builtin-apps/dev-tools';

const mockGetDevToolsSettings = vi.fn();

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    getDevToolsSettings: (...args: unknown[]) => mockGetDevToolsSettings(...args),
  },
}));

describe('DevToolsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('隐藏用户关闭的工具，其余工具仍显示', async () => {
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['ip'], tab_order: [] });

    render(<DevToolsPage />);

    await waitFor(() => expect(mockGetDevToolsSettings).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'JSON 格式化' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'IP 查询' })).not.toBeInTheDocument();
  });

  it('新工具在旧配置中默认显示', async () => {
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['removed-tool'], tab_order: [] });

    render(<DevToolsPage />);

    expect(await screen.findByRole('tab', { name: 'JSON 格式化' })).toBeInTheDocument();
  });

  it('顶部工具按持久化顺序显示', async () => {
    mockGetDevToolsSettings.mockResolvedValue({
      hidden_tabs: ['ip'],
      tab_order: ['timestamp', 'data', 'ip'],
    });

    render(<DevToolsPage />);

    await waitFor(() => expect(mockGetDevToolsSettings).toHaveBeenCalled());
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '时间戳转换',
      'JSON 格式化',
    ]);
  });

  it('异常顺序配置会忽略未知和重复工具并补齐已注册工具', async () => {
    mockGetDevToolsSettings.mockResolvedValue({
      hidden_tabs: [],
      tab_order: ['unknown', 'timestamp', 'timestamp'],
    });

    render(<DevToolsPage />);

    await waitFor(() => expect(mockGetDevToolsSettings).toHaveBeenCalled());
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '时间戳转换',
      'JSON 格式化',
      'IP 查询',
    ]);
  });

  it('设置保存后立即重新读取，不需要 reload', async () => {
    mockGetDevToolsSettings
      .mockResolvedValueOnce({ hidden_tabs: [], tab_order: [] })
      .mockResolvedValueOnce({ hidden_tabs: ['ip'], tab_order: [] });

    render(<DevToolsPage />);

    expect(await screen.findByRole('tab', { name: 'IP 查询' })).toBeInTheDocument();
    window.dispatchEvent(new Event('aidea:dev-tools-settings-changed'));

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'IP 查询' })).not.toBeInTheDocument(),
    );
  });

  it('从 DevTools 自己的页面打开设置', async () => {
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: [], tab_order: [] });

    render(<DevToolsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'DevTools 设置' }));

    expect(await screen.findByRole('switch', { name: 'JSON 格式化' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回 DevTools' }));
    expect(await screen.findByRole('tab', { name: 'JSON 格式化' })).toBeInTheDocument();
  });

});
