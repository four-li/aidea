// 时间戳转换 tab
// 双向实时：两边独立 state + 各自派生展示，不互相回填（避免循环更新）
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../../../../components/ui/input';
import { Button } from '../../../../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import { copyToClipboard } from '../../../../lib/clipboard';
import { parseTimestamp, parseDate } from '../data-formatter/format-utils';

const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const supportedTimeZones = Intl.supportedValuesOf('timeZone');
const timeZones = supportedTimeZones.includes(systemTimeZone)
  ? supportedTimeZones
  : [systemTimeZone, ...supportedTimeZones];

interface TimestampConverterProps {
  tsInput: string;
  dateInput: string;
  onTsChange: (value: string) => void;
  onDateChange: (value: string) => void;
}

export function TimestampConverter({
  tsInput,
  dateInput,
  onTsChange,
  onDateChange,
}: TimestampConverterProps) {
  const [timeZone, setTimeZone] = useState(systemTimeZone);
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);
  const [timeZoneQuery, setTimeZoneQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const tsResult = parseTimestamp(tsInput, timeZone);
  const dateResult = parseDate(dateInput, timeZone);
  const nowResult = parseTimestamp(String(now), timeZone);
  const filteredTimeZones = timeZones.filter((zone) =>
    zone.toLowerCase().includes(timeZoneQuery.trim().toLowerCase())
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await copyToClipboard(text);
      toast.success('已复制');
    } catch {
      toast.error(`复制${label}失败`);
    }
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <Popover open={timeZoneOpen} onOpenChange={setTimeZoneOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="选择时区" className="font-mono text-xs">
              选择时区：{timeZone}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <Input
              value={timeZoneQuery}
              onChange={(event) => setTimeZoneQuery(event.target.value)}
              placeholder="搜索时区"
              className="font-mono text-sm"
              autoFocus
            />
            <div className="mt-2 max-h-64 overflow-y-auto">
              {filteredTimeZones.map((zone) => (
                <button
                  key={zone}
                  type="button"
                  className="flex w-full px-2 py-1.5 text-left font-mono text-xs hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => {
                    setTimeZone(zone);
                    setTimeZoneQuery('');
                    setTimeZoneOpen(false);
                  }}
                >
                  {zone}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {nowResult.ok && (
          <div className="font-mono text-xs text-muted-foreground">
            当前 {nowResult.local} · {Math.floor(now / 1000)} · {now}
          </div>
        )}
      </div>

      <div className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
        {/* 左栏：时间戳 → 日期 */}
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-base font-semibold">时间戳转日期</h2>
            <p className="mt-1 text-xs text-muted-foreground">输入秒或毫秒时间戳</p>
          </div>
          <label className="text-xs text-muted-foreground">时间戳</label>
          <Input
            value={tsInput}
            onChange={(e) => onTsChange(e.target.value)}
            placeholder="输入时间戳"
            className="h-11 border-primary/50 font-mono text-base"
            inputMode="numeric"
          />
          {/* 单位提示 / 错误提示 */}
          {tsResult.ok ? (
            <span className="text-xs text-muted-foreground">
              按{tsResult.unit === 'ms' ? '毫秒' : '秒'}解析
            </span>
          ) : (
            <span className="text-xs text-destructive">{tsResult.error}</span>
          )}

          {/* 派生结果 */}
          {tsResult.ok && (
            <div className="flex flex-col gap-2 mt-2 p-3 rounded-md bg-muted/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">所选时区</div>
                  <div className="font-mono text-sm">{tsResult.local}</div>
                </div>
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(tsResult.local, '本地日期')}
                      >
                        <Copy size={14} />
                        复制本地
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>复制本地日期</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">UTC</div>
                  <div className="font-mono text-sm">{tsResult.utc}</div>
                </div>
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(tsResult.utc, 'UTC 日期')}
                      >
                        <Copy size={14} />
                        复制UTC
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>复制 UTC 日期</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：日期 → 时间戳 */}
        <div className="flex flex-col gap-2 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <div>
            <h2 className="text-sm font-medium">日期转时间戳</h2>
            <p className="mt-1 text-xs text-muted-foreground">按所选时区解析</p>
          </div>
          <label className="text-xs text-muted-foreground">
            日期字符串（格式：YYYY-MM-DD HH:mm:ss）
          </label>
          <Input
            value={dateInput}
            onChange={(e) => onDateChange(e.target.value)}
            placeholder="YYYY-MM-DD HH:mm:ss"
            className="font-mono text-sm"
          />

          {dateResult.ok ? null : (
            <span className="text-xs text-destructive">{dateResult.error}</span>
          )}

          {/* 派生结果 */}
          {dateResult.ok && (
            <div className="flex flex-col gap-2 mt-2 p-3 rounded-md bg-muted/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">秒</div>
                  <div className="font-mono text-sm">{dateResult.seconds}</div>
                </div>
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(String(dateResult.seconds), '秒时间戳')}
                      >
                        <Copy size={14} />
                        复制秒
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>复制秒时间戳</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">毫秒</div>
                  <div className="font-mono text-sm">{dateResult.milliseconds}</div>
                </div>
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copy(String(dateResult.milliseconds), '毫秒时间戳')}
                      >
                        <Copy size={14} />
                        复制毫秒
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>复制毫秒时间戳</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
