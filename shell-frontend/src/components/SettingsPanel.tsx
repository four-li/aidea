// 设置弹出窗：使用 shadcn Dialog + Button + Input + Label
// 布局：左侧分类菜单 + 右侧内容区，卡片分组，无分割线
import { useState } from 'react';
import {
  Settings,
  Info,
  User,
  Palette,
  Bell,
  Shield,
  Code,
  LayoutGrid,
  Lock,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ThemeMode } from '../hooks/useTheme';
import type { AppManifest, AppOverride } from '../types/manifest';
import { ipc } from '../lib/ipc';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { IconPicker } from './IconPicker';

interface Props {
  apps: AppManifest[];
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppsChanged: () => void;
}

type SettingsCategory =
  | 'apps'
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
  apps,
  themeMode,
  onThemeChange,
  open,
  onOpenChange,
  onAppsChanged,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('apps');
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
                <AppsManagement apps={apps} onAppsChanged={onAppsChanged} />
              )}
              {activeCategory === 'account' && <AccountSettings />}
              {activeCategory === 'general' && <GeneralSettings />}
              {activeCategory === 'appearance' && (
                <AppearanceSettings themeMode={themeMode} onThemeChange={onThemeChange} />
              )}
              {activeCategory === 'notifications' && <NotificationsSettings />}
              {activeCategory === 'privacy' && <PrivacySettings />}
              {activeCategory === 'advanced' && <AdvancedSettings />}
              {activeCategory === 'about' && <AboutSettings />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 应用管理 ───

function AppsManagement({
  apps,
  onAppsChanged,
}: {
  apps: AppManifest[];
  onAppsChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(apps[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [newApp, setNewApp] = useState({
    id: 'atlas',
    name: 'Atlas',
    path: '/Users/me/atlas',
    url: 'http://127.0.0.1:51130',
    start: 'python3 /Users/me/atlas/bin/atlas web',
    icon: '',
  });
  const [editing, setEditing] = useState<AppOverride>(() => {
    const first = apps[0];
    if (!first) return {};
    return {
      name: first.name,
      icon: first.ui.icon ?? '',
      url: first.ui.url ?? '',
      start: first.process?.start ?? '',
    };
  });
  const [saving, setSaving] = useState(false);

  const selectedApp = apps.find((a) => a.id === selectedId) ?? null;

  const handleAdd = async () => {
    setSaving(true);
    try {
      await ipc.saveAppManifest({
        id: newApp.id.trim(),
        name: newApp.name.trim(),
        version: '0.1.0',
        category: 'dev-workflow',
        path: newApp.path.trim(),
        status: 'active',
        ui: { mode: 'webview', url: newApp.url.trim(), icon: newApp.icon.trim() || undefined },
        process: {
          start: newApp.start.trim(),
          stop: 'SIGTERM',
          autostart: false,
          working_dir: newApp.path.trim(),
          log_file: `${newApp.path.trim()}/logs/${newApp.id.trim()}.log`,
        },
      });
      toast.success('应用已添加', { description: '重启 aIdea 后生效' });
      setAdding(false);
      onAppsChanged();
    } catch (e) {
      toast.error('添加失败', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const selectApp = (app: AppManifest) => {
    setSelectedId(app.id);
    setEditing({
      name: app.name,
      icon: app.ui.icon ?? '',
      url: app.ui.url ?? '',
      start: app.process?.start ?? '',
    });
  };

  const handleSave = async () => {
    if (!selectedApp) return;
    setSaving(true);
    try {
      const ovr: AppOverride = {};
      if (editing.name && editing.name !== selectedApp.name) ovr.name = editing.name;
      if (editing.icon && editing.icon !== (selectedApp.ui.icon ?? '')) ovr.icon = editing.icon;
      if (editing.url && editing.url !== (selectedApp.ui.url ?? '')) ovr.url = editing.url;
      if (editing.start && editing.start !== (selectedApp.process?.start ?? ''))
        ovr.start = editing.start;
      await ipc.saveAppOverride(selectedApp.id, ovr);
      toast.success('已保存', { description: '重启 aIdea 后生效' });
      onAppsChanged();
    } catch (e) {
      toast.error('保存失败', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedApp) return;
    setSaving(true);
    try {
      await ipc.resetAppOverride(selectedApp.id);
      toast.success('已恢复默认');
      onAppsChanged();
    } catch (e) {
      toast.error('恢复失败', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-8 h-full">
      {/* 左侧应用列表 */}
      <div className="w-56 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">已安装应用</h3>
          <Button size="icon" variant="ghost" onClick={() => setAdding(true)} title="添加本地应用">
            <Plus size={16} />
          </Button>
        </div>
        <div className="space-y-0.5">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => selectApp(app)}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg text-left text-sm flex items-center gap-3 transition-colors',
                selectedId === app.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              <span className="w-4 h-4 flex items-center justify-center text-xs font-medium">
                {app.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{app.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧编辑表单 */}
      <div className="flex-1 min-w-0">
        {adding ? (
          <>
            <h3 className="text-sm font-semibold text-foreground mb-4">添加本地应用</h3>
            <div className="bg-card rounded-lg p-6 space-y-5">
              <div>
                <Label htmlFor="new-app-id">应用 ID</Label>
                <Input
                  id="new-app-id"
                  value={newApp.id}
                  onChange={(e) => setNewApp({ ...newApp, id: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-app-name">显示名称</Label>
                <Input
                  id="new-app-name"
                  value={newApp.name}
                  onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-app-path">项目目录</Label>
                <Input
                  id="new-app-path"
                  value={newApp.path}
                  onChange={(e) => setNewApp({ ...newApp, path: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-app-url">Web 地址</Label>
                <Input
                  id="new-app-url"
                  value={newApp.url}
                  onChange={(e) => setNewApp({ ...newApp, url: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-app-start">启动命令</Label>
                <Input
                  id="new-app-start"
                  value={newApp.start}
                  onChange={(e) => setNewApp({ ...newApp, start: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-app-icon">图标路径（可选）</Label>
                <Input
                  id="new-app-icon"
                  value={newApp.icon}
                  onChange={(e) => setNewApp({ ...newApp, icon: e.target.value })}
                  className="mt-1.5"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-6">
              <Button onClick={handleAdd} disabled={saving}>
                {saving ? '保存中...' : '添加'}
              </Button>
              <Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>
                取消
              </Button>
            </div>
          </>
        ) : selectedApp ? (
          <>
            <h3 className="text-sm font-semibold text-foreground mb-4">编辑 {selectedApp.name}</h3>
            <div className="bg-card rounded-lg p-6 space-y-5">
              <div>
                <Label htmlFor="app-name">显示名称</Label>
                <Input
                  id="app-name"
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder={selectedApp.name}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="app-icon">图标</Label>
                <div className="mt-1.5">
                  <IconPicker
                    value={editing.icon ?? ''}
                    onChange={(v) => setEditing({ ...editing, icon: v })}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  留空用首字母占位；也可填写图片路径（含 / 或 .）
                </p>
              </div>
              <div>
                <Label htmlFor="app-url">URL</Label>
                <Input
                  id="app-url"
                  value={editing.url ?? ''}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  placeholder={selectedApp.ui.url ?? '仅 webview 模式'}
                  className="mt-1.5"
                />
                <p className="text-xs text-muted-foreground mt-1.5">webview 模式子应用的访问地址</p>
              </div>
              <div>
                <Label htmlFor="app-start">启动命令</Label>
                <Input
                  id="app-start"
                  value={editing.start ?? ''}
                  onChange={(e) => setEditing({ ...editing, start: e.target.value })}
                  placeholder={selectedApp.process?.start ?? '无进程'}
                  className="mt-1.5"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  process.start 命令，仅对有进程的子应用生效
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={saving}>
                恢复默认
              </Button>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">选择左侧应用开始编辑</div>
        )}
      </div>
    </div>
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
  return (
    <div>
      <Section title="数据收集">
        <ToggleItem
          label="发送使用统计"
          description="帮助我们改进产品（匿名数据）"
          defaultChecked={false}
          disabled
        />
        <ToggleItem
          label="崩溃报告"
          description="自动发送崩溃日志以帮助修复问题"
          defaultChecked={true}
          disabled
        />
      </Section>
    </div>
  );
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

function AboutSettings() {
  return (
    <div>
      <Section title="版本信息">
        <KV label="应用名称" value="aIdea" />
        <KV label="版本" value="0.1.0" />
        <KV label="构建时间" value="2026-07-30" />
      </Section>
      <Section title="数据目录">
        <KV label="配置文件" value="aIdea/apps/*.yaml" />
        <KV label="全局设置" value="aIdea/shell.config.json" />
        <KV label="运行时" value="aIdea/.runtime/" />
      </Section>
    </div>
  );
}
