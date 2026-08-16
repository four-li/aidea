import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  ArrowLeft,
  Boxes,
  Bug,
  Clipboard,
  Pause,
  Play,
  RefreshCw,
  Server,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { ipc } from '../lib/ipc';
import type { AppManifest } from '../types/manifest';
import type {
  DiagnosticChannel,
  DiagnosticScope,
  DiagnosticSummary,
} from '../types/diagnostics';
import { Button } from './ui/button';

export interface DebugTarget {
  scope: DiagnosticScope;
  appId?: string;
}

interface Props {
  apps: AppManifest[];
  initialTarget?: DebugTarget;
  onClose: () => void;
  onOpenSettings: () => void;
}

const channelLabels: Record<DiagnosticChannel, string> = {
  runtime: '运行',
  install: '安装与更新',
  platform: '平台事件',
};

function targetKey(target: DebugTarget): string {
  return `${target.scope}:${target.appId ?? ''}`;
}

function channelsFor(target: DebugTarget): DiagnosticChannel[] {
  if (target.scope === 'official') return ['runtime', 'install', 'platform'];
  if (target.scope === 'builtin') return ['runtime', 'platform'];
  return ['platform'];
}

export function DebugPage({ apps, initialTarget, onClose, onOpenSettings }: Props) {
  const [summaries, setSummaries] = useState<DiagnosticSummary[]>([]);
  const [target, setTarget] = useState<DebugTarget>(initialTarget ?? { scope: 'aidea' });
  const [channel, setChannel] = useState<DiagnosticChannel>('platform');
  const [content, setContent] = useState('加载中...');
  const [paused, setPaused] = useState(false);

  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const channels = channelsFor(target);
  const selectedApp = target.appId ? appById.get(target.appId) : undefined;
  const selectedSummary = summaries.find(
    (summary) => summary.scope === target.scope && summary.app_id === target.appId,
  );

  const refreshSummaries = async () => {
    try {
      setSummaries(await ipc.listDiagnosticSummaries());
    } catch (error) {
      toast.error('读取日志概览失败', { description: String(error) });
    }
  };

  useEffect(() => {
    void refreshSummaries();
  }, []);

  useEffect(() => {
    setChannel(channelsFor(target)[0]);
  }, [target]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const load = async () => {
      try {
        const value = await ipc.readDiagnosticLog({
          scope: target.scope,
          app_id: target.appId,
          channel,
        });
        if (!cancelled) setContent(value || '暂无日志');
      } catch (error) {
        if (!cancelled) setContent(`读取日志失败：${String(error)}`);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [target, channel, paused]);

  const selectTarget = (next: DebugTarget) => {
    setTarget(next);
    setPaused(false);
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('已复制当前日志');
    } catch (error) {
      toast.error('复制日志失败', { description: String(error) });
    }
  };

  const renderItem = (item: DebugTarget, label: string) => {
    const summary = summaries.find(
      (entry) => entry.scope === item.scope && entry.app_id === item.appId,
    );
    const active = targetKey(target) === targetKey(item);
    return (
      <button
        key={targetKey(item)}
        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        onClick={() => selectTarget(item)}
      >
        <span className="truncate">{label}</span>
        {summary?.warn_count ? (
          <span className="ml-2 shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            {summary.warn_count}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回主页面" onClick={onClose}>
            <ArrowLeft size={16} />
          </Button>
          <Bug className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">调试</h1>
            <p className="text-xs text-muted-foreground">统一查看 aIdea 与子应用日志</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="刷新日志概览" onClick={() => void refreshSummaries()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="打开日志设置" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyContent()}>
            <Clipboard className="mr-2 h-4 w-4" />复制当前日志
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border p-4">
          <section className="mb-6" aria-labelledby="debug-group-aidea">
            <h3 id="debug-group-aidea" className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-foreground">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              aIdea
            </h3>
            <div className="ml-2 border-l border-border pl-2">
              {renderItem({ scope: 'aidea' }, '平台事件')}
            </div>
          </section>
          <section className="mb-6" aria-labelledby="debug-group-builtin">
            <h3 id="debug-group-builtin" className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-foreground">
              <AppWindow className="h-3.5 w-3.5 text-muted-foreground" />
              内置应用
            </h3>
            <div className="ml-2 border-l border-border pl-2">
              {apps.filter((app) => app.ui.mode === 'builtin' && app.ui.entry !== 'account-menu').map((app) => renderItem({ scope: 'builtin', appId: app.id }, app.name))}
            </div>
          </section>
          <section aria-labelledby="debug-group-official">
            <h3 id="debug-group-official" className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-foreground">
              <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
              官方应用
            </h3>
            <div className="ml-2 border-l border-border pl-2">
              {apps.filter((app) => app.ui.mode !== 'builtin' && app.ui.entry !== 'account-menu').map((app) => renderItem({ scope: 'official', appId: app.id }, app.name))}
            </div>
          </section>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">{selectedApp?.name ?? 'aIdea'}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSummary?.warn_count ?? 0} 条 WARN 及以上 · 最近 200 行
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label={paused ? '继续自动刷新' : '暂停自动刷新'} onClick={() => setPaused((value) => !value)}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mb-4 flex gap-1 border-b border-border">
            {channels.map((item) => (
              <button key={item} className={`border-b-2 px-3 py-2 text-sm ${channel === item ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setChannel(item)}>
                {channelLabels[item]}
              </button>
            ))}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
            {content}
          </pre>
        </main>
      </div>
    </div>
  );
}
