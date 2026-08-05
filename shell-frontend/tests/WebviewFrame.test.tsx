import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebviewFrame } from '../src/components/WebviewFrame';

describe('WebviewFrame', () => {
  it('服务未运行时不加载 iframe', () => {
    render(
      <WebviewFrame
        app={{
          id: 'atlas',
          name: 'Atlas',
          version: '0.1.0',
          category: 'dev-workflow',
          path: '/Users/me/atlas',
          status: 'active',
          ui: { mode: 'webview', url: 'http://127.0.0.1:51130' },
          process: { start: 'atlas web', stop: 'SIGTERM', autostart: false },
        }}
        state={{ id: 'atlas', status: 'stopped', pid: null }}
      />
    );

    expect(screen.queryByTitle('Atlas')).not.toBeInTheDocument();
    expect(screen.getByText('Atlas 服务未启动')).toBeInTheDocument();
  });
});
