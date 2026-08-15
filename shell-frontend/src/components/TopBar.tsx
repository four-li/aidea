// 顶部横排导航栏：Chrome 风格标签页
// macOS 圆点（左侧）+ 子应用标签（中间）
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { AppIcon, processStatusLabel } from './AppIcon';
import { AppContextMenu } from './AppContextMenu';
import { AccountMenu } from './AccountMenu';
import type { AppManifest, AppState } from '../types/manifest';
import type { ThemeMode } from '../hooks/useTheme';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface Props {
  apps: AppManifest[];
  appOrder: string[];
  activeAppId: string | null;
  states: Record<string, AppState>;
  onSelectApp: (id: string) => void;
  onRefreshStates: () => void;
  onShowLog: (app: AppManifest) => void;
  onOpenSettings: () => void;
  onOpenDeveloperGuide?: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  updateAvailable?: boolean;
  onOpenUpdate?: () => void;
}

function TopBarProcessStatus({ app, state }: { app: AppManifest; state?: AppState }) {
  const issue = app.issue ?? state?.issue;
  const status = issue ? 'failed' : state?.status ?? 'stopped';
  const label = processStatusLabel(state, !!issue);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center"
          aria-label={`${app.name}：${label}`}
        >
          {status === 'running' && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
          )}
          {status === 'starting' && (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
          {status === 'stopping' && (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {status === 'stopped' && (
            <span className="h-2 w-2 rounded-full border border-muted-foreground" />
          )}
          {status === 'failed' && <TriangleAlert className="h-3.5 w-3.5 text-destructive" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{issue ? `${label}：${issue.message}` : label}</TooltipContent>
    </Tooltip>
  );
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
  onOpenDeveloperGuide,
  themeMode,
  onThemeChange,
  updateAvailable = false,
  onOpenUpdate = () => undefined,
}: Props) {
  const sortedApps = appOrder
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is AppManifest => a !== undefined);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-topbar bg-background flex select-none items-center overflow-hidden">
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
              className={`h-full min-w-[120px] px-3.5 flex select-none items-center gap-2 text-tab flex-shrink-0 transition-colors focus-visible:ring-0 focus-visible:ring-offset-0 ${
                app.issue ?? states[app.id]?.issue
                  ? 'text-muted-foreground opacity-60 hover:bg-card/50'
                  : app.id === activeAppId
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
              }`}
            >
              <AppIcon app={app} state={states[app.id]} showProcessStatus={false} />
              <span className="max-w-[120px] truncate">{app.name}</span>
              {app.process && <TopBarProcessStatus app={app} state={states[app.id]} />}
            </button>
          </AppContextMenu>
        ))}
      </div>

      <AccountMenu
        onOpenSettings={onOpenSettings}
        onOpenDeveloperGuide={onOpenDeveloperGuide}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        updateAvailable={updateAvailable}
        onOpenUpdate={onOpenUpdate}
      />
      </div>
    </TooltipProvider>
  );
}
