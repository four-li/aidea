import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContentArea } from '../../src/components/ContentArea';
import type { AppManifest } from '../../src/types/manifest';

const app: AppManifest = {
  id: 'official-mail',
  name: '邮件管理',
  version: '1.0.0',
  category: '效率',
  path: '',
  status: 'active',
  ui: { mode: 'webview', url: 'http://127.0.0.1:43120' },
  settings: { enabled: true },
};

describe('应用设置导航', () => {
  it('主内容区始终加载官方应用主页，不承载应用设置', () => {
    render(
      <ContentArea
        apps={[app]}
        activeApp={app}
        states={{}}
      />,
    );

    expect(screen.getByTitle('邮件管理')).toHaveAttribute('src', 'http://127.0.0.1:43120');
    expect(screen.queryByRole('button', { name: '返回应用' })).not.toBeInTheDocument();
  });
});
