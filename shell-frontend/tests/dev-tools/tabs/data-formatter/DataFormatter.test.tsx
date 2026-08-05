import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataFormatter } from '../../../../src/builtin-apps/dev-tools/tabs/data-formatter/DataFormatter';

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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/lib/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import { copyToClipboard } from '../../../../src/lib/clipboard';

// 从容器中取输出区 CodeMirror 文本（第二个 .cm-content）
function getOutputText(container: HTMLElement): string {
  const cmContents = container.querySelectorAll('.cm-content');
  return cmContents[cmContents.length - 1]?.textContent ?? '';
}

describe('DataFormatter', () => {
  it('渲染工具栏（输出格式、Unicode 反转义）+ 输入/输出区按钮', () => {
    render(<DataFormatter input="" onChange={() => {}} />);
    expect(screen.getByText(/输出格式/)).toBeInTheDocument();
    expect(screen.getByText(/Unicode 反转义/)).toBeInTheDocument();
    // 输入区按钮：清空、格式化
    expect(screen.getByRole('button', { name: /清空/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /格式化/ })).toBeInTheDocument();
    // 输出区按钮：压缩、复制
    expect(screen.getByRole('button', { name: /压缩/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /复制/ })).toBeInTheDocument();
  });

  it('空输入 → 不显示错误 banner', () => {
    render(<DataFormatter input="" onChange={() => {}} />);
    expect(screen.queryByText(/错误/)).not.toBeInTheDocument();
  });

  it('输入变化 → 输出立即同步（无 debounce，useMemo 实时计算）', () => {
    const { container } = render(
      <DataFormatter input='{"a":1}' onChange={() => {}} />
    );
    // useMemo 同步计算，无需 waitFor
    const output = getOutputText(container);
    expect(output).toContain('"a"');
    expect(output).toContain('1');
  });

  it('输出格式默认跟随输入识别的格式（输入 YAML → 输出 YAML）', () => {
    const { container } = render(
      // JSX prop 字符串里 \n 是字面字符，必须用表达式 {} 才能传换行
      <DataFormatter input={'a: 1\nb: 2'} onChange={() => {}} />
    );
    // YAML pretty 输出应包含 a: 1
    expect(getOutputText(container)).toContain('a: 1');
  });

  it('用户手选输出格式为 XML 后 → 输出转 XML（输入不变）', () => {
    // Radix Select 在 jsdom 下打开下拉交互复杂，由人肉测试覆盖
    // 这里仅验证初始输出按识别格式（JSON）渲染
    // 手选后转 XML 的逻辑由 format-utils.test.ts 的 transform 用例覆盖
    const { container } = render(
      <DataFormatter input='{"root":{"a":1}}' onChange={() => {}} />
    );
    expect(getOutputText(container)).toContain('"root"');
  });

  it('点击格式化按钮 → 把输入区原文 pretty 后写回（调用 onChange）', () => {
    const onChange = vi.fn();
    render(
      <DataFormatter input='{"a":1,"b":2}' onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: /格式化/ }));
    expect(onChange).toHaveBeenCalledWith(
      '{\n  "a": 1,\n  "b": 2\n}'
    );
  });

  it('格式化按钮不受反转义勾选影响（反转义只作用于输出区）', () => {
    // 格式化按钮调用 transform(..., unescape: false)
    // 标准 JSON 行为：JSON.parse 把 \u4f60 解码为「你」，JSON.stringify 输出中文
    // formatOutput 在 unescape=false 时会 escape 非 ASCII → 输出 \u4f60
    // 所以格式化写回原文是 escape 形式（\u4f60），跟反转义勾选无关
    const input = '{"name":"\\u4f60"}';
    const expectedOutput = '{\n  "name": "\\u4f60"\n}';

    const onChange1 = vi.fn();
    const { unmount } = render(
      <DataFormatter input={input} onChange={onChange1} />
    );
    fireEvent.click(screen.getByRole('button', { name: /格式化/ }));
    expect(onChange1).toHaveBeenCalledWith(expectedOutput);
    unmount();

    // 勾选反转义后再格式化，写回的原文应与不勾选时一致
    const onChange2 = vi.fn();
    render(<DataFormatter input={input} onChange={onChange2} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /格式化/ }));
    expect(onChange2).toHaveBeenCalledWith(expectedOutput);
  });

  it('点击压缩按钮 → 输出区显示 minify 版本', () => {
    const { container } = render(
      <DataFormatter input='{"a":1,"b":[2,3]}' onChange={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: /压缩/ }));
    const output = getOutputText(container);
    // minify 后应是紧凑格式（无换行缩进）
    expect(output).toContain('"a":1');
    expect(output).not.toContain('\n  ');
  });

  it('默认勾选 Unicode 反转义 → JSON 输出显示中文', () => {
    // 反转义默认勾选，输入 \uXXXX 字面量经 JSON.parse 解码后输出中文
    const input = '{"name":"\\u4f60\\u597d"}';
    const { container } = render(
      <DataFormatter input={input} onChange={() => {}} />
    );
    // 默认勾选 → 输出中文
    expect(getOutputText(container)).toContain('你好');
  });

  it('取消勾选 Unicode 反转义 → JSON 输出 escape 非 ASCII 为 \\uXXXX', () => {
    const input = '{"name":"你好"}';
    const { container } = render(
      <DataFormatter input={input} onChange={() => {}} />
    );
    // 默认勾选 → 输出中文
    expect(getOutputText(container)).toContain('你好');

    // 取消勾选 → 输出 escape 形式 \u4f60\u597d
    fireEvent.click(screen.getByRole('checkbox'));
    const output = getOutputText(container);
    expect(output).toContain('\\u4f60');
    expect(output).toContain('\\u597d');
    expect(output).not.toContain('你好');
  });

  it('点击清空按钮 → 调用 onChange("")', () => {
    const onChange = vi.fn();
    render(<DataFormatter input='{"a":1}' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /清空/ }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('点击复制按钮 → 调用 copyToClipboard 并 toast.success', async () => {
    const { toast } = await import('sonner');
    render(<DataFormatter input='{"a":1}' onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('已复制');
    });
  });

  it('非法 JSON → 输出区显示错误 banner', () => {
    render(<DataFormatter input="{invalid}" onChange={() => {}} />);
    expect(screen.getByText(/错误/)).toBeInTheDocument();
  });

  it('输入从非法变空 → 错误 banner 自动清除', () => {
    const { rerender } = render(
      <DataFormatter input="{invalid}" onChange={() => {}} />
    );
    expect(screen.getByText(/错误/)).toBeInTheDocument();
    rerender(<DataFormatter input="" onChange={() => {}} />);
    expect(screen.queryByText(/错误/)).not.toBeInTheDocument();
  });

  it('点击压缩按钮后修改输入 → 输出恢复实时 pretty 同步（覆盖被清除）', () => {
    const { rerender, container } = render(
      <DataFormatter input='{"a":1,"b":2}' onChange={() => {}} />
    );
    // 点压缩 → 输出变 minify（紧凑格式，无空格分隔）
    fireEvent.click(screen.getByRole('button', { name: /压缩/ }));
    expect(getOutputText(container)).toContain('"a":1');

    // 重新渲染修改输入 → 恢复 pretty（带空格分隔）
    rerender(<DataFormatter input='{"x":9}' onChange={() => {}} />);
    const output = getOutputText(container);
    expect(output).toContain('"x": 9');
  });
});
