// 主内容区容器：webview 子应用保持挂载避免 iframe 重载闪烁，
// builtin/none 子应用按需渲染
import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { AppManifest, AppState } from '../types/manifest';
import { WebviewFrame } from './WebviewFrame';
import { BuiltinPage } from './BuiltinPage';
import { EmptyState } from './EmptyState';
import type { AppFrameRef } from '../hooks/useAppBridge';
import type { ThemeMode } from '../hooks/useTheme';

interface Props {
  apps: AppManifest[];
  activeApp: AppManifest | null;
  states: Record<string, AppState>;
  theme?: Exclude<ThemeMode, 'system'>;
  onFrameRef?: AppFrameRef;
  onBackToMain?: () => void;
}

export function ContentArea({ apps, activeApp, states, theme, onFrameRef, onBackToMain }: Props) {
  // 所有 webview 子应用都挂载，用 CSS 控制显隐，避免切换时 iframe 重载
  const webviewApps = useMemo(() => apps.filter((a) => a.ui.mode === 'webview'), [apps]);

  if (!activeApp) {
    return <EmptyState />;
  }

  const issue = activeApp.issue ?? states[activeApp.id]?.issue;
  if (issue) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-md border border-border p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert size={18} className="text-muted-foreground" />
            应用异常
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{issue.message}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            请在设置的应用管理中刷新市场、更新或卸载该应用。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* webview 子应用：全部挂载，非活跃的隐藏 */}
        {webviewApps.map((app) => (
          <div
            key={app.id}
            className="absolute inset-0"
            style={{ visibility: app.id === activeApp.id ? 'visible' : 'hidden' }}
          >
            <WebviewFrame
              app={app}
              state={states[app.id]}
              theme={theme}
              onFrameRef={onFrameRef}
            />
          </div>
        ))}

        {/* builtin / none 子应用：按需渲染 */}
        {activeApp.ui.mode === 'builtin' && (
          <div className="absolute inset-0 min-h-0">
            <BuiltinPage app={activeApp} onBackToMain={onBackToMain} />
          </div>
        )}
        {activeApp.ui.mode === 'none' && (
          <div className="flex-1 flex items-center justify-center bg-background">
            <p className="text-muted-foreground text-sm">{activeApp.name}（后台运行中，无 UI）</p>
          </div>
        )}
      </div>
    </div>
  );
}
