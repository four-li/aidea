import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimestampConverter } from '../../../../src/builtin-apps/dev-tools/tabs/timestamp-converter/TimestampConverter';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// mock lib/clipboard.ts（走 Tauri plugin，jsdom 环境没有）
vi.mock('../../../../src/lib/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import { copyToClipboard } from '../../../../src/lib/clipboard';

// jsdom polyfill：Radix Select 依赖 Pointer Capture API，jsdom 缺失
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

describe('TimestampConverter', () => {
  const props = {
    tsInput: '',
    dateInput: '',
    onTsChange: vi.fn(),
    onDateChange: vi.fn(),
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('显示紧凑当前时间信息及系统时区选择', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-10-31T00:37:12.345Z'));
    render(<TimestampConverter {...props} />);

    expect(
      screen.getByText(/当前 2023-10-31 08:37:12 · 1698712632 · 1698712632345/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择时区' })).toHaveTextContent(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });

  it('搜索并选择时区后，时间戳转换结果随之更新', () => {
    render(<TimestampConverter {...props} tsInput="1698712632000" />);

    fireEvent.click(screen.getByRole('button', { name: /选择时区/ }));
    fireEvent.change(screen.getByPlaceholderText('搜索时区'), {
      target: { value: 'new_york' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'America/New_York' }));

    expect(screen.getByText('2023-10-30 20:37:12')).toBeInTheDocument();
  });

  it('渲染左栏时间戳输入和右栏日期输入', () => {
    render(<TimestampConverter {...props} />);
    expect(screen.getByPlaceholderText(/输入时间戳/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/YYYY-MM-DD/)).toBeInTheDocument();
  });

  it('输入合法时间戳 → 左栏下方派生显示本地/UTC 日期', () => {
    render(<TimestampConverter {...props} tsInput="1698712632000" />);
    // 派生结果区域应出现 2023 字样（本地与 UTC 各一处，共两处）
    expect(screen.getAllByText(/2023/).length).toBeGreaterThanOrEqual(1);
  });

  it('输入非法时间戳（含字母）→ 左栏下方显示错误', () => {
    render(<TimestampConverter {...props} tsInput="1698abc" />);
    expect(screen.getByText(/时间戳应为纯数字/)).toBeInTheDocument();
  });

  it('输入合法日期 → 右栏下方派生显示秒/毫秒时间戳', () => {
    render(<TimestampConverter {...props} dateInput="2023-10-31 08:37:12" />);
    // 秒字段精确显示 1698712632（毫秒字段是 1698712632000，不重叠）
    expect(screen.getByText('1698712632')).toBeInTheDocument();
    expect(screen.getByText('1698712632000')).toBeInTheDocument();
  });

  it('输入非法日期 → 右栏下方显示错误', () => {
    render(<TimestampConverter {...props} dateInput="not-a-date" />);
    expect(screen.getByText(/日期格式无效/)).toBeInTheDocument();
  });

  it('点击复制本地按钮 → 调用 copyToClipboard 并 toast.success', async () => {
    vi.mocked(copyToClipboard).mockClear();
    const { toast } = await import('sonner');
    render(<TimestampConverter {...props} tsInput="1698712632000" />);
    fireEvent.click(screen.getByRole('button', { name: /复制本地/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(copyToClipboard).toHaveBeenCalledWith('2023-10-31 08:37:12');
    expect(toast.success).toHaveBeenCalledWith('已复制');
  });

  it('时间戳单位提示随输入变化', () => {
    const { rerender } = render(
      <TimestampConverter {...props} tsInput="1698712632" />
    );
    expect(screen.getByText(/按秒解析/)).toBeInTheDocument();

    rerender(
      <TimestampConverter {...props} tsInput="1698712632000" />
    );
    expect(screen.getByText(/按毫秒解析/)).toBeInTheDocument();
  });
});
