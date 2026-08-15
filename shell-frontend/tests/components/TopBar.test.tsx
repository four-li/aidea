import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../src/components/TopBar';

describe('TopBar', () => {
  it('只把左侧空白区作为窗口拖拽区', () => {
    const { container } = render(
      <TopBar
        apps={[]}
        appOrder={[]}
        activeAppId={null}
        states={{}}
        onSelectApp={vi.fn()}
        onRefreshStates={vi.fn()}
        onShowLog={vi.fn()}
        onOpenSettings={vi.fn()}
        themeMode="system"
        onThemeChange={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('[data-tauri-drag-region]')).toHaveLength(1);
    expect(container.firstElementChild).not.toHaveAttribute('data-tauri-drag-region');
  });

  it('顶部为启动中的官方应用显示状态说明', async () => {
    render(
      <TopBar
        apps={[
          {
            id: 'mail-center',
            name: '邮件中心',
            version: '0.1.0',
            category: '效率',
            status: 'active',
            ui: { mode: 'webview' },
            process: {},
          },
        ]}
        appOrder={['mail-center']}
        activeAppId="mail-center"
        states={{ 'mail-center': { id: 'mail-center', status: 'starting', pid: null } }}
        onSelectApp={vi.fn()}
        onRefreshStates={vi.fn()}
        onShowLog={vi.fn()}
        onOpenSettings={vi.fn()}
        themeMode="system"
        onThemeChange={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText('邮件中心：启动中')).toBeInTheDocument();
  });

  it('官方应用在标签右侧显示状态，内置应用不显示状态位', () => {
    render(
      <TopBar
        apps={[
          {
            id: 'dev-tools',
            name: 'DevTools',
            version: '0.1.0',
            category: '开发',
            status: 'active',
            ui: { mode: 'builtin' },
          },
          {
            id: 'mail-center',
            name: '邮件中心',
            version: '0.1.0',
            category: '效率',
            status: 'active',
            ui: { mode: 'webview' },
            process: {},
          },
        ]}
        appOrder={['dev-tools', 'mail-center']}
        activeAppId="mail-center"
        states={{ 'mail-center': { id: 'mail-center', status: 'running', pid: 123 } }}
        onSelectApp={vi.fn()}
        onRefreshStates={vi.fn()}
        onShowLog={vi.fn()}
        onOpenSettings={vi.fn()}
        themeMode="system"
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /DevTools/ })).toHaveClass(
      'focus-visible:ring-offset-0',
    );
    expect(screen.getByLabelText('邮件中心：运行中')).toHaveClass('ml-auto');
    expect(screen.queryByLabelText('DevTools：已停止')).not.toBeInTheDocument();
  });

  it('有新版本时显示更新入口并可打开关于页', () => {
    const onOpenUpdate = vi.fn();
    render(
      <TopBar
        apps={[]}
        appOrder={[]}
        activeAppId={null}
        states={{}}
        onSelectApp={vi.fn()}
        onRefreshStates={vi.fn()}
        onShowLog={vi.fn()}
        onOpenSettings={vi.fn()}
        themeMode="system"
        onThemeChange={vi.fn()}
        updateAvailable
        onOpenUpdate={onOpenUpdate}
      />,
    );

    expect(screen.getByRole('button', { name: '有新版本可更新' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '有新版本可更新' }));
    expect(onOpenUpdate).toHaveBeenCalledTimes(1);
  });
});
