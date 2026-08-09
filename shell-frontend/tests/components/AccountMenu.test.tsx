import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve('fourli')) }));

import { AccountMenu } from '../../src/components/AccountMenu';

describe('账户菜单', () => {
  it('显示短用户名和账户菜单触发器', async () => {
    render(<AccountMenu onOpenSettings={vi.fn()} />);

    expect(await screen.findByText('fourli')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fourli账户菜单' })).toBeInTheDocument();
  });
});
