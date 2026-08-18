// DevTools 内置子应用入口
// 顶部 Tabs 切换 JSON 格式化 / 时间戳转换 / IP 查询，切 tab 不丢输入（state 提升到顶层）
import { useCallback, useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { ipc } from '../../lib/ipc';
import { DevToolsSettingsPage } from './DevToolsSettingsPage';
import { DataFormatter } from './tabs/data-formatter/DataFormatter';
import { TimestampConverter } from './tabs/timestamp-converter/TimestampConverter';
import { IpLookup } from './tabs/ip-lookup/IpLookup';
import {
  DEV_TOOLS_SETTINGS_CHANGED,
  DEV_TOOLS_TABS,
  normalizeDevToolsTabOrder,
  type DevToolsTabId,
} from './tabs';

export function DevToolsPage() {
  // 顶层 state：切 tab 时保留输入
  const [activeTab, setActiveTab] = useState<DevToolsTabId>('data');
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [tabOrder, setTabOrder] = useState<DevToolsTabId[]>(
    normalizeDevToolsTabOrder([]).map((tab) => tab.id),
  );
  const [dataInput, setDataInput] = useState('');
  const [tsInput, setTsInput] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const loadSettings = useCallback(() => {
    void ipc
      .getDevToolsSettings()
      .then((settings) => {
        setHiddenTabs(settings.hidden_tabs);
        setTabOrder(normalizeDevToolsTabOrder(settings.tab_order ?? []).map((tab) => tab.id));
      })
      .catch((error) => toast.error('读取 DevTools 设置失败', { description: String(error) }));
  }, []);

  useEffect(() => {
    loadSettings();
    window.addEventListener(DEV_TOOLS_SETTINGS_CHANGED, loadSettings);
    return () => {
      window.removeEventListener(DEV_TOOLS_SETTINGS_CHANGED, loadSettings);
    };
  }, [loadSettings]);

  const orderedTabs = tabOrder
    .map((id) => DEV_TOOLS_TABS.find((tab) => tab.id === id))
    .filter((tab): tab is (typeof DEV_TOOLS_TABS)[number] => tab !== undefined);
  const visibleTabs = orderedTabs.filter((tab) => !hiddenTabs.includes(tab.id));
  const availableTabs = visibleTabs.length > 0 ? visibleTabs : orderedTabs.slice(0, 1);

  useEffect(() => {
    if (hiddenTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]?.id ?? 'data');
    }
  }, [activeTab, availableTabs, hiddenTabs]);

  if (showSettings) {
    return <DevToolsSettingsPage onClose={() => setShowSettings(false)} />;
  }

  return (
    <TooltipProvider delayDuration={200}>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="DevTools 设置"
                  onClick={() => setShowSettings(true)}
                >
                  <Settings size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>DevTools 设置</TooltipContent>
            </Tooltip>
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
          </div>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
