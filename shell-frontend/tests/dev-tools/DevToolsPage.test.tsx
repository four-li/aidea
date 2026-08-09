import { render, screen, waitFor } from '@testing-library/react';
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
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['ip'] });

    render(<DevToolsPage />);

    await waitFor(() => expect(mockGetDevToolsSettings).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: '数据格式化' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'IP 查询' })).not.toBeInTheDocument();
  });

  it('新工具在旧配置中默认显示', async () => {
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['removed-tool'] });

    render(<DevToolsPage />);

    expect(await screen.findByRole('tab', { name: 'AI 模型测试' })).toBeInTheDocument();
  });

});
