// 单个应用图标：图标 + 运行状态点（用于顶部标签栏）
// ui.icon 语义：含 / 或 . 当文件路径处理，否则当 lucide 图标名处理
// 图标加载失败时回退到首字母占位
import { useState } from 'react';
import { ICONS } from './IconPicker';
import type { AppManifest, AppState } from '../types/manifest';

function isFilePath(icon?: string): boolean {
  if (!icon) return false;
  return icon.includes('/') || icon.includes('.');
}

interface Props {
  app: AppManifest;
  state?: AppState;
}

export function AppIcon({ app, state }: Props) {
  const isRunning = state?.status === 'running';
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
      {showFileIcon && (
        <img
          src={iconSpec}
          alt={app.name}
          className="w-4 h-4"
          onError={() => setIconError(true)}
        />
      )}
      {showLucideIcon && <LucideComp size={16} />}
      {showFallback && (
        <span className="text-xs font-medium">
          {app.name.charAt(0).toUpperCase()}
        </span>
      )}
      {showStatusDot && isRunning && (
        <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-primary rounded-full border border-background" />
      )}
    </span>
  );
}
