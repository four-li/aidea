// DevTools 纯函数：JSON 解析格式化、时间戳/日期互转
// 无 React 依赖，便于单测

import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/** JSON 解析结果 */
export type JsonResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/** 时间戳解析结果 */
export type TimestampResult =
  | { ok: true; unit: 'ms' | 's'; local: string; utc: string }
  | { ok: false; error: string };

/** 日期解析结果 */
export type DateResult =
  | { ok: true; seconds: number; milliseconds: number }
  | { ok: false; error: string };

/**
 * 解析并格式化 JSON 输入
 * - 空输入 → 返回空字符串（不报错）
 * - 合法 JSON → 2 空格缩进格式化
 * - 非法 JSON → 返回 SyntaxError message
 */
export function parseJsonInput(input: string): JsonResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: true, output: '' };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return { ok: true, output: JSON.stringify(parsed, null, 2) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 解析 Unix 时间戳
 * - 长度 ≥ 13 → 毫秒
 * - 长度 10-12 → 秒
 * - 长度 < 10 或含非数字字符 → 错误
 */
export function parseTimestamp(input: string, timeZone?: string): TimestampResult {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: '时间戳应为纯数字' };
  }
  const len = trimmed.length;
  if (len < 10) {
    return { ok: false, error: '时间戳应为 10 位（秒）或 13 位（毫秒）' };
  }

  const unit: 'ms' | 's' = len >= 13 ? 'ms' : 's';
  const num = Number(trimmed);
  // 统一转成毫秒数构造 Date
  const ms = unit === 'ms' ? num : num * 1000;
  if (Number.isNaN(ms)) {
    return { ok: false, error: '时间戳数值无效' };
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: '时间戳数值无效' };
  }

  return {
    ok: true,
    unit,
    local: formatLocal(date, timeZone),
    utc: formatUtc(date),
  };
}

/**
 * 解析日期字符串为 Unix 时间戳
 * - 支持 YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss / YYYY-MM-DD
 * - 仅日期格式按本地时区 00:00:00 解析（避免 JS Date 默认 UTC 坑）
 * - 解析失败 → 返回错误
 */
export function parseDate(input: string, timeZone?: string): DateResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: '日期字符串为空' };
  }

  if (timeZone) {
    const match = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/
    );
    if (!match) {
      return { ok: false, error: '日期格式无效，应为 YYYY-MM-DD HH:mm:ss' };
    }

    const [year, month, day, hour = '00', minute = '00', second = '00'] = match.slice(1);
    const wallTime = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    const utcDate = new Date(wallTime);
    if (
      utcDate.getUTCFullYear() !== Number(year) ||
      utcDate.getUTCMonth() !== Number(month) - 1 ||
      utcDate.getUTCDate() !== Number(day) ||
      utcDate.getUTCHours() !== Number(hour) ||
      utcDate.getUTCMinutes() !== Number(minute) ||
      utcDate.getUTCSeconds() !== Number(second)
    ) {
      return { ok: false, error: '日期格式无效，应为 YYYY-MM-DD HH:mm:ss' };
    }

    try {
      let milliseconds = wallTime;
      // 夏令时切换前后偏移可能不同，第二次按候选 UTC 时间校正偏移。
      milliseconds = wallTime - getTimeZoneOffset(milliseconds, timeZone);
      milliseconds = wallTime - getTimeZoneOffset(milliseconds, timeZone);

      if (
        formatLocal(new Date(milliseconds), timeZone) !==
        normalizeDateParts(match.slice(1))
      ) {
        return { ok: false, error: '该时区不存在此日期时间' };
      }
      return { ok: true, milliseconds, seconds: Math.floor(milliseconds / 1000) };
    } catch {
      return { ok: false, error: '时区无效' };
    }
  }

  let date: Date;
  // 仅日期格式 YYYY-MM-DD，补 T00:00:00 强制本地时区解析
  // （JS Date 的 'YYYY-MM-DD' 默认按 UTC，是已知坑）
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    date = new Date(`${trimmed}T00:00:00`);
  } else {
    date = new Date(trimmed);
  }

  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: '日期格式无效，应为 YYYY-MM-DD HH:mm:ss' };
  }

  const ms = date.getTime();
  return {
    ok: true,
    milliseconds: ms,
    seconds: Math.floor(ms / 1000),
  };
}

/** 格式化为本地日期字符串 YYYY-MM-DD HH:mm:ss */
function formatLocal(date: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getTimeZoneOffset(milliseconds: number, timeZone: string): number {
  const local = formatLocal(new Date(milliseconds), timeZone).replace(' ', 'T');
  return Date.parse(`${local}Z`) - milliseconds;
}

function normalizeDateParts(parts: string[]): string {
  const [year, month, day, hour = '00', minute = '00', second = '00'] = parts;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/** 格式化为 UTC 日期字符串 YYYY-MM-DD HH:mm:ss UTC */
function formatUtc(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

// ============================================================
// v0.3: 多格式（JSON/XML/YAML）互转
// ============================================================

/** 数据格式类型 */
export type DataFormat = 'json' | 'xml' | 'yaml';

/** 转换选项 */
export interface TransformOptions {
  minify: boolean;
  unescape: boolean;
}

/** 转换结果 */
export type TransformResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/**
 * 自动识别输入格式
 * - { 或 [ 开头 → JSON
 * - < 开头 → XML
 * - 其他 → YAML
 */
export function detectFormat(input: string): DataFormat {
  const trimmed = input.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  return 'yaml';
}

/**
 * 解析输入字符串为 JS 对象
 * - 空输入 → 错误
 * - 解析失败 → 返回错误信息
 */
export function parseInput(
  input: string,
  format: DataFormat
): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: '输入为空' };
  }

  try {
    switch (format) {
      case 'json':
        return { ok: true, data: JSON.parse(trimmed) };
      case 'xml': {
        const parser = new XMLParser();
        return { ok: true, data: parser.parse(trimmed) };
      }
      case 'yaml': {
        const data = yamlLoad(trimmed);
        return { ok: true, data };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Unicode 转义：把非 ASCII 字符（charCode > 127）转成 \uXXXX 字面量
 * 用于 JSON 输出时保留原文中的 \uXXXX 转义形式
 * 仅处理 BMP 平面字符（4 位 hex），不处理 surrogate pair 之外的 Unicode
 */
function escapeNonAscii(s: string): string {
  return s.replace(/[\u0080-\uffff]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return '\\u' + code.toString(16).padStart(4, '0');
  });
}

/**
 * 序列化 JS 对象为目标格式字符串
 *
 * 反转义（unescape）语义：
 * - JSON 输出：unescape=false（默认）→ 非 ASCII 字符 escape 为 \uXXXX；unescape=true → 显示中文
 * - XML/YAML 输出：始终显示中文（escape 后不合法，反转义勾选对这两种格式无效）
 *
 * minify 语义：
 * - JSON：紧凑输出
 * - XML：无空白
 * - YAML：无压缩概念，minify=true 时转 JSON 紧凑输出
 */
export function formatOutput(
  data: unknown,
  format: DataFormat,
  opts: TransformOptions
): TransformResult {
  try {
    let output: string;

    if (format === 'yaml' && opts.minify) {
      // YAML 无压缩概念，转 JSON minify
      output = JSON.stringify(data);
    } else {
      switch (format) {
        case 'json':
          output = opts.minify
            ? JSON.stringify(data)
            : JSON.stringify(data, null, 2);
          break;
        case 'xml': {
          const builder = new XMLBuilder({
            format: !opts.minify,
            indentBy: '  ',
            suppressEmptyNode: true,
          });
          output = builder.build(data);
          break;
        }
        case 'yaml':
          output = yamlDump(data, { indent: 2, lineWidth: -1 });
          break;
      }
    }

    // JSON 输出 + 不勾反转义 → escape 非 ASCII 字符为 \uXXXX
    // 这样反转义勾选才有意义：默认保留 \uXXXX 字面量，勾选后显示中文
    if (format === 'json' && !opts.unescape) {
      output = escapeNonAscii(output);
    }
    return { ok: true, output };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 完整转换：parse + format
 * 输入格式 → JS 对象 → 输出格式
 */
export function transform(
  input: string,
  inFormat: DataFormat,
  outFormat: DataFormat,
  opts: TransformOptions
): TransformResult {
  const parsed = parseInput(input, inFormat);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return formatOutput(parsed.data, outFormat, opts);
}
