import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from '../../src/components/SettingsPanel';

describe('设置关于页', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('显示真实版本并检查更新', async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'get_aidea_version') return Promise.resolve('0.1.4');
      if (command === 'check_aidea_update') return Promise.resolve(null);
      return Promise.resolve(undefined);
    });

    render(
      <SettingsPanel
        themeMode="system"
        onThemeChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '关于' }));

    expect(await screen.findByText('0.1.4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText('已是最新版本')).toBeInTheDocument());
  });

  it('按版本顺序显示更新日志', () => {
    render(
      <SettingsPanel
        themeMode="system"
        onThemeChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
        onAppsChanged={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '更新日志' }));

    const latestVersion = screen.getByText('v0.1.9');
    const previousVersion = screen.getByText('v0.1.8');
    expect(latestVersion.compareDocumentPosition(previousVersion)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText(/优化 AI 模型测试工具的布局与能力。/)).toBeInTheDocument();
  });
});
