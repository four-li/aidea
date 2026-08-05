// 顶部横排导航栏：Chrome 风格标签页
// macOS 圆点（左侧）+ 子应用标签（中间，可拖拽）+ 设置图标（右侧固定）
import { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './ui/tooltip';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableAppIcon } from './SortableAppIcon';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  apps: AppManifest[];
  appOrder: string[];
  onReorder: (newOrder: string[]) => void;
  activeAppId: string | null;
  states: Record<string, AppState>;
  onSelectApp: (id: string) => void;
  onRefreshStates: () => void;
  onShowLog: (app: AppManifest) => void;
  onOpenSettings: () => void;
}

export function TopBar({
  apps,
  appOrder,
  onReorder,
  activeAppId,
  states,
  onSelectApp,
  onRefreshStates,
  onShowLog,
  onOpenSettings,
}: Props) {
  const [dragging, setDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedApps = appOrder
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is AppManifest => a !== undefined);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = appOrder.indexOf(active.id as string);
      const newIndex = appOrder.indexOf(over.id as string);
      onReorder(arrayMove(appOrder, oldIndex, newIndex));
    }
    setDragging(false);
  };

  return (
    <div
      className="h-topbar bg-background flex items-center overflow-hidden"
      data-tauri-drag-region
    >
      {/* macOS 拖拽区（红绿圆点浮在这里） */}
      <div className="w-20 h-full flex-shrink-0" data-tauri-drag-region />

      {/* 子应用标签（可拖拽） */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 px-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={appOrder} strategy={horizontalListSortingStrategy}>
            {sortedApps.map((app) => (
              <SortableAppIcon
                key={app.id}
                app={app}
                active={app.id === activeAppId}
                state={states[app.id]}
                onClick={() => onSelectApp(app.id)}
                onRefreshStates={onRefreshStates}
                onShowLog={onShowLog}
                disabled={dragging}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* 设置图标（固定在右侧）：用 shadcn Button + Tooltip */}
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              className="h-full w-auto px-3 text-muted-foreground hover:text-foreground hover:bg-card/50 flex-shrink-0"
              aria-label="设置"
            >
              <Settings size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">设置</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
