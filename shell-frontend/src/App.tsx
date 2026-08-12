import { useState, useMemo, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { TopBar } from './components/TopBar';
import { ContentArea } from './components/ContentArea';
import { LogPanel } from './components/LogPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Toaster } from './components/ui/sonner';
import { useApps } from './hooks/useApps';
import { useActiveApp } from './hooks/useActiveApp';
import { useProcessStatus } from './hooks/useProcessStatus';
import { useAppBridge } from './hooks/useAppBridge';
import { useTheme } from './hooks/useTheme';
import { ipc } from './lib/ipc';
import type { AppManifest } from './types/manifest';

const APP_ORDER_STORAGE_KEY = 'aidea-app-order';

function App() {
  const { apps, loading, error, refresh: refreshApps } = useApps();
  const { activeAppId, selectApp } = useActiveApp();
  const { states, refresh } = useProcessStatus(apps.length > 0);
  const { mode: themeMode, resolvedTheme, setTheme } = useTheme();

  const handleNavigateRequest = useCallback(
    async ({ appId }: { appId: string; path?: string }) => {
      const app = apps.find((item) => item.id === appId);
      if (!app) return;
      selectApp(appId);
      if (app.process && states[appId]?.status !== 'running') {
        try {
          const request = ipc.startApp(appId);
          void refresh();
          await request;
          void refresh();
        } catch (error) {
          toast.error('启动应用失败', { description: String(error) });
        }
      }
    },
    [apps, states, selectApp, refresh],
  );
  const { registerFrame } = useAppBridge(resolvedTheme, handleNavigateRequest);

  // apps 加载完成后，自动选中第一个（仅当还没选中时）
  useEffect(() => {
    if (!loading && apps.length > 0 && activeAppId === null) {
      selectApp(apps[0].id);
    }
  }, [loading, apps, activeAppId, selectApp]);

  const [logApp, setLogApp] = useState<AppManifest | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<'about' | undefined>();
  const [checkUpdate, setCheckUpdate] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen('aidea:check-update', () => {
      setSettingsCategory('about');
      setShowSettings(true);
      setCheckUpdate((value) => value + 1);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen('aidea:open-settings', () => setShowSettings(true)).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  // 子应用排序：apps 加载完后同步一次，之后只响应拖拽
  const [appOrder, setAppOrder] = useState<string[]>([]);

  useEffect(() => {
    if (apps.length === 0) return;
    // 尝试从 localStorage 恢复顺序
    try {
      const saved = localStorage.getItem(APP_ORDER_STORAGE_KEY);
      if (saved) {
        const savedOrder = JSON.parse(saved) as string[];
        // 保留隐藏应用的顺序，顶部渲染时只会显示当前可见应用
        const existing = savedOrder;
        const missing = apps.filter((a) => !existing.includes(a.id)).map((a) => a.id);
        setAppOrder([...existing, ...missing]);
        return;
      }
    } catch {
      // localStorage 可能损坏或旧格式，忽略错误用默认顺序
    }
    setAppOrder(apps.map((a) => a.id));
  }, [apps]);

  useEffect(() => {
    if (appOrder.length === 0) return;
    try {
      localStorage.setItem(APP_ORDER_STORAGE_KEY, JSON.stringify(appOrder));
    } catch {
      // 隐私模式或空间不足时写入失败，忽略
    }
  }, [appOrder]);

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeAppId) || null,
    [apps, activeAppId],
  );

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-destructive">
        加载失败: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
      <TopBar
        apps={apps}
        appOrder={appOrder}
        activeAppId={activeAppId}
        states={states}
        onSelectApp={selectApp}
        onRefreshStates={refresh}
        onShowLog={setLogApp}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 overflow-hidden">
        <ContentArea
          apps={apps}
          activeApp={activeApp}
          states={states}
          theme={resolvedTheme}
          onFrameRef={registerFrame}
        />
      </div>
      <LogPanel app={logApp} onClose={() => setLogApp(null)} />
      <SettingsPanel
        themeMode={themeMode}
        onThemeChange={setTheme}
        open={showSettings}
        onOpenChange={setShowSettings}
        onAppsChanged={refreshApps}
        states={states}
        onRefreshStates={refresh}
        appOrder={appOrder}
        onReorder={setAppOrder}
        onShowLog={setLogApp}
        category={settingsCategory}
        checkUpdate={checkUpdate}
      />
      <Toaster />
    </div>
  );
}

export default App;
