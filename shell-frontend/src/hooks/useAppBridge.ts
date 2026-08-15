import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { AppManifest } from '../types/manifest';
import {
  listenNativeNotificationActions,
  parseAppNotification,
  sendNativeNotification,
  type AppNotificationAction,
} from '../lib/native-notifications';
import type { ThemeMode } from './useTheme';

type ResolvedTheme = Exclude<ThemeMode, 'system'>;

interface AppBridgeEnvelope {
  protocol: 'aidea-app-bridge';
  version: number;
  source: 'aidea-app' | 'aidea-shell';
  appId: string;
  id: string;
  type: string;
  inReplyTo?: string;
  payload: unknown;
}

interface FrameConnection {
  appId: string;
  origin: string;
  iframe: HTMLIFrameElement;
  connected: boolean;
  supported: string[];
}

export type AppFrameRef = (app: AppManifest, iframe: HTMLIFrameElement | null) => void;

export interface AppBridgeController {
  registerFrame: AppFrameRef;
}

type NavigateRequestHandler = (request: AppNotificationAction) => void | Promise<void>;

let messageSequence = 0;

function nextMessageId(): string {
  messageSequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `aidea-shell-${Date.now()}-${messageSequence}`;
}

function isEnvelope(value: unknown): value is AppBridgeEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope.protocol === 'aidea-app-bridge' &&
    Number.isInteger(envelope.version) &&
    envelope.source === 'aidea-app' &&
    typeof envelope.appId === 'string' &&
    typeof envelope.id === 'string' &&
    typeof envelope.type === 'string' &&
    'payload' in envelope
  );
}

function getAppOrigin(app: AppManifest): string | null {
  if (!app.ui.url) return null;
  try {
    const url = new URL(app.ui.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getReadyPayload(payload: unknown, appId: string): { supported: string[] } | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (value.appId !== appId) return null;
  return {
    supported: Array.isArray(value.supported)
      ? value.supported.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function send(
  connection: FrameConnection,
  source: 'aidea-shell',
  type: string,
  payload: unknown,
  inReplyTo?: string,
): void {
  const message: AppBridgeEnvelope = {
    protocol: 'aidea-app-bridge',
    version: 1,
    source,
    appId: connection.appId,
    id: nextMessageId(),
    type,
    payload,
    ...(inReplyTo ? { inReplyTo } : {}),
  };
  connection.iframe.contentWindow?.postMessage(message, connection.origin);
}

export function useAppBridge(
  theme: ResolvedTheme,
  onNavigateRequest?: NavigateRequestHandler,
): AppBridgeController {
  const connectionsRef = useRef(new Map<string, FrameConnection>());
  const themeRef = useRef(theme);
  const navigateHandlerRef = useRef(onNavigateRequest);
  const pendingNavigationRef = useRef(new Map<string, string>());

  useEffect(() => {
    navigateHandlerRef.current = onNavigateRequest;
  }, [onNavigateRequest]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const flushPendingNavigation = (appId: string) => {
      const path = pendingNavigationRef.current.get(appId);
      const connection = connectionsRef.current.get(appId);
      if (!path || !connection?.connected) return;

      pendingNavigationRef.current.delete(appId);
      if (connection.supported.includes('navigate')) {
        send(connection, 'aidea-shell', 'navigate', { path });
      }
    };

    let disposed = false;
    let listener: Awaited<ReturnType<typeof listenNativeNotificationActions>> | undefined;

    void listenNativeNotificationActions((request) => {
      if (request.path) pendingNavigationRef.current.set(request.appId, request.path);
      const handler = navigateHandlerRef.current;
      if (!handler) {
        flushPendingNavigation(request.appId);
        return;
      }
      void Promise.resolve(handler(request)).then(
        () => flushPendingNavigation(request.appId),
        () => undefined,
      );
    }).then(
      (registeredListener) => {
        if (disposed) {
          void registeredListener.unregister();
        } else {
          listener = registeredListener;
        }
      },
      // macOS 桌面通知插件没有 action listener；通知发送不受此限制。
      () => undefined,
    );

    return () => {
      disposed = true;
      void listener?.unregister();
    };
  }, []);

  const registerFrame = useCallback<AppFrameRef>((app, iframe) => {
    if (!iframe) {
      connectionsRef.current.delete(app.id);
      return;
    }

    const origin = getAppOrigin(app);
    if (!origin) return;
    connectionsRef.current.set(app.id, {
      appId: app.id,
      origin,
      iframe,
      connected: false,
      supported: [],
    });
  }, []);

  useLayoutEffect(() => {
    const handleMessage = async (event: MessageEvent<unknown>) => {
      if (!isEnvelope(event.data)) return;

      const connection = Array.from(connectionsRef.current.values()).find(
        (item) =>
          item.iframe.contentWindow === event.source && item.origin === event.origin,
      );
      if (!connection || connection.appId !== event.data.appId) return;

      if (event.data.version !== 1) {
        send(
          connection,
          'aidea-shell',
          'protocol:error',
          { code: 'unsupported_version', message: '不支持的 App Bridge 版本' },
          event.data.id,
        );
        return;
      }

      if (event.data.type === 'notify') {
        if (!connection.connected) return;
        const parsed = parseAppNotification(event.data.payload);
        if ('error' in parsed) {
          send(
            connection,
            'aidea-shell',
            'notify:result',
            { ok: false, error: parsed.error },
            event.data.id,
          );
          return;
        }
        if (parsed.notification.action && !connection.supported.includes('navigate')) {
          send(
            connection,
            'aidea-shell',
            'notify:result',
            {
              ok: false,
              error: { code: 'unsupported', message: '应用未声明 navigate 能力' },
            },
            event.data.id,
          );
          return;
        }
        const result = await sendNativeNotification(connection.appId, parsed.notification);
        send(connection, 'aidea-shell', 'notify:result', result, event.data.id);
        return;
      }

      if (event.data.type !== 'ready') return;
      const ready = getReadyPayload(event.data.payload, connection.appId);
      if (!ready) return;

      connection.connected = true;
      connection.supported = ready.supported;
      send(connection, 'aidea-shell', 'theme', { mode: themeRef.current });

      const pendingPath = pendingNavigationRef.current.get(connection.appId);
      if (pendingPath && connection.supported.includes('navigate')) {
        send(connection, 'aidea-shell', 'navigate', { path: pendingPath });
        pendingNavigationRef.current.delete(connection.appId);
      }
      return;
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    connectionsRef.current.forEach((connection) => {
      if (connection.connected) {
        send(connection, 'aidea-shell', 'theme', { mode: theme });
      }
    });
  }, [theme]);

  return { registerFrame };
}
