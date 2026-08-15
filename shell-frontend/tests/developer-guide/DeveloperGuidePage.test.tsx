import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeveloperGuidePage } from '../../src/builtin-apps/developer-guide';

describe('开发手册', () => {
  it('可返回主页面', () => {
    const onBack = vi.fn();
    render(<DeveloperGuidePage onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: '返回主页面' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('渲染 Guide 源文档并可在页面内切换专题', () => {
    render(<DeveloperGuidePage />);

    expect(screen.getByRole('heading', { name: 'aIdea 开发手册' })).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole('navigation', { name: '开发手册目录' })).getByRole('button', {
        name: 'AI 网关契约',
      }),
    );

    expect(screen.getByRole('heading', { name: 'aIdea AI 网关契约' })).toBeInTheDocument();
  });
});
