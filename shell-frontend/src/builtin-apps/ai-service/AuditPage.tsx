import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { ipc } from '../../lib/ipc';
import type { AiServiceAuditEvent, AiServiceAuditRunDetail, AiServiceAuditRunSummary } from '../../types/ai-service';

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function usageText(usage: { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null }) {
  if (usage.total_tokens === null && usage.input_tokens === null && usage.output_tokens === null) return '未提供';
  return `输入 ${usage.input_tokens ?? '-'} · 输出 ${usage.output_tokens ?? '-'} · 总计 ${usage.total_tokens ?? '-'}`;
}

function statusLabel(status: string) {
  return status === 'succeeded' ? '成功' : status === 'failed' ? '失败' : '进行中';
}

export function AuditPage() {
  const [enabled, setEnabled] = useState(true);
  const [runs, setRuns] = useState<AiServiceAuditRunSummary[]>([]);
  const [selected, setSelected] = useState<AiServiceAuditRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [setting, items] = await Promise.all([
        ipc.getAiServiceAuditSettings(),
        ipc.listAiServiceAuditRuns(),
      ]);
      setEnabled(setting);
      setRuns(items);
      setSelected((current) => current && items.some((item) => item.id === current.run.id) ? current : null);
    } catch (error) {
      toast.error('读取审计记录失败', { description: String(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateEnabled = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    try {
      await ipc.saveAiServiceAuditSettings(next);
    } catch (error) {
      setEnabled(previous);
      toast.error('保存审计开关失败', { description: String(error) });
    }
  };

  const openRun = async (id: string) => {
    try {
      const detail = await ipc.getAiServiceAuditRun(id);
      setSelected(detail);
    } catch (error) {
      toast.error('读取调用详情失败', { description: String(error) });
    }
  };

  return (
    <div className="flex h-full min-h-[24rem] flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">审计记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            记录调用耗时、Agent loop、工具事件和 token 用量，不保存业务正文。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="ai-service-audit-enabled" className="text-sm text-muted-foreground">记录新调用</label>
          <Switch id="ai-service-audit-enabled" checked={enabled} onCheckedChange={(value) => void updateEnabled(value)} />
          <Button variant="ghost" size="icon" aria-label="刷新审计记录" onClick={() => void load()}>
            <RefreshCw />
          </Button>
        </div>
      </div>
      {!enabled && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          已关闭审计。新的调用不会记录，历史记录仍然保留。
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取审计记录...</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.6fr)]">
          <div className="min-h-0 overflow-auto rounded-md border border-border">
            {runs.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">暂无调用记录。</p>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`flex w-full flex-col gap-1 border-b border-border p-3 text-left last:border-b-0 hover:bg-muted/40 ${selected?.run.id === run.id ? 'bg-muted/50' : ''}`}
                  onClick={() => void openRun(run.id)}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>{run.service}</span>
                    <Badge variant={run.status === 'succeeded' ? 'secondary' : 'outline'}>{statusLabel(run.status)}</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTime(run.started_at)}</span>
                  <span className="text-xs text-muted-foreground">
                    {run.elapsed_ms ?? '-'} ms · {run.loop_count} loop · {usageText(run.usage)}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="min-h-0 overflow-auto rounded-md border border-border p-4">
            {selected ? <AuditDetail detail={selected} /> : <p className="text-sm text-muted-foreground">选择一次调用查看事件明细。</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditDetail({ detail }: { detail: AiServiceAuditRunDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">调用详情</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail.run.service} · {statusLabel(detail.run.status)} · 总耗时 {detail.run.elapsed_ms ?? '-'} ms
        </p>
        {detail.run.error_summary && <p className="mt-2 text-sm text-destructive">{detail.run.error_summary}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {detail.events.map((event: AiServiceAuditEvent) => (
          <div key={`${event.sequence}-${event.name}`} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{event.name}</span>
              <span className="text-xs text-muted-foreground">{event.elapsed_ms} ms · {event.event_type}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{usageText(event.usage)}</p>
            {event.summary && <p className="mt-1 text-xs text-muted-foreground">{event.summary}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
