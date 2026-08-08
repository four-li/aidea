import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { FileText, Package, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ipc } from '../../lib/ipc';
import type { InstalledPlugin, OfficialPlugin } from '../../types/plugin-market';

interface Props {
  onAppsChanged?: () => void;
}

interface InstallProgress {
  id: string;
  phase: string;
  message: string;
}

export function PluginMarketPage({ onAppsChanged }: Props) {
  const [plugins, setPlugins] = useState<OfficialPlugin[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installStage, setInstallStage] = useState<string | null>(null);
  const [failedPluginId, setFailedPluginId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [market, records] = await Promise.all([
        ipc.listOfficialPlugins(),
        ipc.listInstalledOfficialPlugins(),
      ]);
      setPlugins(market);
      setInstalled(records);
    } catch (value) {
      setError(String(value));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const pending = listen<InstallProgress>('official-plugin-install-progress', (event) => {
      if (event.payload.id === busy) setInstallStage(event.payload.message);
    });
    return () => {
      void pending.then((dispose) => dispose());
    };
  }, [busy]);

  const install = async (plugin: OfficialPlugin, isInstalled: boolean) => {
    setBusy(plugin.id);
    setError(null);
    setFailedPluginId(null);
    setInstallStage('准备安装…');
    try {
      if (isInstalled) await ipc.updateOfficialPlugin(plugin.id);
      else await ipc.installOfficialPlugin(plugin.id);
      await load();
      onAppsChanged?.();
    } catch (value) {
      setError(String(value));
      setFailedPluginId(plugin.id);
    } finally {
      setBusy(null);
      setInstallStage(null);
    }
  };

  const openInstallLog = async () => {
    if (!failedPluginId) return;
    try {
      setInstallLog(await ipc.readOfficialPluginInstallLog(failedPluginId));
      setLogOpen(true);
    } catch (value) {
      setError(`读取安装日志失败：${String(value)}`);
    }
  };

  const uninstall = async (plugin: OfficialPlugin) => {
    setBusy(plugin.id);
    setError(null);
    setFailedPluginId(null);
    try {
      await ipc.uninstallOfficialPlugin(plugin.id);
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
          <h1 className="text-base font-medium text-foreground">官方插件</h1>
          <p className="mt-1 text-xs text-muted-foreground">由 aIdea 发布版本和安装定义</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void load()} aria-label="刷新">
          <RefreshCw size={16} />
        </Button>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-destructive/30 px-6 py-3 text-sm text-destructive">
          <p className="min-w-0 break-words">{error}</p>
          {failedPluginId && (
            <Button variant="outline" size="sm" onClick={() => void openInstallLog()}>
              <FileText size={14} />
              查看安装日志
            </Button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto p-6">
        {plugins.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无可安装的官方插件
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {plugins.map((plugin) => {
              const record = installed.find((item) => item.id === plugin.id);
              return (
                <div
                  key={plugin.id}
                  className="flex gap-3 rounded-md border border-border bg-card p-4"
                >
                  <Package className="mt-0.5 text-primary" size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium text-foreground">{plugin.name}</h2>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant={record ? 'outline' : 'default'}
                          disabled={busy === plugin.id}
                          onClick={() => void install(plugin, Boolean(record))}
                        >
                          {busy === plugin.id ? '处理中' : record ? '更新' : '安装'}
                        </Button>
                        {record && (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy === plugin.id}
                            onClick={() => void uninstall(plugin)}
                            aria-label={`卸载 ${plugin.name}`}
                          >
                            <Trash2 size={16} />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{plugin.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      v{plugin.version} · {plugin.category}
                    </p>
                    {busy === plugin.id && installStage && (
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
