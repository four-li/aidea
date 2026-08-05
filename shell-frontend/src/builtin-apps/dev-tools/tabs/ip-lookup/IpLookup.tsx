// IP 查询 tab
// 单列纵向布局：公网 IP 多源逐个展示（方便对比，开 proxy 时不同源 IP 可能不同）
// 内网 IP 折叠在最下面（不重要）
import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Copy,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { copyToClipboard } from '../../../../lib/clipboard';
import { ipc } from '../../../../lib/ipc';
import type { NetworkInfo, PublicIpSourceResult } from '../../../../types/network';

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: NetworkInfo }
  | { status: 'error'; message: string };

export function IpLookup() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const data = await ipc.getNetworkInfo();
      setState({ status: 'ok', data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copy = async (text: string) => {
    try {
      await copyToClipboard(text);
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <RefreshCw size={16} className="mr-2 animate-spin" />
        加载中...
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle size={32} className="text-destructive" />
        <div className="text-sm text-muted-foreground">查询失败：{state.message}</div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw size={14} className="mr-1.5" />
          重试
        </Button>
      </div>
    );
  }

  const { local_ips, public: sources } = state.data;
  return (
    <div className="flex flex-col h-full gap-3 overflow-auto">
      {/* 顶部工具栏：刷新按钮 */}
      <div className="flex justify-end">
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={load}>
                <RefreshCw size={14} className="mr-1.5" />
                刷新
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">重新查询</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* 公网 IP 多源列表 */}
      <PublicIpList sources={sources} onCopy={copy} />

      {/* 内网 IP（折叠在底部，不重要） */}
      <LocalIpList ips={local_ips} onCopy={copy} />
    </div>
  );
}

/** 公网 IP 多源列表：纵向逐个展示，IP 不一致时高亮警告 */
function PublicIpList({
  sources,
  onCopy,
}: {
  sources: PublicIpSourceResult[];
  onCopy: (text: string) => void;
}) {
  // 收集所有成功源的 IP，判断是否不一致
  const uniqueIps = useMemo(() => {
    const ips = sources
      .filter((s) => s.info && s.info.ip)
      .map((s) => s.info!.ip);
    return Array.from(new Set(ips));
  }, [sources]);

  const hasMismatch = uniqueIps.length > 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">公网 IP</div>

      {/* IP 不一致警告条 */}
      {hasMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2.5 text-xs">
          <AlertTriangle size={14} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-yellow-700 dark:text-yellow-200">
            检测到不同数据源返回了不同的公网 IP（共 {uniqueIps.length} 个），可能开启了代理或分流。
          </div>
        </div>
      )}

      {/* 每个源一张卡片 */}
      <div className="flex flex-col gap-2">
        {sources.map((s) => (
          <SourceCard
            key={s.source}
            source={s}
            hasMismatch={hasMismatch}
            onCopy={onCopy}
          />
        ))}
      </div>
    </div>
  );
}

/** 单个数据源卡片 */
function SourceCard({
  source,
  hasMismatch,
  onCopy,
}: {
  source: PublicIpSourceResult;
  hasMismatch: boolean;
  onCopy: (text: string) => void;
}) {
  // 失败的源
  if (source.error) {
    return (
      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm">
          <XCircle size={14} className="text-destructive flex-shrink-0" />
          <span className="font-mono text-muted-foreground">{source.source}</span>
        </div>
        <div className="mt-1 pl-6 text-xs text-destructive">{source.error}</div>
      </div>
    );
  }

  // 成功的源
  const info = source.info!;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      {/* 来源 + IP + 复制 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-xs text-primary flex-shrink-0">
            <CheckCircle2 size={12} />
            {source.source}
          </span>
          <span className="font-mono text-base font-medium truncate">{info.ip}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 flex-shrink-0"
          aria-label={`复制 ${info.ip}`}
          onClick={() => onCopy(info.ip)}
        >
          <Copy size={12} />
        </Button>
      </div>

      {/* 地区 + ISP（简化显示） */}
      {(info.region || info.org) && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {info.region && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground w-10 flex-shrink-0">地区</span>
              <span className="font-mono truncate">{info.region}</span>
            </div>
          )}
          {info.org && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground w-10 flex-shrink-0">ISP</span>
              <span className="font-mono truncate">{info.org}</span>
            </div>
          )}
        </div>
      )}

      {/* 当出现 IP 不一致时，给当前源加一个角标提示 */}
      {hasMismatch && (
        <div className="mt-2 text-xs text-yellow-600 dark:text-yellow-300/80">
          与其他源 IP 不同
        </div>
      )}
    </div>
  );
}

/** 内网 IP 列表：底部折叠展示，不重要 */
function LocalIpList({
  ips,
  onCopy,
}: {
  ips: string[];
  onCopy: (text: string) => void;
}) {
  return (
    <div className="mt-2 rounded-md border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground mb-1.5">内网 IP</div>
      {ips.length === 0 ? (
        <div className="text-xs text-muted-foreground">未发现内网 IP</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {ips.map((ip) => (
            <li
              key={ip}
              className="flex items-center justify-between gap-2 px-1 py-0.5 rounded hover:bg-muted/50"
            >
              <span className="font-mono text-xs">{ip}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1"
                aria-label={`复制 ${ip}`}
                onClick={() => onCopy(ip)}
              >
                <Copy size={11} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
