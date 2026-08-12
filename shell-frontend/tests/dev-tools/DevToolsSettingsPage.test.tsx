import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevToolsSettingsPage } from '../../src/builtin-apps/dev-tools/DevToolsSettingsPage';

const mockGetDevToolsSettings = vi.fn();
const mockSaveDevToolsSettings = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    getDevToolsSettings: (...args: unknown[]) => mockGetDevToolsSettings(...args),
    saveDevToolsSettings: (...args: unknown[]) => mockSaveDevToolsSettings(...args),
  },
}));

describe('DevToolsSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['ip'] });
  });

  it('将已隐藏的工具显示为未选中', async () => {
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'IP 查询' })).not.toBeChecked(),
    );
    expect(screen.getByRole('checkbox', { name: 'JSON 格式化' })).toBeChecked();
  });

  it('隐藏工具时保存应用自己的偏好', async () => {
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: '时间戳转换' }));

    await waitFor(() =>
      expect(mockSaveDevToolsSettings).toHaveBeenCalledWith({ hidden_tabs: ['ip', 'timestamp'] }),
    );
  });

  it('至少保留一个可见工具', async () => {
    mockGetDevToolsSettings.mockResolvedValueOnce({
      hidden_tabs: ['timestamp', 'ip', 'ai'],
    });
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'JSON 格式化' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockSaveDevToolsSettings).not.toHaveBeenCalled();
  });
});
