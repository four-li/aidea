import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

import { invoke } from '@tauri-apps/api/core';
import { SettingsPanel } from '../../src/components/SettingsPanel';
import changelog from '../../src/data/changelog.json';

describe('设置关于页', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'list_apps' || command === 'get_app_states') return Promise.resolve([]);
      if (command === 'get_shell_config') return Promise.resolve({ app_settings: {} });
      if (
        command === 'list_official_apps' ||
        command === 'refresh_official_apps' ||
        command === 'list_installed_official_apps'
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
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
        onSelectApp={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '关于' }));

    expect(await screen.findByText('0.1.4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText('已是最新版本')).toBeInTheDocument());
  });

  it('关于页默认显示最新 3 条更新日志，并可展开全部版本', async () => {
    render(
      <SettingsPanel
        themeMode="system"
        onThemeChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
        onAppsChanged={vi.fn()}
        onSelectApp={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    await screen.findByText('暂无已安装应用');

    fireEvent.click(screen.getByRole('button', { name: '关于' }));

    expect(screen.getByText('更新日志')).toBeInTheDocument();
    for (const entry of changelog.slice(0, 3)) {
      expect(
        screen.getByRole('button', { name: `打开 v${entry.version} Release` }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('button', { name: `打开 v${changelog[3].version} Release` }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `打开 v${changelog[0].version} Release` }));
    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: `https://gitee.com/aidea-org/aidea-app/releases/tag/v${changelog[0].version}`,
    });
    expect(screen.getAllByText(`发布日期：${changelog[0].date}`)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '查看更多更新日志' }));
    expect(
      screen.getByRole('button', { name: `打开 v${changelog[3].version} Release` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起更新日志' })).toBeInTheDocument();
  });

  it('只保留应用管理入口', async () => {
    render(
      <SettingsPanel
        themeMode="system"
        onThemeChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
        onAppsChanged={vi.fn()}
        onSelectApp={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    await screen.findByText('暂无已安装应用');

    expect(screen.getByRole('button', { name: '应用管理' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '应用市场' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新日志' })).not.toBeInTheDocument();
    expect(screen.queryByText('数据目录')).not.toBeInTheDocument();
  });

  it('设置弹窗的默认焦点控件不显示浏览器边框', async () => {
    render(
      <SettingsPanel
        themeMode="system"
        onThemeChange={vi.fn()}
        open
        onOpenChange={vi.fn()}
        onAppsChanged={vi.fn()}
        onSelectApp={vi.fn()}
        onShowLog={vi.fn()}
      />,
    );

    await screen.findByText('暂无已安装应用');

    expect(screen.getByRole('button', { name: '应用管理' })).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:ring-0',
      'focus-visible:ring-offset-0',
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'focus-visible:ring-0',
      'focus-visible:ring-offset-0',
    );
  });
});
