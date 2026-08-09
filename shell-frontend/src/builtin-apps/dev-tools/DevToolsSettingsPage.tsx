import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { ipc } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { DEV_TOOLS_TABS } from './tabs';

interface Props {
  onClose: () => void;
  onSaved?: (hiddenTabs: string[]) => void;
  embedded?: boolean;
}

export function DevToolsSettingsPage({ onClose, onSaved, embedded = false }: Props) {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);

  useEffect(() => {
    let disposed = false;
    void ipc
      .getDevToolsSettings()
      .then((settings) => {
        if (!disposed) setHiddenTabs(settings.hidden_tabs);
      })
      .catch((error) => toast.error('读取 DevTools 设置失败', { description: String(error) }));
    return () => {
      disposed = true;
    };
  }, []);

  const updateVisibility = async (id: string, visible: boolean) => {
    const visibleCount = DEV_TOOLS_TABS.filter((tab) => !hiddenTabs.includes(tab.id)).length;
    if (!visible && visibleCount === 1) {
      toast.error('DevTools 至少保留一个工具');
      return;
    }
    const next = new Set(hiddenTabs);
    if (visible) next.delete(id);
    else next.add(id);
    const nextHiddenTabs = [...next].sort();
    setHiddenTabs(nextHiddenTabs);
    try {
      await ipc.saveDevToolsSettings({ hidden_tabs: nextHiddenTabs });
      onSaved?.(nextHiddenTabs);
    } catch (error) {
      setHiddenTabs(hiddenTabs);
      toast.error('保存 DevTools 设置失败', { description: String(error) });
    }
  };

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

      <div className="divide-y divide-border border-y border-border">
        {DEV_TOOLS_TABS.map((tab) => {
          const visible = !hiddenTabs.includes(tab.id);
          return (
            <div key={tab.id} className="flex items-center justify-between gap-4 py-3">
              <Label htmlFor={`dev-tools-tab-${tab.id}`} className="text-sm font-medium">
                {tab.label}
              </Label>
              <Checkbox
                id={`dev-tools-tab-${tab.id}`}
                aria-label={tab.label}
                checked={visible}
                onCheckedChange={(checked) => void updateVisibility(tab.id, checked === true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
