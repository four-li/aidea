import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppBridge } from '../src/hooks/useAppBridge';
import { WebviewFrame } from '../src/components/WebviewFrame';
import type { AppManifest } from '../src/types/manifest';

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn(),
  onAction: vi.fn().mockResolvedValue({ unregister: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@tauri-apps/plugin-notification', () => notificationMocks);

const app: AppManifest = {
  id: 'mail-center',
  name: '邮件',
  version: '0.1.0',
  category: 'productivity',
  status: 'active',
  ui: { mode: 'webview', url: 'http://127.0.0.1:43001' },
};

let messageSequence = 0;

function envelope(
  type: string,
  payload: unknown,
  options: { appId?: string; version?: number } = {},
) {
  messageSequence += 1;
  return {
    protocol: 'aidea-app-bridge',
    version: options.version ?? 1,
    source: 'aidea-app',
    appId: options.appId ?? app.id,
    id: `app-message-${messageSequence}`,
    type,
    payload,
  };
}

function Harness({
  theme = 'light',
  app: appProp = app,
}: {
  theme?: 'light' | 'dark';
  app?: AppManifest;
}) {
  const controller = useAppBridge(theme);
  return <WebviewFrame app={appProp} onFrameRef={controller.registerFrame} />;
}

function dispatchMessage(
  iframe: HTMLIFrameElement,
  data: unknown,
  origin = 'http://127.0.0.1:43001',
  source: Window = iframe.contentWindow as Window,
) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

describe('useAppBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    notificationMocks.onAction.mockReset();
    notificationMocks.onAction.mockResolvedValue({
      unregister: vi.fn().mockResolvedValue(undefined),
    });
    notificationMocks.isPermissionGranted.mockResolvedValue(true);
    notificationMocks.requestPermission.mockResolvedValue('granted');
    notificationMocks.sendNotification.mockReset();
    messageSequence = 0;
  });

  it('ready 握手后回传当前主题', () => {
    render(<Harness theme="dark" />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });

    dispatchMessage(iframe, envelope('ready', { appId: app.id, supported: ['navigate'] }));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'aidea-app-bridge',
        version: 1,
        source: 'aidea-shell',
        appId: app.id,
        type: 'theme',
        payload: { mode: 'dark' },
      }),
      'http://127.0.0.1:43001',
    );
  });

  it('主题变化只发送 theme，不重建或重新注册 iframe', () => {
    const { rerender } = render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    dispatchMessage(iframe, envelope('ready', { appId: app.id }));

    rerender(<Harness theme="dark" />);

    expect(screen.getByTitle('邮件')).toBe(iframe);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'theme', payload: { mode: 'dark' } }),
      'http://127.0.0.1:43001',
    );
  });

  it('manifest 刷新后同一个 iframe 仍保持 Bridge 连接', () => {
    const { rerender } = render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    dispatchMessage(iframe, envelope('ready', { appId: app.id }));

    rerender(<Harness app={{ ...app }} />);
    rerender(<Harness theme="dark" app={{ ...app }} />);

    expect(screen.getByTitle('邮件')).toBe(iframe);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'theme', payload: { mode: 'dark' } }),
      'http://127.0.0.1:43001',
    );
  });

  it('拒绝错误来源、错误 iframe、错误 appId 和非法信封', () => {
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });

    dispatchMessage(iframe, envelope('ready', { appId: app.id }), 'http://127.0.0.1:43002');
    dispatchMessage(iframe, envelope('ready', { appId: 'other-app' }));
    dispatchMessage(iframe, { protocol: 'aidea-app-bridge' });
    dispatchMessage(iframe, envelope('ready', { appId: app.id }), 'http://127.0.0.1:43001', {} as Window);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('不支持的协议版本返回 protocol:error', () => {
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    const message = envelope('ready', { appId: app.id }, { version: 2 });

    dispatchMessage(iframe, message);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol:error',
        inReplyTo: message.id,
        payload: { code: 'unsupported_version', message: '不支持的 App Bridge 版本' },
      }),
      'http://127.0.0.1:43001',
    );
  });

  it('iframe 销毁后不再处理旧窗口消息', () => {
    const { unmount } = render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    unmount();

    dispatchMessage(iframe, envelope('ready', { appId: app.id }));

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('notify 校验成功后发送原生通知并回执', async () => {
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    dispatchMessage(iframe, envelope('ready', { appId: app.id, supported: ['navigate'] }));
    const notifyMessage = envelope('notify', {
      title: '新邮件',
      body: '收到一封新邮件',
      action: { type: 'navigate', path: '/messages/123' },
    });

    dispatchMessage(iframe, notifyMessage);

    await waitFor(() => {
      expect(notificationMocks.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '新邮件',
          body: '收到一封新邮件',
          extra: { appId: app.id, path: '/messages/123' },
        }),
      );
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'notify:result',
          inReplyTo: notifyMessage.id,
          payload: { ok: true },
        }),
        'http://127.0.0.1:43001',
      );
    });
  });

  it('notify 拒绝 tag 和外部路径', async () => {
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    dispatchMessage(iframe, envelope('ready', { appId: app.id, supported: ['navigate'] }));
    const invalidMessage = envelope('notify', {
      title: '通知',
      body: '正文',
      tag: 'legacy-tag',
      action: { type: 'navigate', path: 'https://example.com' },
    });

    dispatchMessage(iframe, invalidMessage);

    await waitFor(() => {
      expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'notify:result',
          inReplyTo: invalidMessage.id,
          payload: {
            ok: false,
            error: { code: 'invalid_payload', message: 'notify payload 无效' },
          },
        }),
        'http://127.0.0.1:43001',
      );
    });
  });

  it('已握手的应用收到通知点击后立即发送 navigate', async () => {
    let actionHandler:
      | ((notification: { extra?: Record<string, unknown> }) => void)
      | undefined;
    notificationMocks.onAction.mockImplementationOnce(async (handler) => {
      actionHandler = handler;
      return { unregister: vi.fn().mockResolvedValue(undefined) };
    });
    const postMessage = vi.fn();
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    dispatchMessage(iframe, envelope('ready', { appId: app.id, supported: ['navigate'] }));
    await waitFor(() => expect(actionHandler).toBeDefined());

    actionHandler?.({ extra: { appId: app.id, path: '/messages/123' } });

    await waitFor(() => {
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'navigate', payload: { path: '/messages/123' } }),
        'http://127.0.0.1:43001',
      );
    });
  });

  it('尚未握手的应用等待 ready 后发送 navigate', async () => {
    let actionHandler:
      | ((notification: { extra?: Record<string, unknown> }) => void)
      | undefined;
    notificationMocks.onAction.mockImplementationOnce(async (handler) => {
      actionHandler = handler;
      return { unregister: vi.fn().mockResolvedValue(undefined) };
    });
    const postMessage = vi.fn();
    render(<Harness />);
    const iframe = screen.getByTitle('邮件') as HTMLIFrameElement;
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: postMessage,
    });
    await waitFor(() => expect(actionHandler).toBeDefined());

    actionHandler?.({ extra: { appId: app.id, path: '/messages/456' } });
    dispatchMessage(iframe, envelope('ready', { appId: app.id, supported: ['navigate'] }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'navigate', payload: { path: '/messages/456' } }),
        'http://127.0.0.1:43001',
      );
    });
  });
});
