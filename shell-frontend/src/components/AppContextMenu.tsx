// 应用图标右键菜单：使用 shadcn ContextMenu
// 右键触发，支持启动/停止/重启/查看日志
// ContextMenu 只响应右键（contextmenu 事件），左键切换 tab 和 dnd-kit 拖拽互不干扰
import { useState, ReactNode } from 'react';
import { toast } from 'sonner';
import { ipc } from '../lib/ipc';
import type { AppManifest, AppState } from '../types/manifest';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';

interface Props {
  app: AppManifest;
  state?: AppState;
  onRefresh: () => void;
  onShowLog: (app: AppManifest) => void;
  children: ReactNode;
}

export function AppContextMenu({ app, state, onRefresh, onShowLog, children }: Props) {
  const [starting, setStarting] = useState(false);
  const isRunning = state?.status === 'running';
  const hasProcess = !!app.process;

  const handleStart = async () => {
    setStarting(true);
    try {
      await ipc.startApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('启动失败:', e);
      toast.error('启动失败', { description: String(e) });
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await ipc.stopApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('停止失败:', e);
      toast.error('停止失败', { description: String(e) });
    }
  };

  const handleRestart = async () => {
    setStarting(true);
    try {
      if (isRunning) await ipc.stopApp(app.id);
      await ipc.startApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('重启失败:', e);
      toast.error('重启失败', { description: String(e) });
    } finally {
      setStarting(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {hasProcess && (
          <>
            {!isRunning && (
              <ContextMenuItem onClick={handleStart} disabled={starting}>
                {starting ? '启动中...' : '启动'}
              </ContextMenuItem>
            )}
            {isRunning && (
              <>
                <ContextMenuItem onClick={handleStop}>停止</ContextMenuItem>
                <ContextMenuItem onClick={handleRestart} disabled={starting}>
                  重启
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onShowLog(app)}>查看日志</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
