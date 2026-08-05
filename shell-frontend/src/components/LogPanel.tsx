// 日志面板：使用 shadcn Sheet 从底部滑出
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import type { AppManifest } from '../types/manifest';

interface Props {
  app: AppManifest | null;
  onClose: () => void;
}

export function LogPanel({ app, onClose }: Props) {
  const [logs, setLogs] = useState<string>('加载中...');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!app || paused) return;
    let cancelled = false;

    const fetchLog = async () => {
      if (!app) return;
      try {
        const content = await invoke<string>('read_app_log', { id: app.id });
        if (!cancelled) setLogs(content || '日志为空');
      } catch (e) {
        if (!cancelled) setLogs(`读取日志失败: ${e}`);
      }
    };

    fetchLog();
    const timer = setInterval(fetchLog, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [app, paused]);

  return (
    <Sheet open={!!app} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="h-1/2 p-0 flex flex-col">
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border space-y-0">
          <SheetTitle className="text-sm">{app?.name} 日志</SheetTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)}>
              {paused ? '继续' : '暂停'}
            </Button>
          </div>
        </SheetHeader>
        <pre className="flex-1 overflow-auto p-3 text-xs text-foreground font-mono whitespace-pre-wrap">
          {logs}
        </pre>
      </SheetContent>
    </Sheet>
  );
}
