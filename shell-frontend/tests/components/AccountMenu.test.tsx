import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { AccountMenu } from '../../src/components/AccountMenu';
import { TooltipProvider } from '../../src/components/ui/tooltip';

class LoadedImage {
  complete = true;
  naturalWidth = 1;
  crossOrigin: string | null = null;

  addEventListener() {}
  removeEventListener() {}
  set src(_value: string) {}
}

describe('账户菜单', () => {
  const originalImage = window.Image;

  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(command === 'get_os_user_avatar' ? 'data:image/jpeg;base64,avatar' : 'fourli'),
    );
    Object.defineProperty(window, 'Image', { configurable: true, writable: true, value: LoadedImage });
  });

  afterEach(() => {
    Object.defineProperty(window, 'Image', { configurable: true, writable: true, value: originalImage });
    vi.clearAllMocks();
  });

  it('默认只显示 macOS 头像、短用户名和账户菜单触发器', async () => {
    render(<AccountMenu onOpenSettings={vi.fn()} themeMode="system" onThemeChange={vi.fn()} />);

    expect(await screen.findByText('fourli')).toBeInTheDocument();
    expect(screen.queryByText('v0.2.2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fourli账户菜单' })).toHaveClass(
      'focus-visible:ring-offset-0',
    );
    expect(await screen.findByRole('img', { name: 'fourli 的 macOS 头像' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,avatar',
    );
  });

  it('有新版本时在账户入口左侧显示下载入口', async () => {
    const onOpenUpdate = vi.fn();
    render(
      <TooltipProvider>
        <AccountMenu
          onOpenSettings={vi.fn()}
          themeMode="system"
          onThemeChange={vi.fn()}
          updateAvailable
          onOpenUpdate={onOpenUpdate}
        />
      </TooltipProvider>,
    );

    const update = await screen.findByRole('button', { name: '有新版本可更新' });
    expect(update).toHaveClass('focus-visible:ring-offset-0');
    fireEvent.click(update);
    expect(onOpenUpdate).toHaveBeenCalledTimes(1);
  });

  it('读取账户信息失败时使用本地用户和 aIdea 标识', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('不可用'));
    render(<AccountMenu onOpenSettings={vi.fn()} themeMode="system" onThemeChange={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '本地用户账户菜单' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'aIdea 标识' })).toBeInTheDocument();
  });

  it('长用户名只在账户入口内省略', async () => {
    const username = 'fourli-long-local-account-name';
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(command === 'get_os_user_avatar' ? 'data:image/jpeg;base64,avatar' : username),
    );
    render(<AccountMenu onOpenSettings={vi.fn()} themeMode="system" onThemeChange={vi.fn()} />);

    expect(await screen.findByText(username)).toHaveClass('truncate');
  });

  it('从帮助子菜单打开开发手册', async () => {
    const onOpenDeveloperGuide = vi.fn();
    render(
      <AccountMenu
        onOpenSettings={vi.fn()}
        onOpenDeveloperGuide={onOpenDeveloperGuide}
        themeMode="system"
        onThemeChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(await screen.findByRole('button', { name: 'fourli账户菜单' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '帮助' }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '开发手册' }));

    expect(onOpenDeveloperGuide).toHaveBeenCalledTimes(1);
  });

  it('从帮助子菜单打开问题报告页', async () => {
    render(<AccountMenu onOpenSettings={vi.fn()} themeMode="system" onThemeChange={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole('button', { name: 'fourli账户菜单' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '帮助' }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '报告问题' }));

    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://gitee.com/aidea-org/aidea-app/issues/new',
    });
  });

  it('把设置放在菜单第一项', async () => {
    render(<AccountMenu onOpenSettings={vi.fn()} themeMode="system" onThemeChange={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole('button', { name: 'fourli账户菜单' }), {
      key: 'ArrowDown',
    });

    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('设置');
  });

  it('从主题子菜单更新主题模式', async () => {
    function ThemeHarness() {
      const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
      return (
        <>
          <output>{themeMode}</output>
          <AccountMenu onOpenSettings={vi.fn()} themeMode={themeMode} onThemeChange={setThemeMode} />
        </>
      );
    }

    render(<ThemeHarness />);
    const trigger = await screen.findByRole('button', { name: 'fourli账户菜单' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /主题/ }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '浅色' }));

    expect(screen.getByRole('status')).toHaveTextContent('light');
  });
});
