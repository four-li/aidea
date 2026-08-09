import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, Play, RotateCcw, Settings, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ipc } from '../lib/ipc';
import type { AppManifest, AppState, AppUserSettings } from '../types/manifest';
import { DevToolsSettingsPage } from '../builtin-apps/dev-tools/DevToolsSettingsPage';
import { AppIcon } from './AppIcon';
import { WebviewFrame } from './WebviewFrame';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface Props {
  onAppsChanged: () => void;
  onOpenMarket: () => void;
  onShowLog: (app: AppManifest) => void;
}

const defaultSettings: AppUserSettings = { visible: true, startup_mode: 'manual' };

function actionLabel(action: 'start' | 'stop' | 'restart' | 'hide' | 'show' | 'uninstall'): string {
  return {
    start: '启动',
    stop: '停止',
    restart: '重启',
    hide: '隐藏',
    show: '恢复显示',
    uninstall: '卸载',
  }[action];
}

export function AppManagementPage({ onAppsChanged, onOpenMarket, onShowLog }: Props) {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [settings, setSettings] = useState<Record<string, AppUserSettings>>({});
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [allApps, config, appStates] = await Promise.all([
        ipc.listApps(),
        ipc.getShellConfig(),
        ipc.getAppStates(),
      ]);
      setApps(allApps);
      setSettings(config.app_settings);
      setStates(Object.fromEntries(appStates.map((state) => [state.id, state])));
    } catch (error) {
      toast.error('读取应用状态失败', { description: String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (app: AppManifest, next: AppUserSettings) => {
    setPendingId(app.id);
    try {
      await ipc.saveAppUserSettings(app.id, next);
      setSettings((current) => ({ ...current, [app.id]: next }));
      onAppsChanged();
    } catch (error) {
      toast.error('保存应用设置失败', { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const controlProcess = async (app: AppManifest, action: 'start' | 'stop' | 'restart') => {
    setPendingId(app.id);
    try {
      if (action === 'stop') await ipc.stopApp(app.id);
      if (action === 'restart') {
        await ipc.stopApp(app.id);
        await ipc.startApp(app.id);
      }
      if (action === 'start') await ipc.startApp(app.id);
      await load();
    } catch (error) {
      toast.error(`${actionLabel(action)}失败`, { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const uninstall = async (app: AppManifest) => {
    setPendingId(app.id);
    try {
      await ipc.uninstallOfficialPlugin(app.id);
      await load();
      onAppsChanged();
    } catch (error) {
      toast.error('卸载失败', { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const resetSettings = async (app: AppManifest) => {
    setPendingId(app.id);
    try {
      await ipc.resetAppSettings(app.id);
      await load();
      onAppsChanged();
    } catch (error) {
      toast.error('重置设置失败', { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const openSettings = async (app: AppManifest) => {
    setPendingId(app.id);
    try {
      if (app.ui.mode === 'webview' && app.process && states[app.id]?.status !== 'running') {
        await ipc.startApp(app.id);
        await load();
      }
      setDetailId(app.id);
    } catch (error) {
      toast.error('打开应用设置失败', { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const detailApp = apps.find((app) => app.id === detailId) ?? null;

  if (detailApp) {
    const appSettings = settings[detailApp.id] ?? defaultSettings;
    return (
      <AppSettingsDetail
        app={detailApp}
        state={states[detailApp.id]}
        appSettings={appSettings}
        pending={pendingId === detailApp.id}
        onBack={() => setDetailId(null)}
        onSaveSettings={(next) => void saveSettings(detailApp, next)}
        onResetSettings={() => void resetSettings(detailApp)}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">已安装应用</p>
          <Button size="sm" onClick={onOpenMarket}>
            <Plus size={16} />
            添加应用
          </Button>
        </div>

        <div className="min-h-0 divide-y divide-border border-y border-border">
          {apps.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无已安装应用</div>
          )}
          {apps.map((app) => {
            const builtin = app.ui.mode === 'builtin';
            const appSettings = settings[app.id] ?? defaultSettings;
            const running = states[app.id]?.status === 'running';
            const issue = app.issue ?? states[app.id]?.issue;
            const pending = pendingId === app.id;
            return (
              <div key={app.id} className="flex min-h-20 items-center gap-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
                  <AppIcon app={app} state={states[app.id]} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{app.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {builtin ? '内置应用' : '官方应用'}
                    </span>
                    {issue && <Badge variant="outline">异常</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    v{app.version}
                    {!builtin && ` · ${running ? '运行中' : '已停止'}`}
                    {!appSettings.visible && ' · 已隐藏'}
                  </div>
                  {issue && (
                    <div className="mt-1 text-xs text-muted-foreground">{issue.message}</div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <ActionButton
                    label={`${app.name} 设置`}
                    disabled={pending}
                    onClick={() => void openSettings(app)}
                  >
                    <Settings size={16} />
                  </ActionButton>
                  {!builtin && !running && !issue && (
                    <ActionButton
                      label={actionLabel('start')}
                      disabled={pending}
                      onClick={() => void controlProcess(app, 'start')}
                    >
                      <Play size={16} />
                    </ActionButton>
                  )}
                  {!builtin && running && !issue && (
                    <>
                      <ActionButton
                        label={actionLabel('stop')}
                        disabled={pending}
                        onClick={() => void controlProcess(app, 'stop')}
                      >
                        <Square size={16} />
                      </ActionButton>
                      <ActionButton
                        label={actionLabel('restart')}
                        disabled={pending}
                        onClick={() => void controlProcess(app, 'restart')}
                      >
                        <RotateCcw size={16} />
                      </ActionButton>
                    </>
                  )}
                  {!builtin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => onShowLog(app)}
                    >
                      日志
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">显示</span>
                  <Switch
                    aria-label={`${app.name} 显示`}
                    checked={appSettings.visible}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      void saveSettings(app, { ...appSettings, visible: checked })
                    }
                  />
                  {!builtin && (
                    <ActionButton
                      label={actionLabel('uninstall')}
                      disabled={pending}
                      onClick={() => void uninstall(app)}
                    >
                      <Trash2 size={16} />
                    </ActionButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

function AppSettingsDetail({
  app,
  state,
  appSettings,
  pending,
  onBack,
  onSaveSettings,
  onResetSettings,
}: {
  app: AppManifest;
  state?: AppState;
  appSettings: AppUserSettings;
  pending: boolean;
  onBack: () => void;
  onSaveSettings: (settings: AppUserSettings) => void;
  onResetSettings: () => void;
}) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回应用管理" onClick={onBack}>
            <ArrowLeft size={16} />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{app.name}设置</h2>
            <p className="mt-1 text-xs text-muted-foreground">应用配置详情</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {app.process && (
            <div className="mb-6 flex items-center justify-between border-y border-border py-4">
              <div>
                <div className="text-sm font-medium">随 aIdea 启动</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  启动 aIdea 时自动启动此应用
                </div>
              </div>
              <Switch
                aria-label={`${app.name} 随 aIdea 启动`}
                checked={appSettings.startup_mode === 'with-aidea'}
                disabled={pending}
                onCheckedChange={(checked) =>
                  onSaveSettings({
                    ...appSettings,
                    startup_mode: checked ? 'with-aidea' : 'manual',
                  })
                }
              />
            </div>
          )}

          <div className="min-h-[360px] overflow-hidden border border-border bg-background">
            {app.ui.mode === 'webview' ? (
              <WebviewFrame app={app} state={state} path="/settings" />
            ) : app.id === 'dev-tools' ? (
              <DevToolsSettingsPage embedded onClose={onBack} />
            ) : (
              <div className="flex h-full min-h-[360px] items-center justify-center p-6">
                <p className="text-sm text-muted-foreground">该应用暂无可配置项</p>
              </div>
            )}
          </div>

          {app.settings?.reset_command && (
            <div className="mt-8 border-t border-border pt-6">
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => setConfirmResetOpen(true)}
              >
                重置
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">需要通过 Touch ID 确认</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认重置应用配置</DialogTitle>
            <DialogDescription>
              重置后将清除当前应用的所有用户配置，并恢复默认设置。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmResetOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmResetOpen(false);
                onResetSettings();
              }}
              disabled={pending}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionButton({
  label,
  tooltip,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tooltip?: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
