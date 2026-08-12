import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockLoadVisibleApps = vi.fn();

vi.mock('../src/lib/manifest-loader', () => ({
  loadVisibleApps: (...args: unknown[]) => mockLoadVisibleApps(...args),
}));

import { useApps } from '../src/hooks/useApps';

describe('useApps', () => {
  it('首次加载完成后刷新应用列表不再进入加载态', async () => {
    mockLoadVisibleApps.mockResolvedValueOnce([]);
    let resolveRefresh: ((apps: []) => void) | undefined;
    mockLoadVisibleApps.mockImplementationOnce(
      () => new Promise<[]>(resolve => {
        resolveRefresh = resolve;
      }),
    );

    const { result } = renderHook(() => useApps());

    await waitFor(() => expect(result.current.loading).toBe(false));

    let refresh!: Promise<void>;
    await act(async () => {
      refresh = result.current.refresh();
    });

    expect(result.current.loading).toBe(false);
    await act(async () => resolveRefresh?.([]));
    await refresh;
  });
});
