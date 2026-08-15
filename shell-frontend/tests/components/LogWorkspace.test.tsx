import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogWorkspace } from '../../src/components/LogWorkspace';
import { ipc } from '../../src/lib/ipc';

vi.mock('../../src/lib/ipc', () => ({
  ipc: { readDiagnosticLog: vi.fn().mockResolvedValue('2026-08-16 12:00:00  stderr  boom\n') },
}));

describe('LogWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('官方应用按来源显示日志标签并读取运行日志', async () => {
    render(
      <LogWorkspace
        target={{ scope: 'official', id: 'demo', name: 'Demo', version: '1.0.0' }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('tab', { name: '应用运行' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '安装与更新' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'aIdea 事件' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1);
    expect(ipc.readDiagnosticLog).toHaveBeenCalledWith({
      scope: 'official',
      app_id: 'demo',
      channel: 'runtime',
    });
    fireEvent.click(screen.getByRole('tab', { name: '安装与更新' }));
    expect(await screen.findByText(/stderr\s+boom/)).toBeInTheDocument();
  });
});
