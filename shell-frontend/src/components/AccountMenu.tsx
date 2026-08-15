import { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleArrowUp,
  CircleHelp,
  MonitorCog,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import { ipc } from '../lib/ipc';
import type { ThemeMode } from '../hooks/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import aideaLogo from '../../../shell-native/icons/icon.png';

interface Props {
  onOpenSettings: () => void;
  onOpenDeveloperGuide?: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  updateAvailable?: boolean;
  onOpenUpdate?: () => void;
}

const ISSUE_URL = 'https://gitee.com/aidea-org/aidea-app/issues/new';

const themeLabels: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

export function AccountMenu({
  onOpenSettings,
  onOpenDeveloperGuide = () => undefined,
  themeMode,
  onThemeChange,
  updateAvailable = false,
  onOpenUpdate = () => undefined,
}: Props) {
  const [username, setUsername] = useState('本地用户');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void ipc
      .getOsUsername()
      .then((value) => {
        if (!disposed && value.trim()) setUsername(value);
      })
      .catch(() => undefined);
    void ipc
      .getOsUserAvatar()
      .then((value) => {
        if (!disposed) setAvatarUrl(value);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div className="flex h-full shrink-0 items-center gap-1 pr-1">
      {updateAvailable ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-md text-emerald-500 hover:bg-muted hover:text-emerald-400 focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="有新版本可更新"
              onClick={onOpenUpdate}
            >
              <CircleArrowUp size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>有新版本可更新</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 max-w-52 min-w-0 select-none justify-start rounded-md px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label={`${username}账户菜单`}
          >
            <Avatar className="h-6 w-6">
              <AvatarImage src={avatarUrl ?? undefined} alt={`${username} 的 macOS 头像`} />
              <AvatarFallback>
                <img src={aideaLogo} alt="aIdea 标识" className="h-full w-full object-cover" />
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-left">{username}</span>
            <ChevronDown className="shrink-0" size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="mb-1 w-56 p-1.5">
          <DropdownMenuItem className="gap-3 rounded-md px-3 py-2" onSelect={onOpenSettings}>
            <Settings className="h-4 w-4 shrink-0" />
            设置
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-3 rounded-md px-3 py-2">
              <Sun className="h-4 w-4 shrink-0" />
              主题
              <span className="ml-auto text-muted-foreground">{themeLabels[themeMode]}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <DropdownMenuItem key={mode} onSelect={() => onThemeChange(mode)}>
                  {mode === 'light' && <Sun className="h-4 w-4" />}
                  {mode === 'dark' && <Moon className="h-4 w-4" />}
                  {mode === 'system' && <MonitorCog className="h-4 w-4" />}
                  {themeLabels[mode]}
                  {themeMode === mode && <Check className="ml-auto h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-3 rounded-md px-3 py-2">
              <CircleHelp className="h-4 w-4 shrink-0" />
              帮助
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuItem onSelect={onOpenDeveloperGuide}>
                <BookOpen className="h-4 w-4" />
                开发手册
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void ipc.openExternalUrl(ISSUE_URL).catch(() => undefined);
                }}
              >
                <CircleHelp className="h-4 w-4" />
                报告问题
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
