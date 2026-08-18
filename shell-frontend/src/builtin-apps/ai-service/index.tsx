import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { useState } from 'react';
import { AuditPage } from './AuditPage';
import { ModelConfigPage } from './ModelConfigPage';
import { ModelTestPage } from './ModelTestPage';
import { ServiceListPage } from './ServiceListPage';

const tabs = [
  { id: 'models', label: '模型配置', description: '管理 AI Service 可使用的模型。' },
  { id: 'services', label: '服务列表', description: '查看 AI Service 当前提供的服务。' },
  { id: 'test', label: '模型测试', description: '使用已保存的模型验证连接和 Agent 能力。' },
  { id: 'audit', label: '审计记录', description: '查看调用耗时、循环次数和 token 使用量。' },
] as const;

type AiServiceTab = (typeof tabs)[number]['id'];

export function AiServicePage() {
  const [activeTab, setActiveTab] = useState<AiServiceTab>('models');
  const [testServiceId, setTestServiceId] = useState<string | undefined>();

  const testService = (serviceId: string) => {
    setTestServiceId(serviceId);
    setActiveTab('test');
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <Tabs
        orientation="vertical"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AiServiceTab)}
        className="flex h-full min-h-0 flex-1 flex-row overflow-hidden"
      >
        <TabsList
          aria-label="AI Service 页面导航"
          className="flex h-full w-40 shrink-0 flex-col items-stretch justify-start gap-1 rounded-none border-r border-border bg-muted/20 p-3"
        >
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="w-full justify-start px-3 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          <TabsContent value="models" className="mt-0 min-h-full"><ModelConfigPage /></TabsContent>
          <TabsContent value="services" className="mt-0 min-h-full"><ServiceListPage onTestService={testService} /></TabsContent>
          <TabsContent value="test" className="mt-0 h-full min-h-0"><ModelTestPage serviceId={testServiceId} /></TabsContent>
          <TabsContent value="audit" className="mt-0 min-h-full"><AuditPage /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
