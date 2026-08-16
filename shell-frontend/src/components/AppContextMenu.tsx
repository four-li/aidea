// 应用图标右键菜单：使用 shadcn ContextMenu
// 右键触发，支持启动/停止/重启/进入调试
// ContextMenu 只响应右键（contextmenu 事件），左键切换 tab 和 dnd-kit 拖拽互不干扰
import { ReactNode } from 'react';
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
  const isRunning = state?.status === 'running';
  const transitioning = state?.status === 'starting' || state?.status === 'stopping';
  const hasProcess = !!app.process;
  const hasIssue = !!(app.issue ?? state?.issue);

  // 内置应用没有进程控制项，不挂载空的右键菜单浮层。
  if (!hasProcess) return <>{children}</>;

  const handleStart = async () => {
    try {
      const request = ipc.startApp(app.id);
      onRefresh();
      await request;
      onRefresh();
    } catch (e) {
      console.error('启动失败:', e);
      toast.error('启动失败', { description: String(e) });
    }
  };

  const handleStop = async () => {
    try {
      const request = ipc.stopApp(app.id);
      onRefresh();
      await request;
      onRefresh();
    } catch (e) {
      console.error('停止失败:', e);
      toast.error('停止失败', { description: String(e) });
    }
  };

  const handleRestart = async () => {
    try {
      if (isRunning) {
        const stopRequest = ipc.stopApp(app.id);
        onRefresh();
        await stopRequest;
      }
      const startRequest = ipc.startApp(app.id);
      onRefresh();
      await startRequest;
      onRefresh();
    } catch (e) {
      console.error('重启失败:', e);
      toast.error('重启失败', { description: String(e) });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {!isRunning && !transitioning && (
          <ContextMenuItem onClick={handleStart}>{hasIssue ? '重试启动' : '启动'}</ContextMenuItem>
        )}
        {isRunning && !transitioning && (
          <>
            <ContextMenuItem onClick={handleStop}>停止</ContextMenuItem>
            <ContextMenuItem onClick={handleRestart}>重启</ContextMenuItem>
          </>
        )}
        {transitioning && (
          <ContextMenuItem disabled>{state?.status === 'starting' ? '启动中...' : '停止中...'}</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onShowLog(app)}>调试</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
