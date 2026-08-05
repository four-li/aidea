// 子应用列表 hook：加载所有可见子应用
import { useState, useEffect, useCallback } from 'react';
import { loadVisibleApps } from '../lib/manifest-loader';
import type { AppManifest } from '../types/manifest';

export function useApps() {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadVisibleApps();
      setApps(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { apps, loading, error, refresh };
}
