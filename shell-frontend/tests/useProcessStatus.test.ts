import { describe, expect, it } from 'vitest';
import { appStatesEqual } from '../src/hooks/useProcessStatus';
import type { AppState } from '../src/types/manifest';

describe('appStatesEqual', () => {
  it('进程状态未变化时不触发状态更新', () => {
    const current: Record<string, AppState> = {
      mail: { id: 'mail', status: 'running', pid: 100 },
    };
    const next: Record<string, AppState> = {
      mail: { id: 'mail', status: 'running', pid: 100 },
    };

    expect(appStatesEqual(current, next)).toBe(true);
  });

  it('进程状态变化时触发状态更新', () => {
    const current: Record<string, AppState> = {
      mail: { id: 'mail', status: 'running', pid: 100 },
    };
    const next: Record<string, AppState> = {
      mail: { id: 'mail', status: 'stopped', pid: null },
    };

    expect(appStatesEqual(current, next)).toBe(false);
  });
});
