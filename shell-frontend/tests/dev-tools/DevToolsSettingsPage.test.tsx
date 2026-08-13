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
    mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['ip'], tab_order: [] });
    mockSaveDevToolsSettings.mockResolvedValue(undefined);
  });

  it('旧配置按默认顺序显示卡片', async () => {
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    expect(await screen.findAllByTestId('dev-tools-card')).toHaveLength(4);
    expect(screen.getAllByTestId('dev-tools-card').map((card) => card.textContent)).toEqual([
      expect.stringContaining('JSON 格式化'),
      expect.stringContaining('时间戳转换'),
      expect.stringContaining('IP 查询'),
      expect.stringContaining('AI 模型测试'),
    ]);
  });

  it('按持久化顺序显示卡片，隐藏工具仍保留在列表中', async () => {
    mockGetDevToolsSettings.mockResolvedValueOnce({
      hidden_tabs: ['ip'],
      tab_order: ['ai', 'data', 'unknown', 'data'],
    });
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    expect(await screen.findAllByTestId('dev-tools-card')).toHaveLength(4);
    expect(screen.getAllByTestId('dev-tools-card').map((card) => card.textContent)).toEqual([
      expect.stringContaining('AI 模型测试'),
      expect.stringContaining('JSON 格式化'),
      expect.stringContaining('时间戳转换'),
      expect.stringContaining('IP 查询'),
    ]);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'IP 查询' })).not.toBeChecked(),
    );
  });

  it('隐藏工具时保存应用自己的偏好', async () => {
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('switch', { name: '时间戳转换' }));

    await waitFor(() =>
      expect(mockSaveDevToolsSettings).toHaveBeenCalledWith({
        hidden_tabs: ['ip', 'timestamp'],
        tab_order: ['data', 'timestamp', 'ip', 'ai'],
      }),
    );
  });

  it('使用拖拽手柄调整顺序并保存完整设置', async () => {
    render(<DevToolsSettingsPage onClose={vi.fn()} />);
    screen.getAllByTestId('dev-tools-card').forEach((card, index) => {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        bottom: index * 60 + 50,
        height: 50,
        left: 0,
        right: 300,
        top: index * 60,
        width: 300,
        x: 0,
        y: index * 60,
        toJSON: () => ({}),
      });
    });
    const handle = await screen.findByRole('button', { name: '拖动调整工具顺序：JSON 格式化' });

    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(document, { key: ' ', code: 'Space' });

    await waitFor(() =>
      expect(mockSaveDevToolsSettings).toHaveBeenCalledWith({
        hidden_tabs: ['ip'],
        tab_order: ['timestamp', 'data', 'ip', 'ai'],
      }),
    );
  });

  it('排序保存失败时恢复原顺序并提示错误', async () => {
    mockSaveDevToolsSettings.mockRejectedValueOnce(new Error('disk full'));
    render(<DevToolsSettingsPage onClose={vi.fn()} />);
    screen.getAllByTestId('dev-tools-card').forEach((card, index) => {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        bottom: index * 60 + 50,
        height: 50,
        left: 0,
        right: 300,
        top: index * 60,
        width: 300,
        x: 0,
        y: index * 60,
        toJSON: () => ({}),
      });
    });
    const handle = await screen.findByRole('button', { name: '拖动调整工具顺序：JSON 格式化' });

    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(document, { key: ' ', code: 'Space' });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      '保存 DevTools 设置失败',
      { description: 'Error: disk full' },
    ));
    expect(screen.getAllByTestId('dev-tools-card').map((card) => card.textContent)).toEqual([
      expect.stringContaining('JSON 格式化'),
      expect.stringContaining('时间戳转换'),
      expect.stringContaining('IP 查询'),
      expect.stringContaining('AI 模型测试'),
    ]);
  });

  it('至少保留一个可见工具', async () => {
    mockGetDevToolsSettings.mockResolvedValueOnce({
      hidden_tabs: ['timestamp', 'ip', 'ai'],
    });
    render(<DevToolsSettingsPage onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('switch', { name: 'JSON 格式化' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockSaveDevToolsSettings).not.toHaveBeenCalled();
  });
});
