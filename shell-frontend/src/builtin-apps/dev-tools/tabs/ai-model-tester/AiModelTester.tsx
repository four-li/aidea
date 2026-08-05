import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, History, Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Textarea } from '../../../../components/ui/textarea';
import { ipc } from '../../../../lib/ipc';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import type {
  AiConfigHistoryItem,
  AiHttpRequest,
  AiHttpResponse,
  AiTestConfig,
} from '../../../../types/ai-test';

type TesterTab = 'connectivity' | 'usage' | 'models' | 'multimodal';

interface RequestTemplate {
  request: AiHttpRequest;
  extractor?: (response: unknown) => unknown;
}

const TEMPLATES: Record<TesterTab, string> = {
  connectivity:
    '({\n  request: {\n    url: "{{baseUrl}}/v1/chat/completions",\n    method: "POST",\n    headers: {\n      "Authorization": "Bearer {{apiKey}}",\n      "Content-Type": "application/json"\n    },\n    body: {\n      model: "{{model}}",\n      messages: [{ role: "user", content: "请只回复 OK" }],\n      max_tokens: 5,\n      temperature: 0\n    }\n  },\n  extractor: (response) => response?.choices?.[0]?.message?.content\n})',
  usage:
    '({\n  request: {\n    url: "{{baseUrl}}/v1/usage",\n    method: "GET",\n    headers: { "Authorization": "Bearer {{apiKey}}" }\n  },\n  extractor: (response) => {\n    const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;\n    const unit = response?.unit ?? response?.quota?.unit ?? "USD";\n    return {\n      isValid: response?.is_active ?? response?.isValid ?? true,\n      remaining,\n      unit\n    };\n  }\n})',
  models:
    '({\n  request: {\n    url: "{{baseUrl}}/v1/models",\n    method: "GET",\n    headers: { "Authorization": "Bearer {{apiKey}}" }\n  },\n  extractor: (response) => response?.data?.map((item) => item.id) ?? response\n})',
  multimodal:
    '({\n  request: {\n    url: "{{baseUrl}}/v1/chat/completions",\n    method: "POST",\n    headers: {\n      "Authorization": "Bearer {{apiKey}}",\n      "Content-Type": "application/json"\n    },\n    body: {\n      model: "{{model}}",\n      messages: [{\n        role: "user",\n        content: [\n          { type: "text", text: "请描述这张图片" },\n          { type: "image_url", image_url: { url: "{{imageData}}" } }\n        ]\n      }],\n      max_tokens: 100\n    }\n  },\n  extractor: (response) => response?.choices?.[0]?.message?.content\n})',
};

function renderTemplate(source: string, config: AiTestConfig, imageData: string): RequestTemplate {
  const filled = source
    .replaceAll('{{baseUrl}}', config.base_url.replace(/\/$/, ''))
    .replaceAll('{{apiKey}}', config.api_key)
    .replaceAll('{{model}}', config.model)
    .replaceAll('{{imageData}}', imageData);
  const template = Function('"use strict"; return (' + filled + ');')() as unknown;
  if (!template || typeof template !== 'object' || !('request' in template)) {
    throw new Error('模板必须返回含 request 字段的对象');
  }
  return template as RequestTemplate;
}

export function AiModelTester() {
  const [config, setConfig] = useState<AiTestConfig>({
    api_key: '',
    base_url: 'https://api.openai.com',
    model: '',
  });
  const [activeTab, setActiveTab] = useState<TesterTab>('connectivity');
  const [templates, setTemplates] = useState(TEMPLATES);
  const [response, setResponse] = useState<AiHttpResponse>();
  const [extracted, setExtracted] = useState<unknown>();
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [imageData, setImageData] = useState('');
  const [imageName, setImageName] = useState('');
  const [history, setHistory] = useState<AiConfigHistoryItem[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const displayedResponse = useMemo(
    () => (response ? JSON.stringify(response.body, null, 2) : ''),
    [response],
  );
  const displayedExtracted = useMemo(
    () => (extracted === undefined ? '' : JSON.stringify(extracted, null, 2)),
    [extracted],
  );

  const update = (key: keyof AiTestConfig, value: string) =>
    setConfig((old) => ({ ...old, [key]: value }));

  const loadHistory = async () => {
    try {
      setHistory(await ipc.listAiConfigs());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const loadHistoryConfig = async (id: string) => {
    try {
      const saved = await ipc.loadAiConfig(id);
      setConfig(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteHistory = async (id: string) => {
    try {
      await ipc.deleteAiConfig(id);
      await loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const send = async () => {
    setRunning(true);
    setError('');
    setResponse(undefined);
    setExtracted(undefined);
    try {
      const template = renderTemplate(templates[activeTab], config, imageData);
      const result = await ipc.sendAiHttpRequest(template.request);
      setResponse(result);
      setExtracted(template.extractor?.(result.body));
      if (
        result.status >= 200 &&
        result.status < 300 &&
        config.api_key.trim() &&
        config.base_url.trim()
      ) {
        await ipc.saveAiConfig(config);
        await loadHistory();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageData(String(reader.result));
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col gap-3 overflow-hidden">
        <div className="flex items-center gap-2 rounded-lg bg-card p-2">
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="ai-api-key" className="sr-only">
              API Key
            </Label>
            <Input
              id="ai-api-key"
              aria-label="API Key"
              type={showApiKey ? 'text' : 'password'}
              value={config.api_key}
              onChange={(event) => update('api_key', event.target.value)}
              autoComplete="off"
              placeholder="App Key"
              className="h-8 pr-9 text-xs"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-8 w-8"
                  onClick={() => setShowApiKey((value) => !value)}
                >
                  {showApiKey ? <EyeOff /> : <Eye />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showApiKey ? '隐藏 App Key' : '显示 App Key'}</TooltipContent>
            </Tooltip>
          </div>
          <div className="min-w-0 flex-[1.4]">
            <Label htmlFor="ai-base-url" className="sr-only">
              Base URL
            </Label>
            <Input
              id="ai-base-url"
              aria-label="Base URL"
              value={config.base_url}
              onChange={(event) => update('base_url', event.target.value)}
              placeholder="Base URL"
              className="h-8 text-xs"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor="ai-model" className="sr-only">
              Model
            </Label>
            <Input
              id="ai-model"
              aria-label="Model"
              value={config.model}
              onChange={(event) => update('model', event.target.value)}
              placeholder="Model"
              className="h-8 text-xs"
            />
          </div>
          <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="历史配置"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>历史配置</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>历史配置</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.length === 0 && (
                <DropdownMenuItem disabled>暂无成功测试记录</DropdownMenuItem>
              )}
              {history.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="gap-2 py-2"
                  onSelect={(event) => {
                    if ((event.target as Element).closest('[data-delete-history]')) {
                      event.preventDefault();
                      return;
                    }
                    void loadHistoryConfig(item.id);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{item.base_url}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.model || '未填写模型'} · {item.key_hint}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label="删除历史配置"
                    data-delete-history
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHistoryOpen(false);
                      void deleteHistory(item.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TesterTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="self-start">
            <TabsTrigger value="connectivity">连通性</TabsTrigger>
            <TabsTrigger value="usage">查询用量</TabsTrigger>
            <TabsTrigger value="models">模型列表</TabsTrigger>
            <TabsTrigger value="multimodal">多模态</TabsTrigger>
          </TabsList>
          {(['connectivity', 'usage', 'models', 'multimodal'] as const).map((tab) => (
            <TabsContent
              key={tab}
              value={tab}
              className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
            >
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
                <div className="flex min-h-0 flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={'template-' + tab}>请求模板</Label>
                    <Button size="sm" onClick={send} disabled={running}>
                      {running ? <Loader2 className="animate-spin" /> : <Play />}发送请求
                    </Button>
                  </div>
                  {tab === 'multimodal' && (
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(event) => chooseImage(event.target.files?.[0])}
                    />
                  )}
                  {tab === 'multimodal' && (
                    <span className="text-xs text-muted-foreground">
                      {imageName || '图片会替换 {{imageData}}，大小上限 5MB'}
                    </span>
                  )}
                  <Textarea
                    id={'template-' + tab}
                    aria-label="请求模板"
                    value={templates[tab]}
                    onChange={(event) =>
                      setTemplates((old) => ({ ...old, [tab]: event.target.value }))
                    }
                    className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                  />
                </div>
                <div className="flex min-h-0 flex-col gap-2">
                  <Label>
                    响应结果
                    {response && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        HTTP {response.status} · {response.elapsed_ms} ms
                      </span>
                    )}
                  </Label>
                  {error ? (
                    <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                      {error}
                    </div>
                  ) : (
                    <Textarea
                      aria-label="原始响应"
                      value={displayedResponse}
                      readOnly
                      placeholder="发送请求后显示原始响应"
                      className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                    />
                  )}
                  {displayedExtracted && (
                    <>
                      <Label>提取结果</Label>
                      <Textarea
                        aria-label="提取结果"
                        value={displayedExtracted}
                        readOnly
                        className="min-h-[100px] resize-none font-mono text-xs leading-5"
                      />
                    </>
                  )}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
