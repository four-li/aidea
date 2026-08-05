// CodeMirror 6 自定义主题：跟随 shadcn CSS 变量
// 背景/字色/光标/选区等视觉属性已移至 index.css 全局 CSS（用 !important 覆盖 CodeMirror 内置亮色 baseTheme）
// 本文件只保留 JS 主题能提供的布局/尺寸属性（fontSize、fontFamily、padding 等）
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// 软换行 Extension：长行视觉换到下一行显示，但逻辑上仍是同一行
// 用 lineWrapping 而非 overflowX:hidden：用户能看到完整内容，无横向滚动条
export const ideaLineWrapping = EditorView.lineWrapping;

// 编辑器布局/尺寸属性（背景/字色等视觉属性在 index.css 中用全局 CSS 覆盖）
export const ideaEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  // CodeMirror 6 默认给 focused .cm-editor 加 outline: 1px dotted #212121
  // 会显示一条横的虚线点状轮廓，覆盖掉避免视觉干扰
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-content': {
    caretColor: 'var(--primary)',
    padding: '8px 0',
    // 撑满 scroller 高度，点击编辑器任意空白都能聚焦（否则只能点首行内容才聚焦）
    alignSelf: 'stretch',
  },
});

// 语法高亮配色（key 蓝、string 绿、number 紫、bool 红、null 灰）
// 用固定色值而非 CSS 变量（token 颜色是语义化的，不跟随主题切换）
export const ideaHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#569cd6' }, // key 蓝
  { tag: tags.string, color: '#ce9178' }, // string 橙棕
  { tag: tags.number, color: '#b5cea8' }, // number 浅绿
  { tag: tags.bool, color: '#569cd6' }, // bool 蓝
  { tag: tags.null, color: '#569cd6' }, // null 蓝
  { tag: tags.definition(tags.propertyName), color: '#569cd6' },
  { tag: tags.punctuation, color: 'var(--muted-foreground)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]);

// 组合 Extension（含软换行）
export const ideaCodeMirrorTheme = [
  ideaEditorTheme,
  ideaLineWrapping,
  syntaxHighlighting(ideaHighlightStyle),
];
