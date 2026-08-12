import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { FileText, Package, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ipc } from '../../lib/ipc';
import type { InstalledApp, OfficialApp } from '../../types/official-app';

interface Props {
  onAppsChanged?: () => void;
}

interface InstallProgress {
  id: string;
  phase: string;
  message: string;
}

export function appActionLabel(app: OfficialApp, isInstalled: boolean): string {
  if (!isInstalled) return '安装';
  return app.update_available ? '更新' : '已安装';
}

export function OfficialMarketPage({ onAppsChanged }: Props) {
  const [apps, setApps] = useState<OfficialApp[]>([]);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installStage, setInstallStage] = useState<string | null>(null);
  const [failedAppId, setFailedAppId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [market, records] = await Promise.all([
        ipc.listOfficialApps(),
        ipc.listInstalledOfficialApps(),
      ]);
      setApps(market);
      setInstalled(records);
    } catch (value) {
      setError(String(value));
    }
  };

  const refreshMarket = async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [market, records] = await Promise.all([
        ipc.refreshOfficialApps(),
        ipc.listInstalledOfficialApps(),
      ]);
      setApps(market);
      setInstalled(records);
    } catch (value) {
      setError(String(value));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
      await refreshMarket();
    })();
  }, []);

  useEffect(() => {
    const pending = listen<InstallProgress>('official-app-install-progress', (event) => {
      if (event.payload.id === busy) setInstallStage(event.payload.message);
    });
    return () => {
      void pending.then((dispose) => dispose());
    };
  }, [busy]);

  const install = async (app: OfficialApp, isInstalled: boolean) => {
    setBusy(app.id);
    setError(null);
    setFailedAppId(null);
    setInstallStage('准备安装…');
    try {
      if (isInstalled) await ipc.updateOfficialApp(app.id);
      else await ipc.installOfficialApp(app.id);
      await load();
      onAppsChanged?.();
    } catch (value) {
      setError(String(value));
      setFailedAppId(app.id);
    } finally {
      setBusy(null);
      setInstallStage(null);
    }
  };

  const openInstallLog = async () => {
    if (!failedAppId) return;
    try {
      setInstallLog(await ipc.readOfficialAppInstallLog(failedAppId));
      setLogOpen(true);
    } catch (value) {
      setError(`读取安装日志失败：${String(value)}`);
    }
  };

  const uninstall = async (app: OfficialApp) => {
    setBusy(app.id);
    setError(null);
    setFailedAppId(null);
    try {
      await ipc.uninstallOfficialApp(app.id);
      await load();
      onAppsChanged?.();
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-base font-medium text-foreground">应用市场</h1>
          <p className="mt-1 text-xs text-muted-foreground">由官方应用仓库提供版本和安装定义</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={refreshing}
          onClick={() => void refreshMarket()}
          aria-label="刷新"
        >
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} size={16} />
        </Button>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/30 px-6 py-3 text-sm text-destructive">
          <p className="min-w-0 break-words">{error}</p>
          {failedAppId && (
            <Button variant="outline" size="sm" onClick={() => void openInstallLog()}>
              <FileText size={14} />
              查看安装日志
            </Button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto p-6">
        {apps.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无可安装的官方应用
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {apps.map((app) => {
              const record = installed.find((item) => item.id === app.id);
              return (
                <div
                  key={app.id}
                  className="flex gap-3 rounded-md border border-border bg-card p-4"
                >
                  <Package className="mt-0.5 text-primary" size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium text-foreground">{app.name}</h2>
                      <div className="flex items-center gap-1">
                        {(!record || app.update_available) && (
                          <Button
                            size="sm"
                            variant={record ? 'outline' : 'default'}
                            disabled={busy === app.id}
                            onClick={() => void install(app, Boolean(record))}
                          >
                            {busy === app.id
                              ? '处理中'
                              : appActionLabel(app, Boolean(record))}
                          </Button>
                        )}
                        {record && !app.update_available && <Badge variant="secondary">已安装</Badge>}
                        {record && (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy === app.id}
                            onClick={() => void uninstall(app)}
                            aria-label={`卸载 ${app.name}`}
                          >
                            <Trash2 size={16} />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{app.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      v{app.version} · {app.category}
                      {record && ` · 已安装 v${record.version}`}
                    </p>
                    {record && app.update_available && app.update_notes && (
                      <p className="mt-2 text-xs text-muted-foreground">{app.update_notes}</p>
                    )}
                    {busy === app.id && installStage && (
                      <p className="mt-2 text-xs text-primary" role="status">
                        {installStage}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>安装日志</DialogTitle>
            <DialogDescription>显示最近 200 行安装输出。</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs text-foreground">
            {installLog}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
