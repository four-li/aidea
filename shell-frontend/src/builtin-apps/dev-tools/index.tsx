// DevTools 内置子应用入口
// 顶部 Tabs 切换数据格式化 / 时间戳转换 / IP 查询，切 tab 不丢输入（state 提升到顶层）
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { DataFormatter } from './tabs/data-formatter/DataFormatter';
import { TimestampConverter } from './tabs/timestamp-converter/TimestampConverter';
import { IpLookup } from './tabs/ip-lookup/IpLookup';
import { AiModelTester } from './tabs/ai-model-tester/AiModelTester';

export function DevToolsPage() {
  // 顶层 state：切 tab 时保留输入
  const [activeTab, setActiveTab] = useState<'data' | 'timestamp' | 'ip' | 'ai'>('data');
  const [dataInput, setDataInput] = useState('');
  const [tsInput, setTsInput] = useState('');
  const [dateInput, setDateInput] = useState('');

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden h-full">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'data' | 'timestamp' | 'ip' | 'ai')}
        className="flex-1 flex flex-col overflow-hidden h-full"
      >
        {/* Tabs 区：顶部固定，不滚动 */}
        <div className="border-b border-border px-6 pt-4 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="data">数据格式化</TabsTrigger>
            <TabsTrigger value="timestamp">时间戳转换</TabsTrigger>
            <TabsTrigger value="ip">IP 查询</TabsTrigger>
            <TabsTrigger value="ai">AI 模型测试</TabsTrigger>
          </TabsList>
        </div>

        {/* 内容区：撑满剩余高度，data tab 用 h-full 让 DataFormatter 撑满 */}
        <div className="flex-1 min-h-0 px-6 py-4 overflow-hidden">
          <TabsContent value="data" className="h-full mt-0 data-[state=active]:block">
            <DataFormatter input={dataInput} onChange={setDataInput} />
          </TabsContent>
          <TabsContent value="timestamp" className="h-full mt-0 data-[state=active]:block">
            <TimestampConverter
              tsInput={tsInput}
              dateInput={dateInput}
              onTsChange={setTsInput}
              onDateChange={setDateInput}
            />
          </TabsContent>
          <TabsContent value="ip" className="h-full mt-0 data-[state=active]:block">
            <IpLookup />
          </TabsContent>
          <TabsContent value="ai" className="h-full mt-0 data-[state=active]:block">
            <AiModelTester />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
