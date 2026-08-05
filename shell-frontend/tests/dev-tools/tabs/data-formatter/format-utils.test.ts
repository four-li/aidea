import { describe, it, expect } from 'vitest';
import {
  parseJsonInput,
  parseTimestamp,
  parseDate,
  detectFormat,
  parseInput,
  formatOutput,
  transform,
} from '../../../../src/builtin-apps/dev-tools/tabs/data-formatter/format-utils';

describe('parseJsonInput', () => {
  it('合法 JSON 对象 → 格式化输出（2 空格缩进）', () => {
    const result = parseJsonInput('{"a":1,"b":[2,3]}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    }
  });

  it('合法 JSON 数组 → 格式化输出', () => {
    const result = parseJsonInput('[1,2,3]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('[\n  1,\n  2,\n  3\n]');
    }
  });

  it('合法 JSON 顶层原始值 → 正常格式化', () => {
    expect(parseJsonInput('"hello"')).toEqual({ ok: true, output: '"hello"' });
    expect(parseJsonInput('123')).toEqual({ ok: true, output: '123' });
    expect(parseJsonInput('true')).toEqual({ ok: true, output: 'true' });
  });

  it('非法 JSON → 返回错误信息', () => {
    const result = parseJsonInput('{invalid}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('空输入 → 返回空结果（不报错）', () => {
    const result = parseJsonInput('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('');
    }
  });

  it('仅空白输入 → 返回空结果', () => {
    const result = parseJsonInput('   \n  \t  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe('');
    }
  });
});

describe('parseTimestamp', () => {
  it('13 位时间戳 → 毫秒解析', () => {
    const result = parseTimestamp('1698712632000');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unit).toBe('ms');
      // 本机 CST（UTC+8），2023-10-31 08:37:12 CST
      expect(result.local).toBe('2023-10-31 08:37:12');
      expect(result.utc).toBe('2023-10-31 00:37:12 UTC');
    }
  });

  it('10 位时间戳 → 秒解析', () => {
    const result = parseTimestamp('1698712632');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unit).toBe('s');
    }
  });

  it('小于 10 位 → 错误', () => {
    const result = parseTimestamp('123456789');  // 9 位
    expect(result.ok).toBe(false);
  });

  it('含非数字字符 → 错误', () => {
    const result = parseTimestamp('1698712632a');
    expect(result.ok).toBe(false);
  });

  it('空输入 → 错误', () => {
    const result = parseTimestamp('');
    expect(result.ok).toBe(false);
  });

  it('11/12 位时间戳 → 按秒解析（边界可接受）', () => {
    const result = parseTimestamp('16987126320');  // 11 位
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unit).toBe('s');
    }
  });
});

describe('parseDate', () => {
  it('按指定 IANA 时区格式化并解析日期', () => {
    const timestamp = parseTimestamp('1698712632000', 'America/New_York');
    expect(timestamp).toMatchObject({
      ok: true,
      local: '2023-10-30 20:37:12',
    });

    const date = parseDate('2023-10-30 20:37:12', 'America/New_York');
    expect(date).toMatchObject({ ok: true, milliseconds: 1698712632000 });
  });

  it('合法 YYYY-MM-DD HH:mm:ss → 返回秒+毫秒', () => {
    const result = parseDate('2023-10-31 08:37:12');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seconds).toBe(1698712632);
      expect(result.milliseconds).toBe(1698712632000);
    }
  });

  it('合法 YYYY-MM-DD → 返回当天本地 00:00:00 的时间戳', () => {
    // 注意：JS Date 的 'YYYY-MM-DD' 默认按 UTC 解析，parseDate 内部需补 T00:00:00 强制本地时区
    // 本机 CST（UTC+8）：2023-10-31 00:00:00 CST = 1698681600
    const result = parseDate('2023-10-31');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.seconds).toBe(1698681600);
      expect(result.milliseconds).toBe(1698681600000);
    }
  });

  it('合法 YYYY-MM-DDTHH:mm:ss → 可解析', () => {
    const result = parseDate('2023-10-31T08:37:12');
    expect(result.ok).toBe(true);
  });

  it('非法字符串 → 返回错误', () => {
    const result = parseDate('not-a-date');
    expect(result.ok).toBe(false);
  });

  it('空输入 → 返回错误', () => {
    const result = parseDate('');
    expect(result.ok).toBe(false);
  });
});

describe('detectFormat', () => {
  it('以 { 开头 → JSON', () => {
    expect(detectFormat('{"a":1}')).toBe('json');
  });

  it('以 [ 开头 → JSON', () => {
    expect(detectFormat('[1,2,3]')).toBe('json');
  });

  it('以 < 开头 → XML', () => {
    expect(detectFormat('<root><a>1</a></root>')).toBe('xml');
  });

  it('其他 → YAML', () => {
    expect(detectFormat('a: 1\nb: 2')).toBe('yaml');
  });

  it('空白前缀不影响识别', () => {
    expect(detectFormat('  \n {"a":1}')).toBe('json');
    expect(detectFormat('\n<root/>')).toBe('xml');
  });
});

describe('parseInput', () => {
  it('JSON 解析', () => {
    const r = parseInput('{"a":1}', 'json');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ a: 1 });
  });

  it('XML 解析 → JS 对象', () => {
    const r = parseInput('<root><a>1</a></root>', 'xml');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // fast-xml-parser 默认把数字字符串解析成数字
      expect(r.data).toEqual({ root: { a: 1 } });
    }
  });

  it('YAML 解析', () => {
    const r = parseInput('a: 1\nb: 2', 'yaml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ a: 1, b: 2 });
  });

  it('非法 JSON → 错误', () => {
    const r = parseInput('{invalid}', 'json');
    expect(r.ok).toBe(false);
  });

  it('空输入 → 错误', () => {
    expect(parseInput('', 'json').ok).toBe(false);
  });
});

describe('formatOutput', () => {
  it('JSON pretty', () => {
    const r = formatOutput({ a: 1 }, 'json', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe('{\n  "a": 1\n}');
  });

  it('JSON minify', () => {
    const r = formatOutput({ a: 1, b: [2, 3] }, 'json', { minify: true, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe('{"a":1,"b":[2,3]}');
  });

  it('XML pretty', () => {
    const r = formatOutput({ root: { a: 1 } }, 'xml', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // fast-xml-builder 输出 <root>\n  <a>1</a>\n</root>
      expect(r.output).toContain('<root>');
      expect(r.output).toContain('<a>1</a>');
    }
  });

  it('XML minify', () => {
    const r = formatOutput({ root: { a: 1 } }, 'xml', { minify: true, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 压缩后无空白
      expect(r.output).toBe('<root><a>1</a></root>');
    }
  });

  it('YAML pretty（YAML 无 minify）', () => {
    const r = formatOutput({ a: 1, b: 2 }, 'yaml', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('a: 1');
      expect(r.output).toContain('b: 2');
    }
  });

  it('YAML minify → 转 JSON minify 输出', () => {
    const r = formatOutput({ a: 1 }, 'yaml', { minify: true, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe('{"a":1}');
  });

  it('Unicode 反转义（unescape=true）：JSON 输出非 ASCII 字符显示中文', () => {
    // 输入 data 含中文字符（来自 JSON.parse 解码 \uXXXX 的结果）
    const r = formatOutput(
      { name: '你好' },
      'json',
      { minify: false, unescape: true }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // unescape=true → JSON 输出中文（不 escape）
      expect(r.output).toContain('"name": "你好"');
    }
  });

  it('Unicode 默认 escape（unescape=false）：JSON 输出非 ASCII 字符转 \\uXXXX', () => {
    const r = formatOutput(
      { name: '你好' },
      'json',
      { minify: false, unescape: false }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 默认 → JSON 输出 \uXXXX 字面量（你=\u4f60, 好=\u597d）
      expect(r.output).toContain('"name": "\\u4f60\\u597d"');
      expect(r.output).not.toContain('你好');
    }
  });

  it('XML/YAML 输出不 escape 非 ASCII（始终显示中文）', () => {
    const xmlR = formatOutput(
      { name: '你好' },
      'xml',
      { minify: false, unescape: false }
    );
    expect(xmlR.ok).toBe(true);
    if (xmlR.ok) expect(xmlR.output).toContain('你好');

    const yamlR = formatOutput(
      { name: '你好' },
      'yaml',
      { minify: false, unescape: false }
    );
    expect(yamlR.ok).toBe(true);
    if (yamlR.ok) expect(yamlR.output).toContain('你好');
  });
});

describe('transform', () => {
  it('JSON → YAML', () => {
    const r = transform('{"a":1,"b":[2,3]}', 'json', 'yaml', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('a: 1');
      expect(r.output).toContain('b:');
    }
  });

  it('JSON → XML', () => {
    const r = transform('{"root":{"a":1}}', 'json', 'xml', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('<root>');
      expect(r.output).toContain('<a>1</a>');
    }
  });

  it('YAML → JSON', () => {
    const r = transform('a: 1\nb: 2', 'yaml', 'json', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('XML → JSON', () => {
    const r = transform('<root><a>1</a></root>', 'xml', 'json', { minify: false, unescape: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain('"root"');
  });

  it('输入解析失败 → 错误透传', () => {
    const r = transform('{invalid}', 'json', 'yaml', { minify: false, unescape: false });
    expect(r.ok).toBe(false);
  });
});
