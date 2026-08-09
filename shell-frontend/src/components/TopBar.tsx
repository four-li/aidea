// 顶部横排导航栏：Chrome 风格标签页
// macOS 圆点（左侧）+ 子应用标签（中间）
import { AppIcon } from './AppIcon';
import { AppContextMenu } from './AppContextMenu';
import { AccountMenu } from './AccountMenu';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  apps: AppManifest[];
  appOrder: string[];
  activeAppId: string | null;
  states: Record<string, AppState>;
  onSelectApp: (id: string) => void;
  onRefreshStates: () => void;
  onShowLog: (app: AppManifest) => void;
  onOpenSettings: () => void;
}

export function TopBar({
  apps,
  appOrder,
  activeAppId,
  states,
  onSelectApp,
  onRefreshStates,
  onShowLog,
  onOpenSettings,
}: Props) {
  const sortedApps = appOrder
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is AppManifest => a !== undefined);

  return (
    <div className="h-topbar bg-background flex items-center overflow-hidden">
      {/* macOS 拖拽区（红绿圆点浮在这里） */}
      <div className="w-20 h-full flex-shrink-0" data-tauri-drag-region />

      {/* 子应用标签（仅用于切换） */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 px-1">
        {sortedApps.map((app) => (
          <AppContextMenu
            key={app.id}
            app={app}
            state={states[app.id]}
            onRefresh={onRefreshStates}
            onShowLog={onShowLog}
          >
            <button
              onClick={() => onSelectApp(app.id)}
              className={`h-full px-3.5 flex items-center gap-2 text-tab flex-shrink-0 transition-colors ${
                app.issue ?? states[app.id]?.issue
                  ? 'text-muted-foreground opacity-60 hover:bg-card/50'
                  : app.id === activeAppId
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
              }`}
            >
              <AppIcon app={app} state={states[app.id]} />
              <span className="max-w-[120px] truncate">{app.name}</span>
            </button>
          </AppContextMenu>
        ))}
      </div>

      <AccountMenu onOpenSettings={onOpenSettings} />
    </div>
  );
}
