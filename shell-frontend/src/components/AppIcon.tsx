// 单个应用图标：图标 + 运行状态点（用于顶部标签栏）
// ui.icon 语义：含 / 或 . 当文件路径处理，否则当 lucide 图标名处理
// 图标加载失败时回退到首字母占位
import { useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { ICONS } from './IconPicker';
import type { AppManifest, AppState } from '../types/manifest';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

function isFilePath(icon?: string): boolean {
  if (!icon) return false;
  return icon.includes('/') || icon.includes('.');
}

interface Props {
  app: AppManifest;
  state?: AppState;
  showProcessStatus?: boolean;
}

export function processStatusLabel(state?: AppState, issue?: boolean): string {
  if (issue) return '启动失败';
  return {
    starting: '启动中',
    running: '运行中',
    stopping: '停止中',
    stopped: '已停止',
  }[state?.status ?? 'stopped'];
}

function processStatusDescription(state?: AppState, issue?: AppState['issue']): string {
  const label = processStatusLabel(state, !!issue);
  return issue ? `${label}：${issue.message}` : label;
}

export function ProcessStatusIndicator({ state, issue }: { state?: AppState; issue?: boolean }) {
  const status = issue ? 'failed' : state?.status ?? 'stopped';
  const label = processStatusLabel(state, issue);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-label={label}>
      {status === 'running' && <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />}
      {status === 'starting' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />}
      {status === 'stopping' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
      {status === 'stopped' && <span className="h-2 w-2 rounded-full border border-muted-foreground" />}
      {status === 'failed' && <TriangleAlert className="h-3.5 w-3.5 text-destructive" />}
      <span>{label}</span>
    </span>
  );
}

export function AppIcon({ app, state, showProcessStatus = true }: Props) {
  const issue = app.issue ?? state?.issue;
  const showStatusDot = !!app.process;
  const iconSpec = app.ui.icon;
  const [iconError, setIconError] = useState(false);

  const isFile = isFilePath(iconSpec);
  const LucideComp = !isFile ? ICONS[iconSpec ?? ''] : undefined;
  const showFileIcon = isFile && !iconError;
  const showLucideIcon = !isFile && LucideComp !== undefined;
  const showFallback = !showFileIcon && !showLucideIcon;

  return (
    <span className="relative flex items-center justify-center w-4 h-4">
      {issue && <TriangleAlert size={16} className="text-muted-foreground" aria-label="应用异常" />}
      {!issue && showFileIcon && (
        <img
          src={iconSpec}
          alt={app.name}
          className="w-4 h-4"
          onError={() => setIconError(true)}
        />
      )}
      {!issue && showLucideIcon && <LucideComp size={16} />}
      {!issue && showFallback && (
        <span className="text-xs font-medium">
          {app.name.charAt(0).toUpperCase()}
        </span>
      )}
      {showProcessStatus && showStatusDot && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-background"
              aria-label={`${app.name}：${processStatusDescription(state, issue)}`}
            >
              {issue && <TriangleAlert className="h-3 w-3 text-destructive" />}
              {!issue && state?.status === 'starting' && (
                <LoaderCircle className="h-3 w-3 animate-spin text-primary" />
              )}
              {!issue && state?.status === 'stopping' && <LoaderCircle className="h-3 w-3 animate-spin text-muted-foreground" />}
              {!issue && state?.status === 'running' && (
                <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
              )}
              {!issue && (!state || state.status === 'stopped') && (
                <span className="h-2 w-2 rounded-full border border-muted-foreground bg-background" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{processStatusDescription(state, issue)}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
