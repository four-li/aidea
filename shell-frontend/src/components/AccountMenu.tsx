import { useEffect, useState } from 'react';
import { BookOpen, Settings, UserRound } from 'lucide-react';
import { ipc } from '../lib/ipc';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';

interface Props {
  onOpenSettings: () => void;
  onOpenDeveloperGuide?: () => void;
}

export function AccountMenu({ onOpenSettings, onOpenDeveloperGuide = () => undefined }: Props) {
  const [username, setUsername] = useState('账户');

  useEffect(() => {
    let disposed = false;
    void ipc
      .getOsUsername()
      .then((value) => {
        if (!disposed) setUsername(value);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-full w-auto flex-shrink-0 justify-start rounded-none px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`${username}账户菜单`}
        >
          <UserRound size={17} />
          <span className="truncate">{username}</span>
          <Settings className="ml-auto" size={17} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="mb-1 min-w-52">
        <DropdownMenuLabel>{username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings className="mr-2" size={16} />
          设置
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenDeveloperGuide}>
          <BookOpen className="mr-2" size={16} />
          开发手册
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <span className="mr-2 text-base leading-none">?</span>
          报告问题
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
