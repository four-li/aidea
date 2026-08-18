import { AppIcon } from './AppIcon';
import { BuiltinPage } from './BuiltinPage';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import type { AppManifest } from '../types/manifest';

interface Props {
  apps: AppManifest[];
  activeAppId: string | null;
  onSelectApp: (id: string) => void;
}

export function BuiltinHubPage({ apps, activeAppId, onSelectApp }: Props) {
  const builtinApps = apps.filter(
    (app) => app.ui.mode === 'builtin' && app.ui.entry !== 'account-menu',
  );
  const activeApp = builtinApps.find((app) => app.id === activeAppId) ?? builtinApps[0];

  if (!activeApp) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">暂无内置应用</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 bg-background">
        <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {builtinApps.map((app) => {
            const selected = app.id === activeApp.id;
            return (
              <Tooltip key={app.id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={app.name}
                    aria-current={selected ? 'page' : undefined}
                    className={`relative h-10 w-10 rounded-md ${
                      selected
                        ? 'bg-muted text-foreground before:absolute before:-left-2 before:h-5 before:w-0.5 before:bg-primary'
                        : 'text-muted-foreground'
                    }`}
                    onClick={() => onSelectApp(app.id)}
                  >
                    <AppIcon app={app} showProcessStatus={false} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{app.name}</TooltipContent>
              </Tooltip>
            );
          })}
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <BuiltinPage app={activeApp} />
        </main>
      </div>
    </TooltipProvider>
  );
}
