import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, History, ImagePlus, Loader2, Play, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
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

const TESTER_TABS: { id: TesterTab; label: string }[] = [
  { id: 'connectivity', label: '连通性' },
  { id: 'usage', label: '查询用量' },
  { id: 'models', label: '模型列表' },
  { id: 'multimodal', label: '图片理解' },
];

interface RequestTemplate {
  request: AiHttpRequest;
  extractor?: (response: unknown) => unknown;
}

function encodeTemplateValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
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
    .replaceAll('{{baseUrl}}', encodeTemplateValue(config.base_url.replace(/\/$/, '')))
    .replaceAll('{{apiKey}}', encodeTemplateValue(config.api_key))
    .replaceAll('{{model}}', encodeTemplateValue(config.model))
    .replaceAll('{{imageData}}', encodeTemplateValue(imageData));
  const template = Function('"use strict"; return (' + filled + ');')() as unknown;
  if (!template || typeof template !== 'object' || !('request' in template)) {
    throw new Error('模板必须返回含 request 字段的对象');
  }
  return template as RequestTemplate;
}

function extractModelIds(body: unknown): string[] {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const id = (item as { id?: unknown }).id;
      return typeof id === 'string' ? id : '';
    })
    .filter(Boolean);
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
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [syncingModels, setSyncingModels] = useState(false);

  const displayedResponse = useMemo(
    () => (response ? JSON.stringify(response.body, null, 2) : ''),
    [response],
  );
  const displayedExtracted = useMemo(
    () => (extracted === undefined ? '' : JSON.stringify(extracted, null, 2)),
    [extracted],
  );
  const modelChoices = useMemo(
    () =>
      config.model && !modelOptions.includes(config.model)
        ? [config.model, ...modelOptions]
        : modelOptions,
    [config.model, modelOptions],
  );
  const canSend = !running && (activeTab !== 'multimodal' || Boolean(imageData));

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
      setModelOptions(saved.model ? [saved.model] : []);
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
        try {
          await ipc.saveAiConfig(config);
          setHistory(await ipc.listAiConfigs());
        } catch (cause) {
          toast.error('请求成功，但历史配置保存失败', {
            description: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const syncModels = async () => {
    const apiKey = config.api_key.trim();
    const baseUrl = config.base_url.trim().replace(/\/$/, '');
    if (!apiKey) {
      toast.error('模型列表拉取失败', { description: '请先填写 App Key' });
      return;
    }
    if (!baseUrl) {
      toast.error('模型列表拉取失败', { description: '请先填写 Base URL' });
      return;
    }
    setSyncingModels(true);
    try {
      const result = await ipc.sendAiHttpRequest({
        url: `${baseUrl}/v1/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`HTTP ${result.status}`);
      }
      const ids = extractModelIds(result.body);
      setModelOptions(ids);
      if (!config.model && ids[0]) update('model', ids[0]);
    } catch (cause) {
      toast.error('模型列表拉取失败', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSyncingModels(false);
    }
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片读取失败', { description: '图片不能超过 5MB' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageData(String(reader.result));
      setImageName(file.name);
    };
    reader.onerror = () => {
      toast.error('图片读取失败', { description: '请重新选择图片' });
    };
    reader.readAsDataURL(file);
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div className="grid h-full grid-cols-[10rem_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col gap-1 border-r border-border bg-muted/20 p-2">
          <div className="px-2 pb-2 pt-1 text-xs font-semibold text-foreground">AI 模型测试</div>
          {TESTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                'h-9 rounded-md px-3 text-left text-xs font-medium transition-colors ' +
                (activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground')
              }
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </aside>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(12rem,1fr)_2rem] items-center gap-2 border-b border-border px-3 py-3">
            <div className="relative min-w-0">
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
                    aria-label={showApiKey ? '隐藏 App Key' : '显示 App Key'}
                    onClick={() => setShowApiKey((value) => !value)}
                  >
                    {showApiKey ? <EyeOff /> : <Eye />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showApiKey ? '隐藏 App Key' : '显示 App Key'}</TooltipContent>
              </Tooltip>
            </div>
            <div className="min-w-0">
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
            <div className="flex min-w-0 items-center gap-1" role="group" aria-label="Model">
              <Label className="sr-only">Model</Label>
              <Select value={config.model} onValueChange={(value) => update('model', value)}>
                <SelectTrigger aria-label="Model" className="h-8 min-w-0 text-xs">
                  <SelectValue placeholder="先同步模型列表" />
                </SelectTrigger>
                <SelectContent>
                  {modelChoices.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      暂无模型
                    </SelectItem>
                  ) : (
                    modelChoices.map((model) => (
                      <SelectItem key={model} value={model} className="text-xs">
                        {model}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="同步模型列表"
                    onClick={() => void syncModels()}
                    disabled={syncingModels}
                  >
                    <RefreshCw className={syncingModels ? 'animate-spin' : ''} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>同步模型列表</TooltipContent>
              </Tooltip>
            </div>
            <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
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
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <div className="flex min-h-0 flex-col gap-2">
                <div className="flex h-8 items-center justify-between">
                  <Label htmlFor={'template-' + activeTab}>请求模板</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {TESTER_TABS.find((tab) => tab.id === activeTab)?.label}
                    </span>
                    <Button size="sm" className="h-8" onClick={send} disabled={!canSend}>
                      {running ? <Loader2 className="animate-spin" /> : <Play />}发送请求
                    </Button>
                  </div>
                </div>
                {activeTab === 'multimodal' && (
                  <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-2">
                    {imageData ? (
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs">{imageName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="移除图片"
                          onClick={() => {
                            setImageData('');
                            setImageName('');
                          }}
                        >
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Label
                          htmlFor="ai-image"
                          className="flex h-12 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <ImagePlus />
                          上传图片
                        </Label>
                        <div className="min-w-0 text-xs">
                          <div className="font-medium text-foreground">点击左侧按钮选择图片</div>
                          <div className="mt-1 text-muted-foreground">
                            支持图片文件，大小上限 5MB
                          </div>
                        </div>
                        <Input
                          id="ai-image"
                          aria-label="选择图片"
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(event) => chooseImage(event.target.files?.[0])}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex min-h-0 flex-1">
                  <Textarea
                    id={'template-' + activeTab}
                    aria-label="请求模板"
                    value={templates[activeTab]}
                    onChange={(event) =>
                      setTemplates((old) => ({ ...old, [activeTab]: event.target.value }))
                    }
                    className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                  />
                </div>
              </div>
              <div className="flex min-h-0 flex-col gap-2">
                <Label className="h-8 leading-8">
                  响应结果
                  {response && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      HTTP {response.status} · {response.elapsed_ms} ms
                    </span>
                  )}
                </Label>
                {error && (
                  <div
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {error}
                  </div>
                )}
                <Textarea
                  aria-label="原始响应"
                  value={displayedResponse}
                  readOnly
                  placeholder={error ? '请求失败，未返回响应' : '发送请求后显示原始响应'}
                  className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                />
                {displayedExtracted && !error && (
                  <>
                    <Label>提取结果</Label>
                    <Textarea
                      aria-label="提取结果"
                      value={displayedExtracted}
                      readOnly
                      className="h-32 resize-none font-mono text-xs leading-5"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
