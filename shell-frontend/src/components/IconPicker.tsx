// 图标选择器：lucide 图标网格 + 搜索
// 弹层用 shadcn Popover，自动处理定位 / 点击外部 / ESC / 堆叠层级 / 焦点管理
import { useState, useMemo } from 'react';
import {
  LayoutDashboard, Wrench, Settings, Info, User, Folder, Plus, Trash2,
  Pencil, Search, Palette, Bell, Shield, Code, LogOut,
  FileText, Terminal, Database, Globe, Cpu, HardDrive, Network,
  Cloud, Server, Activity, Zap, Star, Heart, Bookmark, Flag,
  Tag, Filter, SortAsc, SortDesc, Grid, List, Columns, Rows,
  Calendar, Clock, Timer, History, Download, Upload, Share,
  Copy, Clipboard, Scissors, Link, Mail, MessageSquare, Phone,
  Camera, Image, Video, Music, Mic, Headphones, Volume,
  Sun, Moon, Monitor, Laptop, Smartphone, Tablet, Keyboard,
  Mouse, Printer, Wifi, Bluetooth, Battery, Power, Plug,
  Lock, Unlock, Key, Fingerprint, Eye, EyeOff, Check, ChevronDown,
  ChevronRight, ChevronLeft, ChevronUp, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  MoreHorizontal, MoreVertical, PlusCircle, MinusCircle, XCircle, CheckCircle,
  AlertCircle, HelpCircle, AlertTriangle, Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// 常用图标列表，按使用频率排序
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Wrench, Settings, Info, User, Folder, Plus, Trash2,
  Pencil, Search, Palette, Bell, Shield, Code, LogOut,
  FileText, Terminal, Database, Globe, Cpu, HardDrive, Network,
  Cloud, Server, Activity, Zap, Star, Heart, Bookmark, Flag,
  Tag, Filter, SortAsc, SortDesc, Grid, List, Columns, Rows,
  Calendar, Clock, Timer, History, Download, Upload, Share,
  Copy, Clipboard, Scissors, Link, Mail, MessageSquare, Phone,
  Camera, Image, Video, Music, Mic, Headphones, Volume,
  Sun, Moon, Monitor, Laptop, Smartphone, Tablet, Keyboard,
  Mouse, Printer, Wifi, Bluetooth, Battery, Power, Plug,
  Lock, Unlock, Key, Fingerprint, Eye, EyeOff, Check, ChevronDown,
  ChevronRight, ChevronLeft, ChevronUp, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  MoreHorizontal, MoreVertical, PlusCircle, MinusCircle, XCircle, CheckCircle,
  AlertCircle, HelpCircle, AlertTriangle, Lightbulb,
};

interface Props {
  value: string;
  onChange: (iconName: string) => void;
}

export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filteredIcons = useMemo(() => {
    const entries = Object.entries(ICONS);
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(([name]) => name.toLowerCase().includes(q));
  }, [query]);

  const isFilePath = value.includes('/') || value.includes('.');
  const CurrentIcon = value && !isFilePath ? ICONS[value] : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* 触发按钮：用 shadcn Button outline 变体，保持表单控件一致性 */}
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-4 w-4 items-center justify-center flex-shrink-0">
              {CurrentIcon ? (
                <CurrentIcon size={16} className="text-foreground" />
              ) : isFilePath && value ? (
                <img src={value} alt="" className="h-4 w-4" />
              ) : (
                <span className="text-[10px] text-muted-foreground">无</span>
              )}
            </span>
            <span className="truncate text-foreground">
              {value || '点击选择图标'}
            </span>
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        {/* 搜索框 */}
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索图标..."
              autoFocus
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* 图标网格 */}
        <div className="max-h-64 overflow-y-auto p-2">
          {filteredIcons.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              未找到匹配图标
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {filteredIcons.map(([name, IconComp]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md transition-colors',
                    value === name
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <IconComp size={16} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部清除 */}
        <div className="border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            清除图标
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { ICONS };
