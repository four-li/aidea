// 可拖拽的应用标签：Chrome 标签页风格
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppIcon } from './AppIcon';
import { AppContextMenu } from './AppContextMenu';
import { cn } from '../lib/utils';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  app: AppManifest;
  active: boolean;
  state?: AppState;
  onClick: () => void;
  onRefreshStates: () => void;
  onShowLog: (app: AppManifest) => void;
  disabled: boolean;
}

export function SortableAppIcon({
  app,
  active,
  state,
  onClick,
  onRefreshStates,
  onShowLog,
  disabled,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: app.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const issue = app.issue ?? state?.issue;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <AppContextMenu
        app={app}
        state={state}
        onRefresh={onRefreshStates}
        onShowLog={onShowLog}
      >
        <button
          onClick={onClick}
          className={cn(
            'h-full px-3.5 flex items-center gap-2 text-tab flex-shrink-0 transition-colors',
            issue
              ? 'text-muted-foreground opacity-60 hover:bg-card/50'
              : active
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
          )}
        >
          <AppIcon app={app} state={state} />
          <span className="max-w-[120px] truncate">{app.name}</span>
        </button>
      </AppContextMenu>
    </div>
  );
}
