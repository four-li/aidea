export const DEV_TOOLS_TABS = [
  { id: 'data', label: 'JSON 格式化' },
  { id: 'timestamp', label: '时间戳转换' },
  { id: 'ip', label: 'IP 查询' },
  { id: 'ai', label: 'AI 模型测试' },
] as const;

export const DEV_TOOLS_SETTINGS_CHANGED = 'aidea:dev-tools-settings-changed';

export type DevToolsTabId = (typeof DEV_TOOLS_TABS)[number]['id'];

// 只接受当前已注册工具，保持旧配置和新增工具都能正常工作。
export function normalizeDevToolsTabOrder(order: readonly string[]) {
  const seen = new Set<string>();
  const orderedIds: DevToolsTabId[] = [];

  order.forEach((id) => {
    const tab = DEV_TOOLS_TABS.find((item) => item.id === id);
    if (tab && !seen.has(id)) {
      orderedIds.push(tab.id);
      seen.add(id);
    }
  });
  DEV_TOOLS_TABS.forEach((tab) => {
    if (!seen.has(tab.id)) orderedIds.push(tab.id);
  });

  return orderedIds.map((id) => DEV_TOOLS_TABS.find((tab) => tab.id === id)!);
}
