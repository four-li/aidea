// 进程状态 hook：定时轮询所有子应用进程状态
import { useState, useEffect, useCallback } from 'react';
import { ipc } from '../lib/ipc';
import type { AppState } from '../types/manifest';

const POLL_INTERVAL_MS = 2000; // 2 秒轮询一次

export function appStatesEqual(
  current: Record<string, AppState>,
  next: Record<string, AppState>
): boolean {
  const currentIds = Object.keys(current);
  if (currentIds.length !== Object.keys(next).length) return false;
  return currentIds.every((id) => {
    const currentState = current[id];
    const nextState = next[id];
    return (
      nextState !== undefined &&
      currentState.status === nextState.status &&
      currentState.pid === nextState.pid
    );
  });
}

export function useProcessStatus(enabled: boolean) {
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await ipc.getAppStates();
      const map: Record<string, AppState> = {};
      for (const s of result) {
        map[s.id] = s;
      }
      setStates((current) => (appStatesEqual(current, map) ? current : map));
    } catch (e) {
      // 静默失败，轮询不抛错到 UI
      console.error('轮询进程状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { states, loading, refresh };
}
