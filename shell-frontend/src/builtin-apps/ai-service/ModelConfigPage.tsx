import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Edit, GripVertical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { ipc } from '../../lib/ipc';
import type { AiServiceModel, AiServiceModelSummary } from '../../types/ai-service';
import { createAiServiceModel, ModelDialog } from './ModelDialog';

export function ModelConfigPage() {
  const [models, setModels] = useState<AiServiceModelSummary[]>([]);
  const [editing, setEditing] = useState<AiServiceModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiServiceModelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadModels = async () => {
    try {
      setModels(await ipc.listAiServiceModels());
    } catch (error) {
      toast.error('读取模型配置失败', { description: String(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadModels();
  }, []);

  const handleSave = async (model: AiServiceModel) => {
    if (!model.provider.trim() || !model.base_url.trim() || !model.model.trim() || !model.api_key.trim()) {
      toast.error('请完整填写模型配置');
      return;
    }
    try {
      await ipc.saveAiServiceModel(model);
      setEditing(null);
      await loadModels();
      toast.success('模型配置已保存');
    } catch (error) {
      toast.error('保存模型配置失败', { description: String(error) });
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = models.findIndex((model) => model.id === active.id);
    const newIndex = models.findIndex((model) => model.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = models;
    const next = arrayMove(models, oldIndex, newIndex).map((model, index) => ({
      ...model,
      sort_order: index,
    }));
    setModels(next);
    try {
      await ipc.reorderAiServiceModels(next.map((model) => model.id));
    } catch (error) {
      setModels(previous);
      toast.error('保存模型排序失败', { description: String(error) });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await ipc.deleteAiServiceModel(deleteTarget.id);
      setDeleteTarget(null);
      await loadModels();
      toast.success('模型配置已删除');
    } catch (error) {
      toast.error('删除模型配置失败', { description: String(error) });
    }
  };

  const handleEdit = async (model: AiServiceModelSummary) => {
    try {
      setEditing(await ipc.getAiServiceModel(model.id));
    } catch (error) {
      toast.error('读取模型配置失败', { description: String(error) });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">模型配置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            API Key 只保存于 AI Service 数据库，列表只显示掩码。
          </p>
        </div>
        <Button onClick={() => setEditing(createAiServiceModel(models.length))}>
          <Plus data-icon="inline-start" />
          新增模型
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取模型配置...</p>
      ) : models.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          尚未配置模型，请先新增一个模型。
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
          <SortableContext items={models.map((model) => model.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {models.map((model) => (
                <SortableModelCard
                  key={model.id}
                  model={model}
                  onEdit={() => void handleEdit(model)}
                  onDelete={() => setDeleteTarget(model)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <ModelDialog model={editing} onClose={() => setEditing(null)} onSave={handleSave} />
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型配置</DialogTitle>
            <DialogDescription>
              删除后不会自动替服务改绑模型；如果服务绑定了它，请在服务列表中重新配置。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-foreground">确认删除“{deleteTarget?.model}”吗？</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              删除模型
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SortableModelCardProps {
  model: AiServiceModelSummary;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableModelCard({ model, onEdit, onDelete }: SortableModelCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: model.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-3 rounded-md border border-border bg-card p-4"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`拖动调整模型顺序：${model.model}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{model.model}</p>
          <Badge variant={model.enabled ? 'secondary' : 'outline'}>
            {model.enabled ? '启用' : '停用'}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {model.provider} · {model.base_url} · Key {model.key_hint}
        </p>
      </div>
      <Button variant="ghost" size="icon" aria-label={`编辑模型：${model.model}`} onClick={onEdit}>
        <Edit />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`删除模型：${model.model}`} onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  );
}
