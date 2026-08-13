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
import { ArrowLeft, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { ipc } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import {
  DEV_TOOLS_SETTINGS_CHANGED,
  DEV_TOOLS_TABS,
  normalizeDevToolsTabOrder,
  type DevToolsTabId,
} from './tabs';

interface Props {
  onClose: () => void;
  onSaved?: (hiddenTabs: string[]) => void;
  embedded?: boolean;
}

export function DevToolsSettingsPage({ onClose, onSaved, embedded = false }: Props) {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const [tabOrder, setTabOrder] = useState<DevToolsTabId[]>(
    normalizeDevToolsTabOrder([]).map((tab) => tab.id),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let disposed = false;
    void ipc
      .getDevToolsSettings()
      .then((settings) => {
        if (!disposed) {
          setHiddenTabs(settings.hidden_tabs);
          setTabOrder(normalizeDevToolsTabOrder(settings.tab_order ?? []).map((tab) => tab.id));
        }
      })
      .catch((error) => toast.error('读取 DevTools 设置失败', { description: String(error) }));
    return () => {
      disposed = true;
    };
  }, []);

  const saveSettings = async (nextHiddenTabs: string[], nextTabOrder: DevToolsTabId[]) => {
    await ipc.saveDevToolsSettings({ hidden_tabs: nextHiddenTabs, tab_order: nextTabOrder });
    window.dispatchEvent(new Event(DEV_TOOLS_SETTINGS_CHANGED));
    onSaved?.(nextHiddenTabs);
  };

  const updateVisibility = async (id: string, visible: boolean) => {
    const visibleCount = DEV_TOOLS_TABS.filter((tab) => !hiddenTabs.includes(tab.id)).length;
    if (!visible && visibleCount === 1) {
      toast.error('DevTools 至少保留一个工具');
      return;
    }
    const previousHiddenTabs = hiddenTabs;
    const next = new Set(hiddenTabs);
    if (visible) next.delete(id);
    else next.add(id);
    const nextHiddenTabs = [...next].sort();
    setHiddenTabs(nextHiddenTabs);
    try {
      await saveSettings(nextHiddenTabs, tabOrder);
    } catch (error) {
      setHiddenTabs(previousHiddenTabs);
      toast.error('保存 DevTools 设置失败', { description: String(error) });
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = tabOrder.indexOf(String(active.id) as DevToolsTabId);
    const newIndex = tabOrder.indexOf(String(over.id) as DevToolsTabId);
    if (oldIndex < 0 || newIndex < 0) return;
    const previousOrder = tabOrder;
    const nextOrder = arrayMove(tabOrder, oldIndex, newIndex);
    setTabOrder(nextOrder);
    try {
      await saveSettings(hiddenTabs, nextOrder);
    } catch (error) {
      setTabOrder(previousOrder);
      toast.error('保存 DevTools 设置失败', { description: String(error) });
    }
  };

  const tabs = tabOrder
    .map((id) => DEV_TOOLS_TABS.find((tab) => tab.id === id))
    .filter((tab): tab is (typeof DEV_TOOLS_TABS)[number] => tab !== undefined);

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      {!embedded && (
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="返回 DevTools" onClick={onClose}>
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h2 className="text-base font-semibold">DevTools 设置</h2>
            <p className="mt-1 text-sm text-muted-foreground">显示需要的工具</p>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
        <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {tabs.map((tab) => (
              <SortableDevToolsCard
                key={tab.id}
                id={tab.id}
                label={tab.label}
                visible={!hiddenTabs.includes(tab.id)}
                onVisibleChange={(visible) => void updateVisibility(tab.id, visible)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableDevToolsCardProps {
  id: DevToolsTabId;
  label: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}

function SortableDevToolsCard({ id, label, visible, onVisibleChange }: SortableDevToolsCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      data-testid="dev-tools-card"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-3 rounded-md border border-border bg-card p-4"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`拖动调整工具顺序：${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <span className="flex-1 text-sm font-medium">
        {label}
      </span>
      <Switch
        id={`dev-tools-tab-${id}`}
        aria-label={label}
        checked={visible}
        onCheckedChange={onVisibleChange}
      />
    </div>
  );
}
