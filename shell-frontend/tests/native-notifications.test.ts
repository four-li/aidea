import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  onAction: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-notification', () => mocks);

import {
  listenNativeNotificationActions,
  parseAppNotification,
  sendNativeNotification,
} from '../src/lib/native-notifications';

describe('native notifications', () => {
  it('只接受应用内部路径，并拒绝 tag', () => {
    expect(
      parseAppNotification({
        title: '新邮件',
        body: '正文',
        action: { type: 'navigate', path: '/messages/1' },
      }),
    ).toEqual({
      notification: {
        title: '新邮件',
        body: '正文',
        action: { type: 'navigate', path: '/messages/1' },
      },
    });
    expect(parseAppNotification({ title: '标题', body: '正文', tag: 'x' })).toEqual({
      error: { code: 'invalid_payload', message: 'notify payload 无效' },
    });
    expect(
      parseAppNotification({
        title: '标题',
        body: '正文',
        action: { type: 'navigate', path: 'https://example.com' },
      }),
    ).toEqual({
      error: { code: 'invalid_payload', message: '通知路径必须是应用内部路径' },
    });
  });

  it('按需申请权限并把 appId/path 放进通知 extra', async () => {
    mocks.isPermissionGranted.mockResolvedValueOnce(false);
    mocks.requestPermission.mockResolvedValueOnce('granted');
    mocks.sendNotification.mockReset();

    await expect(
      sendNativeNotification('mail-center', {
        title: '新邮件',
        body: '正文',
        action: { type: 'navigate', path: '/messages/1' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.requestPermission).toHaveBeenCalledOnce();
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ extra: { appId: 'mail-center', path: '/messages/1' } }),
    );
  });

  it('用户拒绝权限时返回 permission_denied', async () => {
    mocks.sendNotification.mockReset();
    mocks.isPermissionGranted.mockResolvedValueOnce(false);
    mocks.requestPermission.mockResolvedValueOnce('denied');

    await expect(
      sendNativeNotification('mail-center', { title: '标题', body: '正文' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'permission_denied', message: '用户未授予通知权限' },
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('点击回调只转发带 appId 的通知 action', async () => {
    let actionHandler: ((notification: { extra?: Record<string, unknown> }) => void) | undefined;
    mocks.onAction.mockImplementationOnce(async (handler) => {
      actionHandler = handler;
    });
    const onNavigate = vi.fn();

    await listenNativeNotificationActions(onNavigate);
    actionHandler?.({ extra: { appId: 'mail-center', path: '/messages/1' } });
    actionHandler?.({ extra: { path: '/messages/2' } });

    expect(onNavigate).toHaveBeenCalledWith({ appId: 'mail-center', path: '/messages/1' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('返回通知监听句柄供调用方注销', async () => {
    const listener = { unregister: vi.fn().mockResolvedValue(undefined) };
    mocks.onAction.mockResolvedValueOnce(listener);

    await expect(listenNativeNotificationActions(vi.fn())).resolves.toBe(listener);
  });
});
