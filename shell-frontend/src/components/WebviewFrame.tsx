// webview 模式渲染：用 iframe 嵌入子应用 web server
import { useCallback, useMemo, useState } from 'react';
import type { AppManifest, AppState } from '../types/manifest';
import type { AppFrameRef } from '../hooks/useAppBridge';
import type { ThemeMode } from '../hooks/useTheme';

type ResolvedTheme = Exclude<ThemeMode, 'system'>;

interface Props {
  app: AppManifest;
  state?: AppState;
  path?: string;
  theme?: ResolvedTheme;
  onFrameRef?: AppFrameRef;
}

export function WebviewFrame({ app, state, path, theme, onFrameRef }: Props) {
  const [initialTheme] = useState(() => theme);
  // Bridge 只在连接身份变化时重新注册，避免普通 manifest 刷新断开连接。
  const bridgeApp = useMemo(() => app, [app.id, app.version, app.ui.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const frameRef = useCallback(
    (iframe: HTMLIFrameElement | null) => onFrameRef?.(bridgeApp, iframe),
    [bridgeApp, onFrameRef],
  );
  const url = app.ui.url;

  if (!url) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-destructive text-sm">
          子应用 {app.name} 没有可用的主页地址
        </p>
      </div>
    );
  }
  if (app.process && state?.status !== 'running') {
    const message = state?.status === 'starting' ? '正在启动...' : state?.status === 'stopping' ? '正在停止...' : '服务未启动';
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">{app.name} {message}</p>
      </div>
    );
  }
  let frameUrl = url;
  if (path) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
        throw new Error('仅支持本地 HTTP 地址');
      }
      parsed.pathname = path;
      parsed.search = '';
      parsed.hash = '';
      frameUrl = parsed.toString();
    } catch {
      return (
        <div className="flex-1 flex items-center justify-center bg-background">
          <p className="text-destructive text-sm">子应用 {app.name} 设置地址无效</p>
        </div>
      );
    }
  }

  if (initialTheme) {
    try {
      const parsed = new URL(frameUrl);
      parsed.searchParams.set('aidea_theme', initialTheme);
      frameUrl = parsed.toString();
    } catch {
      return (
        <div className="flex-1 flex items-center justify-center bg-background">
          <p className="text-destructive text-sm">子应用 {app.name} 地址无效</p>
        </div>
      );
    }
  }

  return (
    <iframe
      key={`${app.id}-${app.version}-${app.ui.url ?? ''}-${state?.status ?? 'stopped'}`}
      src={frameUrl}
      title={app.name}
      className="flex-1 w-full h-full border-0 bg-background"
      ref={frameRef}
      // 允许子应用使用 clipboard、modals 等
      allow="clipboard-read; clipboard-write"
    />
  );
}
