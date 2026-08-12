import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
  type Options,
} from '@tauri-apps/plugin-notification';
import type { PluginListener } from '@tauri-apps/api/core';

export interface AppNotificationAction {
  appId: string;
  path?: string;
}

export interface AppNotification {
  title: string;
  body: string;
  action?: { type: 'navigate'; path: string };
}

export type NativeNotificationResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

let notificationId = 0;

function nextNotificationId(): number {
  notificationId = (notificationId % 2_000_000_000) + 1;
  return notificationId;
}

function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !/^[a-z][a-z\d+.-]*:/i.test(path);
}

export function parseAppNotification(payload: unknown):
  | { notification: AppNotification }
  | { error: { code: 'invalid_payload' | 'unsupported'; message: string } } {
  if (!payload || typeof payload !== 'object') {
    return { error: { code: 'invalid_payload', message: 'notify payload 无效' } };
  }

  const value = payload as Record<string, unknown>;
  if (
    typeof value.title !== 'string' ||
    value.title.trim() === '' ||
    typeof value.body !== 'string' ||
    value.body.trim() === '' ||
    Object.prototype.hasOwnProperty.call(value, 'tag')
  ) {
    return { error: { code: 'invalid_payload', message: 'notify payload 无效' } };
  }

  if (value.action === undefined) {
    return { notification: { title: value.title, body: value.body } };
  }

  if (!value.action || typeof value.action !== 'object') {
    return { error: { code: 'invalid_payload', message: '通知 action 无效' } };
  }

  const action = value.action as Record<string, unknown>;
  if (
    action.type !== 'navigate' ||
    typeof action.path !== 'string' ||
    !isInternalPath(action.path)
  ) {
    return { error: { code: 'invalid_payload', message: '通知路径必须是应用内部路径' } };
  }

  return {
    notification: {
      title: value.title,
      body: value.body,
      action: { type: 'navigate', path: action.path },
    },
  };
}

export async function sendNativeNotification(
  appId: string,
  notification: AppNotification,
): Promise<NativeNotificationResult> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) {
      return {
        ok: false,
        error: { code: 'permission_denied', message: '用户未授予通知权限' },
      };
    }

    const id = nextNotificationId();
    sendNotification({
      id,
      title: notification.title,
      body: notification.body,
      extra: {
        appId,
        ...(notification.action ? { path: notification.action.path } : {}),
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'native_error', message: '发送系统通知失败' } };
  }
}

export async function listenNativeNotificationActions(
  onNavigate: (action: AppNotificationAction) => void,
): Promise<PluginListener> {
  return onAction((notification: Options) => {
    const extra = notification.extra;
    if (!extra || typeof extra.appId !== 'string') return;
    if (extra.path !== undefined && typeof extra.path !== 'string') return;
    onNavigate({
      appId: extra.appId,
      ...(typeof extra.path === 'string' ? { path: extra.path } : {}),
    });
  });
}
