import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowLeft,
  Ellipsis,
  FileText,
  GripVertical,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Square,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { ipc } from '../lib/ipc';
import type { AppManifest, AppState, AppUserSettings } from '../types/manifest';
import type { InstalledApp, OfficialApp } from '../types/official-app';
import { BUILTIN_SETTINGS_PAGES } from '../builtin-apps/settings';
import { AppIcon } from './AppIcon';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
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
  onShowLog: (app: AppManifest) => void;
  appOrder?: string[];
  onReorder?: (newOrder: string[]) => void;
}

const defaultSettings: AppUserSettings = { visible: true, startup_mode: 'manual' };

interface InstallProgress {
  id: string;
  message: string;
}

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

export function AppManagementPage({ onAppsChanged, onShowLog, appOrder, onReorder }: Props) {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [settings, setSettings] = useState<Record<string, AppUserSettings>>({});
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [officialApps, setOfficialApps] = useState<OfficialApp[]>([]);
  const [installedOfficialApps, setInstalledOfficialApps] = useState<InstalledApp[]>([]);
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installStage, setInstallStage] = useState<string | null>(null);
  const [failedAppId, setFailedAppId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [installLogOpen, setInstallLogOpen] = useState(false);
  const [uninstallApp, setUninstallApp] = useState<AppManifest | null>(null);

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

  const loadMarket = useCallback(async () => {
    try {
      const [market, records] = await Promise.all([
        ipc.listOfficialApps(),
        ipc.listInstalledOfficialApps(),
      ]);
      setOfficialApps(market);
      setInstalledOfficialApps(records);
      setMarketError(null);
    } catch (error) {
      setMarketError(String(error));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMarket();
  }, [load, loadMarket]);

  useEffect(() => {
    const pending = listen<InstallProgress>('official-app-install-progress', (event) => {
      if (event.payload.id === pendingId) setInstallStage(event.payload.message);
    });
    return () => {
      void pending.then((dispose) => dispose());
    };
  }, [pendingId]);

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
      await ipc.uninstallOfficialApp(app.id);
      await Promise.all([load(), loadMarket()]);
      onAppsChanged();
    } catch (error) {
      toast.error('卸载失败', { description: String(error) });
    } finally {
      setPendingId(null);
    }
  };

  const refreshMarket = async () => {
    setMarketRefreshing(true);
    try {
      const [market, records] = await Promise.all([
        ipc.refreshOfficialApps(),
        ipc.listInstalledOfficialApps(),
      ]);
      setOfficialApps(market);
      setInstalledOfficialApps(records);
      setMarketError(null);
      await load();
    } catch (error) {
      setMarketError(String(error));
    } finally {
      setMarketRefreshing(false);
    }
  };

  const installOfficialApp = async (app: OfficialApp, update = false) => {
    setPendingId(app.id);
    setMarketError(null);
    setFailedAppId(null);
    setInstallStage(update ? '准备更新...' : '准备安装...');
    try {
      if (update) await ipc.updateOfficialApp(app.id);
      else await ipc.installOfficialApp(app.id);
      await Promise.all([load(), loadMarket()]);
      onAppsChanged();
    } catch (error) {
      setMarketError(String(error));
      setFailedAppId(app.id);
    } finally {
      setPendingId(null);
      setInstallStage(null);
    }
  };

  const openInstallLog = async () => {
    if (!failedAppId) return;
    try {
      setInstallLog(await ipc.readOfficialAppInstallLog(failedAppId));
      setInstallLogOpen(true);
    } catch (error) {
      setMarketError(`读取安装日志失败：${String(error)}`);
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

  const detailApp = apps.find((app) => app.id === detailId && app.ui.mode === 'builtin') ?? null;
  const orderedIds = [
    ...(appOrder?.length ? appOrder : []),
    ...apps.map((app) => app.id).filter((id) => !appOrder?.includes(id)),
  ];
  const orderedApps = orderedIds
    .map((id) => apps.find((app) => app.id === id))
    .filter((app): app is AppManifest => app !== undefined);
  const availableOfficialApps = officialApps.filter(
    (app) => !installedOfficialApps.some((record) => record.id === app.id),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !onReorder) return;
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(orderedIds, oldIndex, newIndex));
  };

  if (detailApp) {
    return (
      <AppSettingsDetail
        app={detailApp}
        pending={pendingId === detailApp.id}
        onBack={() => setDetailId(null)}
        onResetSettings={() => void resetSettings(detailApp)}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">已安装应用</p>
          <ActionButton
            label="刷新官方应用"
            disabled={marketRefreshing}
            onClick={() => void refreshMarket()}
          >
            <RefreshCw className={marketRefreshing ? 'animate-spin' : undefined} size={16} />
          </ActionButton>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {apps.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无已安装应用</div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {orderedApps.map((app) => {
                  const builtin = app.ui.mode === 'builtin';
                  const officialApp = officialApps.find((item) => item.id === app.id);
                  const appSettings = settings[app.id] ?? defaultSettings;
                  const running = states[app.id]?.status === 'running';
                  const issue = app.issue ?? states[app.id]?.issue;
                  const pending = pendingId === app.id;
                  return (
                    <SortableAppCard key={app.id} appId={app.id}>
                      <div className="flex min-h-36 flex-col gap-4 rounded-lg border border-border bg-card p-4 pl-10">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                            <AppIcon app={app} state={states[app.id]} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{app.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {builtin ? '内置应用' : '官方应用'}
                              </span>
                              {issue && <Badge variant="outline">异常</Badge>}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              v{app.version}
                              {!builtin && ` · ${running ? '运行中' : '已停止'}`}
                              {!appSettings.visible && ' · 已隐藏'}
                            </div>
                            {app.description && (
                              <div className="mt-2 truncate text-xs text-muted-foreground">
                                {app.description}
                              </div>
                            )}
                            {issue && (
                              <div className="mt-1 truncate text-xs text-muted-foreground">
                                {issue.message}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {builtin && (
                              <ActionButton
                                label={`${app.name} 设置`}
                                disabled={pending}
                                onClick={() => setDetailId(app.id)}
                              >
                                <Settings size={16} />
                              </ActionButton>
                            )}
                            <Switch
                              aria-label={`${app.name} 显示在主页`}
                              checked={appSettings.visible}
                              disabled={pending}
                              onCheckedChange={(checked) =>
                                void saveSettings(app, { ...appSettings, visible: checked })
                              }
                            />
                            {!builtin && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`${app.name} 更多操作`}
                                    disabled={pending}
                                  >
                                    <Ellipsis size={16} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {!running && !issue && (
                                    <DropdownMenuItem
                                      onSelect={() => void controlProcess(app, 'start')}
                                    >
                                      <Play size={16} />
                                      启动
                                    </DropdownMenuItem>
                                  )}
                                  {running && !issue && (
                                    <>
                                      <DropdownMenuItem
                                        onSelect={() => void controlProcess(app, 'stop')}
                                      >
                                        <Square size={16} />
                                        停止
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={() => void controlProcess(app, 'restart')}
                                      >
                                        <RotateCcw size={16} />
                                        重启
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  {app.process && (
                                    <DropdownMenuCheckboxItem
                                      checked={appSettings.startup_mode === 'with-aidea'}
                                      disabled={pending}
                                      onCheckedChange={(checked) =>
                                        void saveSettings(app, {
                                          ...appSettings,
                                          startup_mode: checked ? 'with-aidea' : 'manual',
                                        })
                                      }
                                    >
                                      随开搞启动
                                    </DropdownMenuCheckboxItem>
                                  )}
                                  {officialApp?.update_available && (
                                    <DropdownMenuItem
                                      onSelect={() => void installOfficialApp(officialApp, true)}
                                    >
                                      <RefreshCw size={16} />
                                      更新
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onSelect={() => onShowLog(app)}>
                                    日志
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setUninstallApp(app)}
                                  >
                                    <Trash2 size={16} />
                                    卸载
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </div>
                      </div>
                    </SortableAppCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          {marketError && (
            <div className="mt-6 flex items-center justify-between gap-3 border-y border-destructive/30 py-3 text-sm text-destructive">
              <p className="min-w-0 break-words">{marketError}</p>
              {failedAppId && (
                <Button variant="outline" size="sm" onClick={() => void openInstallLog()}>
                  <FileText size={14} />
                  查看安装日志
                </Button>
              )}
            </div>
          )}

          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm text-muted-foreground">可安装应用</h2>
            {availableOfficialApps.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无可安装的官方应用</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                {availableOfficialApps.map((app) => {
                  const pending = pendingId === app.id;
                  return (
                    <div
                      key={app.id}
                      className="flex gap-3 rounded-lg border border-border bg-card p-4"
                    >
                      <Package className="mt-0.5 shrink-0 text-primary" size={20} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate text-sm font-medium text-foreground">
                            {app.name}
                          </h3>
                          <Button
                            size="sm"
                            disabled={pending}
                            aria-label={`安装 ${app.name}`}
                            onClick={() => void installOfficialApp(app)}
                          >
                            {pending ? '处理中' : '安装'}
                          </Button>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {app.description}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          v{app.version} · {app.category}
                        </p>
                        {pending && installStage && (
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
          </section>
        </div>

        <Dialog
          open={uninstallApp !== null}
          onOpenChange={(open) => !open && setUninstallApp(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>确认卸载应用</DialogTitle>
              <DialogDescription>
                {`将移除“${uninstallApp?.name}”的安装文件。应用数据和日志会保留，重新安装后仍可使用已有数据。`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setUninstallApp(null)}
                disabled={pendingId !== null}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={pendingId !== null}
                onClick={() => {
                  if (!uninstallApp) return;
                  const app = uninstallApp;
                  setUninstallApp(null);
                  void uninstall(app);
                }}
              >
                确认卸载
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={installLogOpen} onOpenChange={setInstallLogOpen}>
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
    </TooltipProvider>
  );
}

function AppSettingsDetail({
  app,
  pending,
  onBack,
  onResetSettings,
}: {
  app: AppManifest;
  pending: boolean;
  onBack: () => void;
  onResetSettings: () => void;
}) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const BuiltinSettingsPage = BUILTIN_SETTINGS_PAGES[app.id];

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
          <div className="min-h-[360px] overflow-hidden border border-border bg-background">
            {BuiltinSettingsPage ? (
              <BuiltinSettingsPage embedded onClose={onBack} />
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
              <p className="mt-2 text-xs text-muted-foreground">只重置应用配置，不删除业务数据</p>
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

function SortableAppCard({ appId, children }: { appId: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: appId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="relative"
      {...attributes}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="absolute left-2 top-4 z-10 flex h-8 w-8 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="拖动调整应用顺序"
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      {children}
    </div>
  );
}
