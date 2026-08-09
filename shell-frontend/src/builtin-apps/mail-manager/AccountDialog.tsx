import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ipc } from '@/lib/ipc';
import type { MailAccount, SaveMailAccountRequest } from '@/types/mail';

interface Props {
  open: boolean;
  account?: MailAccount | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const emptyForm: SaveMailAccountRequest = {
  display_name: '',
  email: '',
  provider: 'tencent-exmail',
  imap_host: 'imap.exmail.qq.com',
  imap_port: 993,
  tls_mode: 'tls',
  username: '',
  auth_kind: 'app-password',
  secret: '',
  webmail_url: 'https://exmail.qq.com',
  inbox_folder: 'INBOX',
  trash_folder: null,
  spam_folder: null,
  deleted_folder: null,
};

export function AccountDialog({ open, account, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof SaveMailAccountRequest>(key: K, value: SaveMailAccountRequest[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    if (!account) {
      setForm(emptyForm);
      setShowSecret(false);
      setShowAdvanced(false);
      return;
    }
    setForm({ ...account, secret: '' });
    setShowSecret(false);
    setShowAdvanced(Boolean(account.spam_folder || account.deleted_folder || account.trash_folder));
  }, [account, open]);
  const toggleSecret = async () => {
    if (showSecret) {
      setShowSecret(false);
      return;
    }
    if (!account) {
      setShowSecret(true);
      return;
    }
    setLoadingSecret(true);
    try {
      const secret = await ipc.loadMailAccountSecret(account.id);
      set('secret', secret);
      setShowSecret(true);
    } catch (error) {
      toast.error('读取已保存密码失败', { description: String(error) });
    } finally {
      setLoadingSecret(false);
    }
  };
  const usePreset = (provider: string) => {
    if (provider === 'tencent-exmail') {
      setForm({ ...emptyForm, provider, display_name: '腾讯企业邮箱' });
      return;
    }
    if (provider === 'aliyun-mail') {
      setForm({
        ...emptyForm,
        provider,
        display_name: '阿里云邮箱',
        imap_host: 'imap.aliyun.com',
        webmail_url: 'https://mail.aliyun.com',
        auth_kind: 'password',
      });
      return;
    }
    setForm({
      ...emptyForm,
      provider: 'manual',
      display_name: '手工配置',
      imap_host: '',
      webmail_url: '',
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      await ipc.saveMailAccount(form);
      toast.success('邮箱账户已保存');
      setForm(emptyForm);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error('保存失败', { description: String(error) });
    } finally {
      setSaving(false);
    }
  };
  const testConnection = async () => {
    setTesting(true);
    try {
      await ipc.testMailAccountConnection(form);
      toast.success('IMAP 连接成功');
    } catch (error) {
      toast.error('连接测试失败', { description: String(error) });
    } finally {
      setTesting(false);
    }
  };
  const fieldsComplete = Boolean(form.display_name && form.email && form.imap_host);
  const saveDisabled =
    saving || testing || loadingSecret || !fieldsComplete || (!account && !form.secret);
  const testDisabled = saving || testing || loadingSecret || !fieldsComplete || !form.secret;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? '编辑邮箱账户' : '添加邮箱账户'}</DialogTitle>
          <DialogDescription>
            {loadingSecret
              ? '正在读取已保存的密码或授权码…'
              : account
                ? '留空密码或授权码可以保留当前已保存的值。'
                : '密码或授权码会保存在邮件应用自己的数据库中。'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>服务商预设</Label>
            <Select value={form.provider} onValueChange={usePreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tencent-exmail">腾讯企业邮箱</SelectItem>
                <SelectItem value="aliyun-mail">阿里云邮箱（手工确认服务器）</SelectItem>
                <SelectItem value="manual">手工配置</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="mail-name">账户名称</Label>
            <Input
              id="mail-name"
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="mail-email">邮箱地址（同时作为登录账号）</Label>
            <Input
              id="mail-email"
              type="email"
              value={form.email}
              onChange={(e) => {
                set('email', e.target.value);
                set('username', e.target.value);
              }}
              placeholder="name@company.com"
            />
          </div>
          <div>
            <Label>认证方式</Label>
            <Select value={form.auth_kind} onValueChange={(value) => set('auth_kind', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="app-password">客户端授权码（推荐）</SelectItem>
                <SelectItem value="password">邮箱登录密码</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {form.auth_kind === 'app-password'
                ? '填为开搞单独生成的客户端授权码；撤销它不会影响网页登录密码。'
                : '仅在企业邮箱未提供授权码时使用；改网页登录密码后需要在这里重新保存。'}
            </p>
          </div>
          <div>
            <Label htmlFor="mail-secret">密码或授权码</Label>
            <div className="flex items-center gap-2">
              <Input
                id="mail-secret"
                type={showSecret ? 'text' : 'password'}
                value={form.secret}
                onChange={(e) => set('secret', e.target.value)}
              />
              <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={showSecret ? '隐藏密码' : '显示密码'}
                      onClick={() => void toggleSecret()}
                      disabled={loadingSecret}
                    >
                      <>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{showSecret ? '隐藏密码' : '显示密码'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mail-host">IMAP 主机</Label>
              <Input
                id="mail-host"
                value={form.imap_host}
                onChange={(e) => set('imap_host', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="mail-port">端口</Label>
              <Input
                id="mail-port"
                type="number"
                value={form.imap_port}
                onChange={(e) => set('imap_port', Number(e.target.value))}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="justify-between px-2"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            <span>高级设置</span>
            <ChevronDown
              size={16}
              className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </Button>
          {showAdvanced && (
            <div className="grid gap-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                目录默认由服务器自动识别。只有识别失败时才需要手动填写。
              </p>
              <div>
                <Label htmlFor="mail-spam">垃圾箱远程文件夹</Label>
                <Input
                  id="mail-spam"
                  value={form.spam_folder ?? ''}
                  onChange={(e) => set('spam_folder', e.target.value)}
                  placeholder="例如：垃圾邮件"
                />
              </div>
              <div>
                <Label htmlFor="mail-deleted">已删除远程文件夹</Label>
                <Input
                  id="mail-deleted"
                  value={form.deleted_folder ?? form.trash_folder ?? ''}
                  onChange={(e) => set('deleted_folder', e.target.value)}
                  placeholder="例如：已删除"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="outline" disabled={testDisabled} onClick={testConnection}>
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <Button disabled={saveDisabled} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
