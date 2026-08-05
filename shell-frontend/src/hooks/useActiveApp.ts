// 当前激活应用 hook：管理选中哪个子应用
import { useState, useCallback } from 'react';

export function useActiveApp(defaultId?: string) {
  const [activeAppId, setActiveAppId] = useState<string | null>(defaultId ?? null);

  const selectApp = useCallback((id: string | null) => {
    setActiveAppId(id);
  }, []);

  return { activeAppId, selectApp };
}
