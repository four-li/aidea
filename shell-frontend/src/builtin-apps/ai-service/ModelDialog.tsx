import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, List, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { ipc } from '../../lib/ipc';
import type { AiServiceModel } from '../../types/ai-service';

export const createAiServiceModel = (sortOrder: number): AiServiceModel => ({
  id: crypto.randomUUID(),
  provider: '',
  base_url: '',
  api_key: '',
  model: '',
  sort_order: sortOrder,
  enabled: true,
});

export function providerFromBaseUrl(value: string): string {
  try {
    const hostname = new URL(value).hostname;
    const parts = hostname.split('.').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? '';
  } catch {
    return '';
  }
}

interface ModelDialogProps {
  model: AiServiceModel | null;
  onClose: () => void;
  onSave: (model: AiServiceModel) => Promise<void>;
}

export function ModelDialog({ model, onClose, onSave }: ModelDialogProps) {
  const [draft, setDraft] = useState<AiServiceModel | null>(model);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelOptionsOpen, setModelOptionsOpen] = useState(false);
  const inferredProvider = useRef('');
  const modelOptionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(model);
    setShowApiKey(false);
    setModelOptions([]);
    setModelOptionsOpen(false);
    inferredProvider.current = model ? providerFromBaseUrl(model.base_url) : '';
  }, [model]);

  // 列表打开时，点击选择器以外的区域就收起列表。
  useEffect(() => {
    if (!modelOptionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !modelOptionsRef.current?.contains(event.target)) {
        setModelOptionsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [modelOptionsOpen]);

  const update = (field: keyof AiServiceModel, value: string | boolean) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const updateBaseUrl = (value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const nextProvider = providerFromBaseUrl(value);
      const shouldInfer = !current.provider.trim() || current.provider === inferredProvider.current;
      inferredProvider.current = nextProvider;
      return { ...current, base_url: value, provider: shouldInfer && nextProvider ? nextProvider : current.provider };
    });
  };

  const fetchModels = async () => {
    if (!draft?.base_url.trim() || !draft.api_key.trim()) {
      toast.error('获取模型列表失败', { description: '请先填写 Base URL 和 API Key' });
      return;
    }
    setLoadingModels(true);
    try {
      const options = await ipc.fetchAiServiceProviderModels({
        base_url: draft.base_url.trim(),
        api_key: draft.api_key,
      });
      setModelOptions(options);
      setModelOptionsOpen(options.length > 0);
    } catch (error) {
      toast.error('获取模型列表失败', { description: String(error) });
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft?.model ? '编辑模型' : '新增模型'}</DialogTitle>
          <DialogDescription>模型配置只供 AI Service 内部使用，API Key 不会提供给子应用。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-base-url">Base URL</Label>
            <Input id="model-base-url" value={draft?.base_url ?? ''} onChange={(event) => updateBaseUrl(event.target.value)} placeholder="例如：https://api.openai.com/v1" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-api-key">API Key</Label>
            <div className="relative">
              <Input id="model-api-key" type={showApiKey ? 'text' : 'password'} value={draft?.api_key ?? ''} onChange={(event) => update('api_key', event.target.value)} className="pr-10" placeholder="sk-..." />
              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowApiKey((visible) => !visible)}>
                {showApiKey ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-name-input">模型名称</Label>
            <div className="flex gap-2">
              <div ref={modelOptionsRef} className="relative flex-1">
                <Input
                  id="model-name-input"
                  aria-label="模型名称"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="model-name-options"
                  aria-expanded={modelOptionsOpen}
                  value={draft?.model ?? ''}
                  onChange={(event) => {
                    update('model', event.target.value);
                    if (modelOptions.length > 0) setModelOptionsOpen(true);
                  }}
                  onFocus={() => modelOptions.length > 0 && setModelOptionsOpen(true)}
                  className="pr-10"
                  placeholder="例如：gpt-5"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  aria-label="打开模型列表"
                  disabled={modelOptions.length === 0}
                  onClick={() => setModelOptionsOpen((open) => !open)}
                >
                  <ChevronDown />
                </Button>
                {modelOptionsOpen && (
                  <div
                    id="model-name-options"
                    role="listbox"
                    aria-label="已获取模型列表"
                    className="absolute left-0 top-full z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
                  >
                    {modelOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={draft?.model === option}
                        className="flex w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          update('model', option);
                          setModelOptionsOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button type="button" variant="outline" onClick={() => void fetchModels()} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="animate-spin" /> : <List data-icon="inline-start" />}
                获取模型列表
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-provider">提供方名称</Label>
            <Input id="model-provider" aria-label="提供方名称" value={draft?.provider ?? ''} onChange={(event) => update('provider', event.target.value)} placeholder="openai" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="model-enabled">启用模型</Label>
            <Switch id="model-enabled" checked={draft?.enabled ?? true} onCheckedChange={(checked) => update('enabled', checked)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? '保存中...' : '保存模型'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
