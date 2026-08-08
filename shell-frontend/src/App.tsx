import { useState, useMemo, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { ContentArea } from './components/ContentArea';
import { LogPanel } from './components/LogPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Toaster } from './components/ui/sonner';
import { useApps } from './hooks/useApps';
import { useActiveApp } from './hooks/useActiveApp';
import { useProcessStatus } from './hooks/useProcessStatus';
import { useTheme } from './hooks/useTheme';
import type { AppManifest } from './types/manifest';

const APP_ORDER_STORAGE_KEY = 'aidea-app-order';

function App() {
  const { apps, loading, error, refresh: refreshApps } = useApps();
  const { activeAppId, selectApp } = useActiveApp();
  const { states, refresh } = useProcessStatus(apps.length > 0);
  const { mode: themeMode, setTheme } = useTheme();

  // apps 加载完成后，自动选中第一个（仅当还没选中时）
  useEffect(() => {
    if (!loading && apps.length > 0 && activeAppId === null) {
      selectApp(apps[0].id);
    }
  }, [loading, apps, activeAppId, selectApp]);

  const [logApp, setLogApp] = useState<AppManifest | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // 子应用排序：apps 加载完后同步一次，之后只响应拖拽
  const [appOrder, setAppOrder] = useState<string[]>([]);

  useEffect(() => {
    if (apps.length === 0) return;
    // 尝试从 localStorage 恢复顺序
    try {
      const saved = localStorage.getItem(APP_ORDER_STORAGE_KEY);
      if (saved) {
        const savedOrder = JSON.parse(saved) as string[];
        // 用保存的顺序，过滤掉已不存在的 app，补上新 app
        const existing = savedOrder.filter((id) => apps.some((a) => a.id === id));
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
    [apps, activeAppId]
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
        onReorder={setAppOrder}
        activeAppId={activeAppId}
        states={states}
        onSelectApp={selectApp}
        onRefreshStates={refresh}
        onShowLog={setLogApp}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 overflow-hidden">
        <ContentArea apps={apps} activeApp={activeApp} states={states} />
      </div>
      <LogPanel app={logApp} onClose={() => setLogApp(null)} />
      <SettingsPanel
        apps={apps}
        themeMode={themeMode}
        onThemeChange={setTheme}
        open={showSettings}
        onOpenChange={setShowSettings}
        onAppsChanged={refreshApps}
      />
      <Toaster />
    </div>
  );
}

export default App;
