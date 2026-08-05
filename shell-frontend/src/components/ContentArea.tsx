// 主内容区容器：webview 子应用保持挂载避免 iframe 重载闪烁，
// builtin/none 子应用按需渲染
import { useMemo } from 'react';
import type { AppManifest, AppState } from '../types/manifest';
import { WebviewFrame } from './WebviewFrame';
import { BuiltinPage } from './BuiltinPage';
import { EmptyState } from './EmptyState';

interface Props {
  apps: AppManifest[];
  activeApp: AppManifest | null;
  states: Record<string, AppState>;
}

export function ContentArea({ apps, activeApp, states }: Props) {
  // 所有 webview 子应用都挂载，用 CSS 控制显隐，避免切换时 iframe 重载
  const webviewApps = useMemo(() => apps.filter((a) => a.ui.mode === 'webview'), [apps]);

  if (!activeApp) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* webview 子应用：全部挂载，非活跃的隐藏 */}
      {webviewApps.map((app) => (
        <div
          key={app.id}
          className="absolute inset-0"
          style={{ visibility: app.id === activeApp.id ? 'visible' : 'hidden' }}
        >
          <WebviewFrame app={app} state={states[app.id]} />
        </div>
      ))}

      {/* builtin / none 子应用：按需渲染 */}
      {activeApp.ui.mode === 'builtin' && <BuiltinPage app={activeApp} />}
      {activeApp.ui.mode === 'none' && (
        <div className="flex-1 flex items-center justify-center bg-background">
          <p className="text-muted-foreground text-sm">
            {activeApp.name}（后台运行中，无 UI）
          </p>
        </div>
      )}
    </div>
  );
}
