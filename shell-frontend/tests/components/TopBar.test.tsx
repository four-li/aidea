import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../src/components/TopBar';

describe('TopBar', () => {
  it('只把左侧空白区作为窗口拖拽区', () => {
    const { container } = render(
      <TopBar
        apps={[]}
        appOrder={[]}
        activeAppId={null}
        states={{}}
        onSelectApp={vi.fn()}
        onRefreshStates={vi.fn()}
        onShowLog={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('[data-tauri-drag-region]')).toHaveLength(1);
    expect(container.firstElementChild).not.toHaveAttribute('data-tauri-drag-region');
  });
});
