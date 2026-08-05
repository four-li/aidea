// 数据格式化 tab（v0.3：JSON/XML/YAML 互转 + 实时同步 + Unicode 反转义）
// 设计：
// - 输入格式自动识别，无手动选择器
// - 输出格式默认跟随输入识别的格式，用户手选后停止跟随
// - 输出区实时 pretty 同步（useMemo，无 debounce）
// - 格式化按钮：把输入区原文 pretty 后写回输入区
// - 压缩按钮：把输出 minify 后临时覆盖显示（输入变化后自动恢复 pretty 同步）
import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { Copy, Trash2, Minimize2, Braces } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { ideaCodeMirrorTheme } from './codemirror-theme';
import { copyToClipboard } from '../../../../lib/clipboard';
import {
  detectFormat,
  transform,
  type DataFormat,
} from './format-utils';

interface DataFormatterProps {
  input: string;
  onChange: (value: string) => void;
}

// 输出格式选项
const OUTPUT_FORMATS: Array<{ value: DataFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
];

// CodeMirror language 映射（只做语法高亮，不挂 linter，避免切换格式时 lint 残留报错）
function getLanguageExt(format: DataFormat) {
  switch (format) {
    case 'json':
      return [json()];
    case 'xml':
      return [xml()];
    case 'yaml':
      return [yaml()];
  }
}

// 智能引号拦截：监听 beforeinput，把中文引号转英文
// 原因：macOS 系统级智能引号会在 paste/输入时把 " 替换成 " ”
const smartQuoteHandler = EditorView.domEventHandlers({
  beforeinput(event: InputEvent, view: EditorView) {
    if (
      event.inputType !== 'insertText' &&
      event.inputType !== 'insertFromPaste'
    ) {
      return false;
    }
    const text = event.data;
    if (!text || !/[\u201c\u201d\u2018\u2019]/.test(text)) {
      return false;
    }
    event.preventDefault();
    const fixed = text
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    view.dispatch(view.state.replaceSelection(fixed));
    return true;
  },
});

export function DataFormatter({ input, onChange }: DataFormatterProps) {
  // 工具栏状态
  // 用户手选过输出格式 → userOutputFormat 非 null，停止跟随输入
  const [userOutputFormat, setUserOutputFormat] = useState<DataFormat | null>(null);
  const [unescape, setUnescape] = useState(true);
  // 压缩覆盖：用户点压缩按钮后临时显示 minify 版本，输入变化后清除
  const [minifyOverride, setMinifyOverride] = useState<string | null>(null);

  // 自动识别输入格式（空输入按 json 处理，避免空输入报错）
  const resolvedInputFormat: DataFormat = useMemo(
    () => (input.trim() === '' ? 'json' : detectFormat(input)),
    [input]
  );

  // 输出格式：用户手选过用 userOutputFormat，否则跟随输入识别的格式
  // derived state（同步计算，避免 useEffect 时序导致首次 render 不一致）
  const outputFormat: DataFormat = userOutputFormat ?? resolvedInputFormat;

  // 输入/输出格式/反转义变化时清除压缩覆盖，恢复实时 pretty 同步
  useEffect(() => {
    setMinifyOverride(null);
  }, [input, outputFormat, unescape]);

  // 实时计算 pretty 输出（无 debounce，立即同步）
  // 空输入 → 空输出且不报错
  const { computedOutput, error } = useMemo(() => {
    if (input.trim() === '') {
      return { computedOutput: '', error: '' };
    }
    const r = transform(input, resolvedInputFormat, outputFormat, {
      minify: false,
      unescape,
    });
    return r.ok
      ? { computedOutput: r.output, error: '' }
      : { computedOutput: '', error: r.error };
  }, [input, resolvedInputFormat, outputFormat, unescape]);

  // 显示输出：压缩覆盖优先，否则用实时计算结果
  const displayOutput = minifyOverride ?? computedOutput;

  // CodeMirror language Compartment（热切换语言）
  // 用 useState 初始化而非 useRef，避免 ESLint react-hooks/refs 警告
  const [inputLangCompartment] = useState(() => new Compartment());
  const [outputLangCompartment] = useState(() => new Compartment());

  const inputExtensions = useMemo(
    () => [
      inputLangCompartment.of(getLanguageExt(resolvedInputFormat)),
      smartQuoteHandler,
      ...ideaCodeMirrorTheme,
    ],
    [resolvedInputFormat, inputLangCompartment]
  );

  const outputExtensions = useMemo(
    () => [
      outputLangCompartment.of(getLanguageExt(outputFormat)),
      ...ideaCodeMirrorTheme,
    ],
    [outputFormat, outputLangCompartment]
  );

  // 格式化按钮：把输入原文 pretty 后写回输入区
  // 适用场景：用户粘贴了一段压缩内容，点一下展开成可读格式
  // 注意：反转义只作用于输出区，格式化写回原文时不反转义（保留 \uXXXX 原样）
  const handleFormat = () => {
    if (input.trim() === '') {
      toast.error('输入为空');
      return;
    }
    const r = transform(input, resolvedInputFormat, resolvedInputFormat, {
      minify: false,
      unescape: false,
    });
    if (r.ok) {
      onChange(r.output);
      toast.success('已展开原文');
    } else {
      toast.error(r.error);
    }
  };

  // 压缩按钮：把输出 minify 后临时覆盖显示
  // 输入变化/格式切换/反转义切换都会清除覆盖，恢复实时 pretty
  const handleMinify = () => {
    if (input.trim() === '') {
      toast.error('输入为空');
      return;
    }
    const r = transform(input, resolvedInputFormat, outputFormat, {
      minify: true,
      unescape,
    });
    if (r.ok) {
      setMinifyOverride(r.output);
      toast.success('已压缩输出');
    } else {
      toast.error(r.error);
    }
  };

  const handleClear = () => {
    onChange('');
    setMinifyOverride(null);
  };

  const handleOutputFormatChange = (v: DataFormat) => {
    setUserOutputFormat(v);
  };

  const handleCopy = async () => {
    if (!displayOutput) {
      toast.error('输出为空，无法复制');
      return;
    }
    try {
      await copyToClipboard(displayOutput);
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {/* 工具栏：输出格式 + 反转义 */}
      <div className="flex items-center gap-4 flex-shrink-0 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">输出格式</span>
          <Select value={outputFormat} onValueChange={(v) => handleOutputFormatChange(v as DataFormat)}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={unescape}
            onCheckedChange={(v) => setUnescape(v === true)}
          />
          <span className="text-xs text-muted-foreground">Unicode 反转义</span>
        </label>

        {minifyOverride !== null && (
          <span className="text-xs text-muted-foreground">
            （压缩视图，输入变化后恢复展开）
          </span>
        )}
      </div>

      {/* 编辑器区：50/50 分栏，撑满剩余高度 */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* 输入区 */}
        <div className="flex flex-col gap-1.5 min-h-0">
          <div className="flex items-center justify-between flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              输入（识别为 {resolvedInputFormat.toUpperCase()}）
            </span>
            <div className="flex gap-1">
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={handleClear}>
                      <Trash2 size={14} />
                      清空
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>清空输入</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="default" size="sm" onClick={handleFormat}>
                      <Braces size={14} />
                      格式化
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>把输入原文展开为 pretty 格式（写回输入区）</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="flex-1 min-h-0 border border-border rounded-md overflow-hidden">
            <CodeMirror
              value={input}
              onChange={onChange}
              extensions={inputExtensions}
              height="100%"
              autoFocus
              basicSetup={{
                lineNumbers: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                foldGutter: false,
                autocompletion: false,
              }}
            />
          </div>
        </div>

        {/* 输出区 */}
        <div className="flex flex-col gap-1.5 min-h-0">
          <div className="flex items-center justify-between flex-shrink-0">
            <span className="text-xs text-muted-foreground">输出</span>
            <div className="flex gap-1">
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={handleMinify}>
                      <Minimize2 size={14} />
                      压缩
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>把输出压缩成一行（临时覆盖，输入变化后恢复）</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={handleCopy}>
                      <Copy size={14} />
                      复制
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>复制输出</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {error && (
            <div className="flex-shrink-0 bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-md">
              错误：{error}
            </div>
          )}

          <div className="flex-1 min-h-0 border border-border rounded-md overflow-hidden">
            <CodeMirror
              value={displayOutput}
              extensions={outputExtensions}
              height="100%"
              editable={false}
              basicSetup={{
                lineNumbers: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                // 输出区支持折叠（JSON/XML/YAML 都内置 fold 支持）
                // 折叠图标显示在左侧 foldGutter，点击展开/收起
                foldGutter: true,
                autocompletion: false,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
