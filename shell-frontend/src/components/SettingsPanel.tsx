// 设置弹出窗：使用 shadcn Dialog + Button
// 布局：左侧分类菜单 + 右侧内容区，卡片分组，无分割线
import { useEffect, useState } from 'react';
import { Settings, Info, User, Palette, Bell, Shield, Code, LayoutGrid, Lock } from 'lucide-react';
import type { ThemeMode } from '../hooks/useTheme';
import type { AppManifest } from '../types/manifest';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { PluginMarketPage } from '../builtin-apps/plugin-market';
import { AppManagementPage } from './AppManagementPage';
import { ipc } from '../lib/ipc';
import type { AideaUpdate } from '../types/update';

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppsChanged: () => void;
  appOrder?: string[];
  onReorder?: (newOrder: string[]) => void;
  onShowLog: (app: AppManifest) => void;
  category?: SettingsCategory;
  checkUpdate?: number;
  theme?: Exclude<ThemeMode, 'system'>;
}

type SettingsCategory =
  | 'apps'
  | 'official-plugins'
  | 'account'
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'privacy'
  | 'advanced'
  | 'about';

interface CategoryDef {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'apps', label: '应用管理', icon: <LayoutGrid size={18} /> },
  { id: 'official-plugins', label: '应用市场', icon: <LayoutGrid size={18} /> },
  { id: 'account', label: '账号', icon: <User size={18} /> },
  { id: 'general', label: '通用', icon: <Settings size={18} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={18} /> },
  { id: 'notifications', label: '通知', icon: <Bell size={18} /> },
  { id: 'privacy', label: '隐私与安全', icon: <Shield size={18} /> },
  { id: 'advanced', label: '高级', icon: <Code size={18} /> },
  { id: 'about', label: '关于', icon: <Info size={18} /> },
];

const THEME_OPTIONS: { mode: ThemeMode; label: string; desc: string }[] = [
  { mode: 'light', label: '浅色', desc: '始终使用浅色主题' },
  { mode: 'dark', label: '深色', desc: '始终使用深色主题' },
  { mode: 'system', label: '跟随系统', desc: '跟随 macOS 系统设置' },
];

export function SettingsPanel({
  themeMode,
  onThemeChange,
  open,
  onOpenChange,
  onAppsChanged,
  appOrder,
  onReorder,
  onShowLog,
  category,
  checkUpdate,
  theme,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('apps');
  useEffect(() => {
    if (category) setActiveCategory(category);
  }, [category]);
  const activeLabel = CATEGORIES.find((c) => c.id === activeCategory)?.label ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[85vw] max-w-[1400px] h-[85vh] max-h-[900px] p-0 gap-0 overflow-hidden">
        <div className="flex h-full">
          {/* 左侧分类菜单 */}
          <div className="w-64 flex-shrink-0 bg-card flex flex-col border-r border-border">
            {/* 用户信息区 */}
            <div className="px-6 py-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary">
                  <User size={20} />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">本地用户</div>
                  <div className="text-xs text-muted-foreground">免费版</div>
                </div>
              </div>
            </div>

            {/* 分类列表 */}
            <nav className="flex-1 overflow-auto px-3 py-2 space-y-0.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-lg text-left text-sm flex items-center gap-3 transition-colors',
                    activeCategory === cat.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  {cat.icon}
                  <span>{cat.label}</span>
                </button>
              ))}
            </nav>

            {/* 左侧菜单底部留空（本地模式无登录态，不需要退出登录） */}
          </div>

          {/* 右侧内容区 */}
          <div className="flex-1 flex flex-col min-w-0">
            <DialogHeader className="px-8 py-6 border-b border-border">
              <DialogTitle className="text-xl font-semibold">{activeLabel}</DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-auto px-8 py-6">
              {activeCategory === 'apps' && (
                <AppManagementPage
                  onAppsChanged={onAppsChanged}
                  appOrder={appOrder}
                  onReorder={onReorder}
                  onShowLog={onShowLog}
                  theme={theme}
                />
              )}
              {activeCategory === 'official-plugins' && (
                <PluginMarketPage onAppsChanged={onAppsChanged} />
              )}
              {activeCategory === 'account' && <AccountSettings />}
              {activeCategory === 'general' && <GeneralSettings />}
              {activeCategory === 'appearance' && (
                <AppearanceSettings themeMode={themeMode} onThemeChange={onThemeChange} />
              )}
              {activeCategory === 'notifications' && <NotificationsSettings />}
              {activeCategory === 'privacy' && <PrivacySettings />}
              {activeCategory === 'advanced' && <AdvancedSettings />}
              {activeCategory === 'about' && <AboutSettings checkUpdate={checkUpdate} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 通用 Section 组件 ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-base font-semibold text-foreground mb-4">{title}</h3>
      <div className="bg-card rounded-lg p-6 space-y-4">{children}</div>
    </div>
  );
}

// ─── KV 键值对 ───

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground font-mono">{value}</span>
    </div>
  );
}

// ─── 开关项：使用 shadcn Switch ───

function ToggleItem({
  label,
  description,
  defaultChecked,
  disabled,
}: {
  label: string;
  description: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="flex items-center justify-between py-2">
      <div className={cn(disabled && 'opacity-60')}>
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={setChecked} disabled={disabled} />
    </div>
  );
}

// ── 「开发中」占位组件 ───
// 用于包裹整块尚未实现的功能，明确告知用户「不是 bug，是没做」
function ComingSoon({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-base font-semibold text-foreground mb-4">{title}</h3>
      <div className="bg-card rounded-lg p-6 space-y-4 opacity-60">
        {children}
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
          <Lock size={12} />
          <span>该功能开发中，暂不可用</span>
        </div>
      </div>
    </div>
  );
}

// ── 各分类内容 ───

function AccountSettings() {
  return (
    <div>
      <Section title="账户模式">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">本地模式</div>
            <div className="text-xs text-muted-foreground mt-1">数据保存在本机，无需登录账号</div>
          </div>
          <span className="text-xs text-muted-foreground px-3 py-1 rounded-md bg-muted">
            当前模式
          </span>
        </div>
      </Section>
      <ComingSoon title="云端账号">
        <p className="text-sm text-muted-foreground">
          账号登录与云端同步功能正在开发中，上线后可在多设备间同步应用配置。
        </p>
      </ComingSoon>
    </div>
  );
}

function AppearanceSettings({
  themeMode,
  onThemeChange,
}: {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}) {
  return (
    <div>
      <Section title="主题">
        <RadioGroup
          value={themeMode}
          onValueChange={(v) => onThemeChange(v as ThemeMode)}
          className="space-y-3"
        >
          {THEME_OPTIONS.map((opt) => (
            <label
              key={opt.mode}
              htmlFor={`theme-${opt.mode}`}
              className={cn(
                'flex items-center gap-4 cursor-pointer p-4 rounded-lg transition-colors',
                themeMode === opt.mode ? 'bg-primary/10 ring-2 ring-primary/30' : 'hover:bg-muted',
              )}
            >
              <RadioGroupItem value={opt.mode} id={`theme-${opt.mode}`} />
              <div>
                <div className="text-sm font-medium text-foreground">{opt.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
      </Section>
    </div>
  );
}

function GeneralSettings() {
  return (
    <div>
      <Section title="启动行为">
        <ToggleItem
          label="启动时自动检查更新"
          description="应用启动时自动检查是否有新版本"
          defaultChecked={true}
          disabled
        />
      </Section>
      <Section title="语言">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-foreground">界面语言</div>
            <div className="text-xs text-muted-foreground mt-1">更改后需要重启应用</div>
          </div>
          <Select defaultValue="zh-CN" disabled>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">简体中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground mt-2">更多语言开发中</p>
      </Section>
    </div>
  );
}

function NotificationsSettings() {
  return (
    <div>
      <Section title="通知偏好">
        <ToggleItem
          label="启用桌面通知"
          description="允许应用发送桌面通知"
          defaultChecked={true}
          disabled
        />
        <ToggleItem
          label="声音提醒"
          description="收到通知时播放提示音"
          defaultChecked={false}
          disabled
        />
      </Section>
    </div>
  );
}

function PrivacySettings() {
  return <p className="text-sm text-foreground">开搞本地应用不收集任何用户数据。</p>;
}

function AdvancedSettings() {
  return (
    <div>
      <Section title="开发者选项">
        <ToggleItem
          label="启用调试模式"
          description="显示额外的调试信息"
          defaultChecked={false}
          disabled
        />
      </Section>
      <Section title="数据管理">
        <div className="flex items-center justify-between">
          <div className="opacity-60">
            <div className="text-sm text-foreground">清除缓存</div>
            <div className="text-xs text-muted-foreground mt-1">删除临时文件和缓存数据</div>
          </div>
          <Button variant="destructive" size="sm" disabled>
            清除
          </Button>
        </div>
      </Section>
    </div>
  );
}

function AboutSettings({ checkUpdate }: { checkUpdate?: number }) {
  const [version, setVersion] = useState('读取中...');
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'
  >('idle');
  const [update, setUpdate] = useState<AideaUpdate | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void ipc
      .getAideaVersion()
      .then(setVersion)
      .catch(() => setVersion('未知'));
  }, []);

  const checkForUpdate = async () => {
    setStatus('checking');
    setError('');
    try {
      const result = await ipc.checkAideaUpdate();
      setUpdate(result);
      setStatus(result ? 'available' : 'up-to-date');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  useEffect(() => {
    if (checkUpdate) void checkForUpdate();
  }, [checkUpdate]);

  const installUpdate = async () => {
    setStatus('installing');
    try {
      await ipc.installAideaUpdate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  };

  return (
    <div>
      <Section title="版本信息">
        <KV label="应用名称" value="开搞" />
        <KV label="当前版本" value={version} />
        <div className="flex items-center gap-3 pt-2">
          <Button
            size="sm"
            onClick={() => void checkForUpdate()}
            disabled={status === 'checking' || status === 'installing'}
          >
            {status === 'checking' ? '检查中...' : '检查更新'}
          </Button>
          {status === 'up-to-date' && (
            <span className="text-sm text-muted-foreground">已是最新版本</span>
          )}
          {status === 'error' && <span className="text-sm text-destructive">{error}</span>}
        </div>
        {update && (
          <div className="pt-2 space-y-2 text-sm">
            <div className="text-foreground">发现新版本 {update.version}</div>
            {update.body && (
              <p className="text-muted-foreground whitespace-pre-wrap">{update.body}</p>
            )}
            <Button
              size="sm"
              onClick={() => void installUpdate()}
              disabled={status === 'installing'}
            >
              {status === 'installing' ? '下载并验证中...' : '更新并重启'}
            </Button>
          </div>
        )}
      </Section>
      <Section title="数据目录">
        <KV label="配置文件" value="aIdea/apps/*.yaml" />
        <KV label="全局设置" value="aIdea/shell.config.json" />
        <KV label="运行时" value="aIdea/.runtime/" />
      </Section>
    </div>
  );
}
