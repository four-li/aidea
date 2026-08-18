import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ipc } from '../../lib/ipc';
import type { AiServiceDefinition, AiServiceModelSummary } from '../../types/ai-service';

const DEFAULT_MODEL = '__default__';

interface ServiceListPageProps {
  onTestService: (serviceId: string) => void;
}

export function ServiceListPage({ onTestService }: ServiceListPageProps) {
  const [services, setServices] = useState<AiServiceDefinition[]>([]);
  const [models, setModels] = useState<AiServiceModelSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([ipc.listAiServiceServices(), ipc.listAiServiceModels()])
      .then(([serviceList, modelList]) => {
        setServices(serviceList);
        setModels(modelList);
      })
      .catch((error) => toast.error('读取 AI Service 服务失败', { description: String(error) }))
      .finally(() => setLoading(false));
  }, []);

  const bindModel = async (serviceId: string, value: string) => {
    const modelId = value === DEFAULT_MODEL ? null : value;
    try {
      await ipc.saveAiServiceServiceModel(serviceId, modelId);
      setServices((current) =>
        current.map((service) => (service.id === serviceId ? { ...service, model_id: modelId } : service)),
      );
      toast.success('服务模型已更新');
    } catch (error) {
      toast.error('保存服务模型失败', { description: String(error) });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-base font-semibold text-foreground">服务列表</h1>
        <p className="mt-1 text-sm text-muted-foreground">服务接口由 AI Service 管理，子应用只需要调用固定契约。</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取服务...</p>
      ) : services.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          暂无可用服务。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {services.map((service) => {
            const selectedModel = models.find((model) => model.id === service.model_id);
            const value = service.model_id && !selectedModel ? service.model_id : service.model_id ?? DEFAULT_MODEL;
            return (
              <div key={service.id} className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{service.id}</p>
                    <Badge variant="outline">{service.protocol}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{service.description}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <span>接口 <code className="font-mono text-foreground">{service.path}</code></span>
                    <span>请求 <code className="font-mono text-foreground">{'{"message":"..."}'}</code></span>
                    <span>返回 <code className="font-mono text-foreground">{'{"code":0,"data":"..."}'}</code></span>
                  </div>
                  {!selectedModel && service.model_id && (
                    <p className="mt-1 text-xs text-destructive">绑定模型已不存在，请重新选择或恢复跟随默认。</p>
                  )}
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-64">
                  <label htmlFor={`service-model-${service.id}`} className="text-xs text-muted-foreground">
                    使用模型
                  </label>
                  <Select value={value} onValueChange={(next) => void bindModel(service.id, next)}>
                    <SelectTrigger id={`service-model-${service.id}`} aria-label={`为 ${service.id} 选择模型`}>
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={DEFAULT_MODEL}>跟随默认（排序第一）</SelectItem>
                        {service.model_id && !selectedModel && (
                          <SelectItem value={service.model_id}>未配置（模型已删除）</SelectItem>
                        )}
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id} disabled={!model.enabled}>
                            {model.model}{model.enabled ? '' : '（已停用）'}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  aria-label={`测试 ${service.id} 服务`}
                  onClick={() => onTestService(service.id)}
                >
                  <Play data-icon="inline-start" />
                  去测试
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
