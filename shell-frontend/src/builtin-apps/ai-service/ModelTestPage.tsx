import { useEffect, useState } from 'react';
import { Loader2, Play, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Textarea } from '../../components/ui/textarea';
import { ipc } from '../../lib/ipc';
import type {
  AiServiceModel,
  AiServiceModelSummary,
  AiServiceModelTestRequest,
  AiServiceModelTestResult,
} from '../../types/ai-service';
import { createAiServiceModel, ModelDialog } from './ModelDialog';

const DEFAULT_SERVICE_ID = 'agent';

function createModelRequest(model = ''): string {
  return JSON.stringify(
    {
      model,
      messages: [{ role: 'user', content: '请只回复 OK' }],
      max_tokens: 16,
      temperature: 0,
    },
    null,
    2,
  );
}

const defaultServiceRequest = JSON.stringify({ message: '请只回复 OK' }, null, 2);

function parseRequest(value: string): Record<string, unknown> | null {
  try {
    const request: unknown = JSON.parse(value);
    return request && typeof request === 'object' && !Array.isArray(request)
      ? (request as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface ModelTestPageProps {
  serviceId?: string;
}

export function ModelTestPage({ serviceId }: ModelTestPageProps) {
  const [models, setModels] = useState<AiServiceModelSummary[]>([]);
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<'model' | 'service'>('model');
  const [modelRequest, setModelRequest] = useState(() => createModelRequest());
  const [serviceRequest, setServiceRequest] = useState(defaultServiceRequest);
  const [result, setResult] = useState<AiServiceModelTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<AiServiceModel | null>(null);

  const loadModels = async (selectedId?: string) => {
    try {
      const items = await ipc.listAiServiceModels();
      const nextId =
        selectedId && items.some((item) => item.id === selectedId)
          ? selectedId
          : (items.find((item) => item.enabled)?.id ?? '');
      setModels(items);
      setModelId(nextId);
      setModelRequest(createModelRequest(items.find((item) => item.id === nextId)?.model));
    } catch (error) {
      toast.error('读取模型配置失败', { description: String(error) });
    }
  };

  useEffect(() => {
    void loadModels();
  }, []);

  useEffect(() => {
    if (serviceId) setMode('service');
  }, [serviceId]);

  const saveModel = async (model: AiServiceModel) => {
    if (
      !model.provider.trim() ||
      !model.base_url.trim() ||
      !model.model.trim() ||
      !model.api_key.trim()
    ) {
      toast.error('请完整填写模型配置');
      return;
    }
    await ipc.saveAiServiceModel(model);
    setEditing(null);
    await loadModels(model.id);
    toast.success('模型配置已保存');
  };

  const selectModel = (nextId: string) => {
    setModelId(nextId);
    setModelRequest(createModelRequest(models.find((model) => model.id === nextId)?.model));
  };

  const test = async () => {
    const request = parseRequest(mode === 'model' ? modelRequest : serviceRequest);
    if (!request) {
      toast.error('请求参数必须是 JSON 对象');
      return;
    }
    let testRequest: AiServiceModelTestRequest;
    if (mode === 'model') {
      if (!modelId) {
        toast.error('请选择已启用的连接配置');
        return;
      }
      testRequest = { model_id: modelId, request };
    } else {
      const message = request.message;
      if (typeof message !== 'string' || !message.trim()) {
        toast.error('服务调用必须包含非空 message');
        return;
      }
      testRequest = { service_id: serviceId ?? DEFAULT_SERVICE_ID, request: { message } };
    }

    setRunning(true);
    setResult(null);
    try {
      setResult(await ipc.testAiServiceModel(testRequest));
    } catch (error) {
      toast.error('模型测试失败', { description: String(error) });
    } finally {
      setRunning(false);
    }
  };

  const request = mode === 'model' ? modelRequest : serviceRequest;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value === 'service' ? 'service' : 'model')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="toolbar"
          aria-label="模型测试工具栏"
          className="flex min-h-9 shrink-0 items-center gap-2"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="model">模型请求</TabsTrigger>
            <TabsTrigger value="service">服务调用</TabsTrigger>
          </TabsList>
          {mode === 'model' ? (
            <>
              <Label htmlFor="ai-service-test-model" className="sr-only">
                连接配置
              </Label>
              <Select value={modelId} onValueChange={selectModel}>
                <SelectTrigger id="ai-service-test-model" aria-label="测试模型" className="w-72">
                  <SelectValue placeholder="请选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {models
                    .filter((model) => model.enabled)
                    .map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.provider} · {model.model}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(createAiServiceModel(models.length))}
              >
                <Plus data-icon="inline-start" />
                新增模型
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              服务{' '}
              <code className="font-mono text-foreground">{serviceId ?? DEFAULT_SERVICE_ID}</code>
            </span>
          )}
          <Button
            className="ml-auto"
            disabled={running || (mode === 'model' && !modelId)}
            onClick={() => void test()}
          >
            {running ? <Loader2 className="animate-spin" /> : <Play data-icon="inline-start" />}
            开始测试
          </Button>
        </div>

        <TabsContent value={mode} className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <Label htmlFor="ai-service-test-request">请求参数</Label>
              <Textarea
                id="ai-service-test-request"
                aria-label="请求参数"
                value={request}
                onChange={(event) =>
                  mode === 'model'
                    ? setModelRequest(event.target.value)
                    : setServiceRequest(event.target.value)
                }
                className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                spellCheck={false}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label>响应参数</Label>
                <div className="flex items-center gap-2">
                  {result?.error && (
                    <span className="text-xs text-destructive">{result.error}</span>
                  )}
                  {result && <Badge variant="outline">耗时 {result.elapsed_ms} ms</Badge>}
                </div>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-4 font-mono text-xs leading-5 text-foreground">
                {result ? JSON.stringify(result.response, null, 2) : '尚未执行测试。'}
              </pre>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ModelDialog model={editing} onClose={() => setEditing(null)} onSave={saveModel} />
    </div>
  );
}
