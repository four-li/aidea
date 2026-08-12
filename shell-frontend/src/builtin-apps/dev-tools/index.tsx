// DevTools 内置子应用入口
// 顶部 Tabs 切换 JSON 格式化 / 时间戳转换 / IP 查询，切 tab 不丢输入（state 提升到顶层）
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { ipc } from '../../lib/ipc';
import { DataFormatter } from './tabs/data-formatter/DataFormatter';
import { TimestampConverter } from './tabs/timestamp-converter/TimestampConverter';
import { IpLookup } from './tabs/ip-lookup/IpLookup';
import { AiModelTester } from './tabs/ai-model-tester/AiModelTester';
import { DEV_TOOLS_TABS, type DevToolsTabId } from './tabs';

export function DevToolsPage() {
  // 顶层 state：切 tab 时保留输入
  const [activeTab, setActiveTab] = useState<DevToolsTabId>('data');
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [dataInput, setDataInput] = useState('');
  const [tsInput, setTsInput] = useState('');
  const [dateInput, setDateInput] = useState('');

  useEffect(() => {
    let disposed = false;
    void ipc
      .getDevToolsSettings()
      .then((settings) => {
        if (!disposed) setHiddenTabs(settings.hidden_tabs);
      })
      .catch((error) => toast.error('读取 DevTools 设置失败', { description: String(error) }));
    return () => {
      disposed = true;
    };
  }, []);

  const visibleTabs = DEV_TOOLS_TABS.filter((tab) => !hiddenTabs.includes(tab.id));
  const availableTabs = visibleTabs.length > 0 ? visibleTabs : DEV_TOOLS_TABS.slice(0, 1);

  useEffect(() => {
    if (hiddenTabs.includes(activeTab)) {
      setActiveTab(DEV_TOOLS_TABS.find((tab) => !hiddenTabs.includes(tab.id))?.id ?? 'data');
    }
  }, [activeTab, hiddenTabs]);

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden h-full">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DevToolsTabId)}
        className="flex-1 flex flex-col overflow-hidden h-full"
      >
        {/* Tabs 区：顶部固定，不滚动 */}
        <div className="flex items-center justify-between border-b border-border px-6 pt-4 flex-shrink-0">
          <TabsList>
            {availableTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* 内容区：撑满剩余高度，data tab 用 h-full 让 DataFormatter 撑满 */}
        <div className="flex-1 min-h-0 px-6 py-4 overflow-hidden">
          {availableTabs.some((tab) => tab.id === 'data') && (
            <TabsContent value="data" className="h-full mt-0 data-[state=active]:block">
              <DataFormatter input={dataInput} onChange={setDataInput} />
            </TabsContent>
          )}
          {availableTabs.some((tab) => tab.id === 'timestamp') && (
            <TabsContent value="timestamp" className="h-full mt-0 data-[state=active]:block">
              <TimestampConverter
                tsInput={tsInput}
                dateInput={dateInput}
                onTsChange={setTsInput}
                onDateChange={setDateInput}
              />
            </TabsContent>
          )}
          {availableTabs.some((tab) => tab.id === 'ip') && (
            <TabsContent value="ip" className="h-full mt-0 data-[state=active]:block">
              <IpLookup />
            </TabsContent>
          )}
          {availableTabs.some((tab) => tab.id === 'ai') && (
            <TabsContent value="ai" className="h-full mt-0 data-[state=active]:block">
              <AiModelTester />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
