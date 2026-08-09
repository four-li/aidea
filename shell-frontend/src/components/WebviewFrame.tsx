// webview 模式渲染：用 iframe 嵌入子应用 web server
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  app: AppManifest;
  state?: AppState;
  path?: string;
}

export function WebviewFrame({ app, state, path }: Props) {
  const url = app.ui.url;

  if (!url) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-destructive text-sm">
          子应用 {app.name} 配置错误：ui.mode=webview 但未配置 ui.url
        </p>
      </div>
    );
  }
  if (app.process && state?.status !== 'running') {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">{app.name} 服务未启动</p>
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
  return (
    <iframe
      key={`${app.id}-${state?.status ?? 'stopped'}`}
      src={frameUrl}
      title={app.name}
      className="flex-1 w-full h-full border-0 bg-white"
      // 允许子应用使用 clipboard、modals 等
      allow="clipboard-read; clipboard-write"
    />
  );
}
