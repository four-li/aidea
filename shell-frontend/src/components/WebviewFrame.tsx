// webview 模式渲染：用 iframe 嵌入子应用 web server
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  app: AppManifest;
  state?: AppState;
}

export function WebviewFrame({ app, state }: Props) {
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
  return (
    <iframe
      key={`${app.id}-${state?.status ?? 'stopped'}`}
      src={url}
      title={app.name}
      className="flex-1 w-full h-full border-0 bg-white"
      // 允许子应用使用 clipboard、modals 等
      allow="clipboard-read; clipboard-write"
    />
  );
}
