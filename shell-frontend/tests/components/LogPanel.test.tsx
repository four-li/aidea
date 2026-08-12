import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LogPanel } from '../../src/components/LogPanel';
import { ipc } from '../../src/lib/ipc';
import type { AppManifest } from '../../src/types/manifest';

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    readAppLog: vi.fn().mockResolvedValue('line-1\nline-2\n'),
  },
}));

const app: AppManifest = {
  id: 'demo',
  name: 'Demo',
  version: '0.1.0',
  category: 'test',
  status: 'active',
  ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
};

describe('LogPanel', () => {
  it('通过统一 ipc 封装读取应用日志', async () => {
    render(<LogPanel app={app} onClose={() => undefined} />);

    expect(await screen.findByText(/line-1/)).toBeInTheDocument();
    expect(ipc.readAppLog).toHaveBeenCalledWith('demo');
  });
});
