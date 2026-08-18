import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuiltinHubPage } from '../../src/components/BuiltinHubPage';

vi.mock('../../src/components/BuiltinPage', () => ({
  BuiltinPage: ({ app }: { app: { name: string } }) => <div>当前应用：{app.name}</div>,
}));

describe('BuiltinHubPage', () => {
  it('只显示普通内置应用，并通过窄图标栏切换', () => {
    const onSelectApp = vi.fn();
    const { container } = render(
      <BuiltinHubPage
        apps={[
          {
            id: 'ai-service',
            name: 'AI Service',
            version: '0.1.0',
            category: '开发',
            status: 'active',
            ui: { mode: 'builtin', icon: 'Sparkles' },
          },
          {
            id: 'dev-tools',
            name: 'DevTools',
            version: '0.1.0',
            category: '开发',
            status: 'active',
            ui: { mode: 'builtin', icon: 'Wrench' },
          },
          {
            id: 'developer-guide',
            name: '开发手册',
            version: '0.1.0',
            category: '开发',
            status: 'active',
            ui: { mode: 'builtin', icon: 'BookOpen', entry: 'account-menu' },
          },
        ]}
        activeAppId="ai-service"
        onSelectApp={onSelectApp}
      />,
    );

    expect(screen.getByRole('button', { name: 'AI Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DevTools' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开发手册' })).not.toBeInTheDocument();
    expect(screen.getByText('当前应用：AI Service')).toBeInTheDocument();
    expect(container.querySelector('.w-14')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'DevTools' }));
    expect(onSelectApp).toHaveBeenCalledWith('dev-tools');
  });
});
