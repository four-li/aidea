export const DEV_TOOLS_TABS = [
  { id: 'data', label: '数据格式化' },
  { id: 'timestamp', label: '时间戳转换' },
  { id: 'ip', label: 'IP 查询' },
  { id: 'ai', label: 'AI 模型测试' },
] as const;

export type DevToolsTabId = (typeof DEV_TOOLS_TABS)[number]['id'];
