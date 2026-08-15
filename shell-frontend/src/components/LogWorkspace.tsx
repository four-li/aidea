import { useEffect, useMemo, useState } from 'react';
import { Clipboard, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { ipc } from '../lib/ipc';
import type { AppManifest, AppState } from '../types/manifest';
import type { DiagnosticChannel, DiagnosticScope } from '../types/diagnostics';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

export interface LogWorkspaceTarget {
  scope: DiagnosticScope;
  id?: string;
  name: string;
  version?: string;
  address?: string;
  status?: AppState['status'];
}

interface Props {
  target: LogWorkspaceTarget | null;
  onClose: () => void;
}

const LABELS: Record<DiagnosticChannel, string> = {
  runtime: '应用运行',
  install: '安装与更新',
  platform: 'aIdea 事件',
};

export function targetFromManifest(app: AppManifest): LogWorkspaceTarget {
  const scope: DiagnosticScope = app.ui.mode === 'builtin' ? 'builtin' : 'official';
  return { scope, id: app.id, name: app.name, version: app.version, address: app.ui.url };
}

export function LogWorkspace({ target, onClose }: Props) {
  const channels = useMemo<DiagnosticChannel[]>(() => {
    if (!target) return [];
    if (target.scope === 'official') return ['runtime', 'install', 'platform'];
    if (target.scope === 'builtin') return ['runtime', 'platform'];
    return ['platform'];
  }, [target]);
  const [channel, setChannel] = useState<DiagnosticChannel>('runtime');
  const [content, setContent] = useState('加载中...');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!target) return;
    setChannel(channels[0] ?? 'platform');
    setPaused(false);
  }, [target, channels]);

  useEffect(() => {
    if (!target || paused || !channels.includes(channel)) return;
    let cancelled = false;
    const fetchLog = async () => {
      try {
        const value = await ipc.readDiagnosticLog({
          scope: target.scope,
          app_id: target.id,
          channel,
        });
        if (!cancelled) setContent(value || '暂无日志');
      } catch (error) {
        if (!cancelled) setContent(`读取日志失败：${String(error)}`);
      }
    };
    void fetchLog();
    const timer = window.setInterval(() => void fetchLog(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [target, channel, paused, channels]);

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('已复制当前日志');
    } catch (error) {
      toast.error('复制日志失败', { description: String(error) });
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[78vh] w-[min(1100px,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-start justify-between border-b border-border px-6 py-4 space-y-0">
          <div>
            <DialogTitle>{target?.name ?? '日志'}</DialogTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              {[target?.version && `v${target.version}`, target?.address, target?.status]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label={paused ? '继续自动刷新' : '暂停自动刷新'} onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copyContent()}>
              <Clipboard size={15} />
              复制当前内容
            </Button>
          </div>
        </DialogHeader>
        <Tabs value={channel} onValueChange={(value) => setChannel(value as DiagnosticChannel)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-6 mt-4 w-fit">
            {channels.map((item) => (
              <TabsTrigger key={item} value={item}>
                {target?.scope === 'aidea' ? 'aIdea 系统' : LABELS[item]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
            <span>{LABELS[channel]} · 最近 200 行</span>
            <span>{paused ? '已暂停' : '自动刷新中'}</span>
          </div>
          <pre className="mx-6 mb-6 min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-4 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
            {content}
          </pre>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
