import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebviewFrame } from '../src/components/WebviewFrame';

describe('WebviewFrame', () => {
  it('服务未运行时不加载 iframe', () => {
    render(
      <WebviewFrame
        app={{
          id: 'sample-app',
          name: '示例应用',
          version: '0.1.0',
          category: 'dev-workflow',
          status: 'active',
          ui: { mode: 'webview', url: 'http://127.0.0.1:51130' },
          process: {},
        }}
        state={{ id: 'sample-app', status: 'stopped', pid: null }}
      />,
    );

    expect(screen.queryByTitle('示例应用')).not.toBeInTheDocument();
    expect(screen.getByText('示例应用 服务未启动')).toBeInTheDocument();
  });

  it('把 aIdea 主题传给官方应用，并使用主题背景', () => {
    render(
      <WebviewFrame
        app={{
          id: 'sample-app',
          name: '示例应用',
          version: '0.1.0',
          category: 'dev-workflow',
          status: 'active',
          ui: { mode: 'webview', url: 'http://127.0.0.1:51130/app?mode=full' },
        }}
        theme="dark"
      />,
    );

    expect(screen.getByTitle('示例应用')).toHaveAttribute(
      'src',
      'http://127.0.0.1:51130/app?mode=full&aidea_theme=dark',
    );
    expect(screen.getByTitle('示例应用')).toHaveClass('bg-background');
  });

  it('把已挂载的 iframe 注册给 App Bridge', () => {
    const onFrameRef = vi.fn();
    const app = {
      id: 'sample-app',
      name: '示例应用',
      version: '0.1.0',
      category: 'dev-workflow',
      status: 'active' as const,
      ui: { mode: 'webview' as const, url: 'http://127.0.0.1:51130' },
    };

    render(<WebviewFrame app={app} onFrameRef={onFrameRef} />);

    expect(onFrameRef).toHaveBeenCalledWith(app, screen.getByTitle('示例应用'));
  });

  it('应用版本变化时重新加载 iframe', () => {
    const app = {
      id: 'sample-app',
      name: '示例应用',
      version: '0.1.0',
      category: 'dev-workflow',
      status: 'active' as const,
      ui: { mode: 'webview' as const, url: 'http://127.0.0.1:51130' },
    };
    const { rerender } = render(<WebviewFrame app={app} />);
    const previousFrame = screen.getByTitle('示例应用');

    rerender(<WebviewFrame app={{ ...app, version: '0.1.1' }} />);

    expect(screen.getByTitle('示例应用')).not.toBe(previousFrame);
  });

  it('iframe 重建时用最新应用信息注册 App Bridge', () => {
    const onFrameRef = vi.fn();
    const app = {
      id: 'sample-app',
      name: '示例应用',
      version: '0.1.0',
      category: 'dev-workflow',
      status: 'active' as const,
      ui: { mode: 'webview' as const, url: 'http://127.0.0.1:51130' },
    };

    const { rerender } = render(<WebviewFrame app={app} onFrameRef={onFrameRef} />);
    const updatedApp = {
      ...app,
      version: '0.1.1',
      ui: { mode: 'webview' as const, url: 'http://127.0.0.1:51131' },
    };

    rerender(<WebviewFrame app={updatedApp} onFrameRef={onFrameRef} />);

    const mountedCalls = onFrameRef.mock.calls.filter(([, iframe]) => iframe);
    expect(mountedCalls.at(-1)?.[0]).toMatchObject({
      version: '0.1.1',
      ui: { url: 'http://127.0.0.1:51131' },
    });
  });
});
