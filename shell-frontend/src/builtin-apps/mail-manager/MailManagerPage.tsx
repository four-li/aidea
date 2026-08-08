import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ArchiveX, ExternalLink, Inbox, Loader2, Mail, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ipc } from '@/lib/ipc';
import type { MailAccount, MailMessageDetail, MailMessageSummary, MailSyncTask } from '@/types/mail';
import { AccountDialog } from './AccountDialog';

const MESSAGE_PAGE_SIZE = 30;
const formatTime = (seconds: number) => new Date(seconds * 1000).toLocaleString();

export function MailManagerPage() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [selected, setSelected] = useState<MailMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MailAccount | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [listLoaded, setListLoaded] = useState(false);
  const [folder, setFolder] = useState<'inbox' | 'spam' | 'deleted'>('inbox');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [readState, setReadState] = useState<'all' | 'read' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const [syncTasks, setSyncTasks] = useState<MailSyncTask[]>([]);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [historyDays, setHistoryDays] = useState('30');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyUntil, setHistoryUntil] = useState('');
  const [historySyncing, setHistorySyncing] = useState(false);

  const load = useCallback(async () => {
    setListLoaded(false);
    try {
      const [nextAccounts, page] = await Promise.all([
        ipc.listMailAccounts(),
        ipc.listMailMessages({ account_id: accountId, folder_kind: folder, read_state: readState, search, limit: MESSAGE_PAGE_SIZE }),
      ]);
      setAccounts(nextAccounts);
      setMessages(page.items);
      setTotal(page.total);
      setHasMore(page.items.length < page.total);
      setListLoaded(true);
      setSyncTasks(await ipc.listMailSyncTasks());
    } catch (error) {
      toast.error('读取邮件数据失败', { description: String(error) });
    }
  }, [accountId, folder, readState, search]);

  useEffect(() => {
    void load();
    const unlisten = listen('mail-sync-completed', () => void load());
    const unlistenProgress = listen('mail-sync-progress', () => void ipc.listMailSyncTasks().then(setSyncTasks));
    return () => {
      void unlisten.then((dispose) => dispose());
      void unlistenProgress.then((dispose) => dispose());
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await ipc.syncMailAccounts();
      await load();
      const failed = result.accounts.filter((account) => !account.synced);
      if (failed.length) {
        toast.error('部分账户同步失败', {
          description: failed.map((account) => account.error).join('；'),
        });
      } else {
        toast.success('邮件已刷新');
      }
    } catch (error) {
      toast.error('刷新失败', { description: String(error) });
    } finally {
      setRefreshing(false);
    }
  };

  const syncHistory = async () => {
    setHistorySyncing(true);
    try {
      const days = Number(historyDays);
      const since = historyDays === 'custom' && historyFrom ? Math.floor(new Date(`${historyFrom}T00:00:00`).getTime() / 1000) : Math.floor(Date.now() / 1000) - days * 86400;
      const until = historyDays === 'custom' && historyUntil ? Math.floor(new Date(`${historyUntil}T23:59:59`).getTime() / 1000) : undefined;
      if (historyDays === 'custom' && (!historyFrom || !historyUntil || since >= (until ?? since))) {
        toast.error('历史范围无效', { description: '请选择有效的开始和结束日期' });
        return;
      }
      const result = await ipc.syncMailHistory({ since, until });
      await load();
      const failed = result.accounts.filter((account) => !account.synced);
      if (failed.length) toast.error('历史邮件拉取未完全成功', { description: failed.map((account) => account.error).join('；') });
      else toast.success('历史邮件拉取完成');
    } catch (error) {
      toast.error('历史邮件拉取失败', { description: String(error) });
    } finally {
      setHistorySyncing(false);
    }
  };

  const openAddAccount = () => {
    setEditingAccount(null);
    setDialogOpen(true);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await ipc.listMailMessages({
        folder_kind: folder,
        account_id: accountId,
        read_state: readState,
        search,
        limit: MESSAGE_PAGE_SIZE,
        offset: messages.length,
      });
      setMessages((current) => [...current, ...page.items]);
      setTotal(page.total);
      setHasMore(messages.length + page.items.length < page.total);
    } catch (error) {
      toast.error('读取更多邮件失败', { description: String(error) });
    } finally {
      setLoadingMore(false);
    }
  };

  const select = async (message: MailMessageSummary) => {
    setDetailLoading(true);
    setSelected(null);
    try {
      const detail = await ipc.getMailMessage(message.id);
      setSelected(detail);
      if (!detail.is_read) {
        await ipc.markMailRead(message.id);
        setMessages((current) =>
          current.map((item) => (item.id === message.id ? { ...item, is_read: true } : item))
        );
        setSelected({ ...detail, is_read: true });
      }
    } catch (error) {
      toast.error('读取邮件失败', { description: String(error) });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2 font-medium">
          <Mail size={20} />
          邮件管理
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSyncPanelOpen((open) => !open)}>
            <RefreshCw />同步状态
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中' : '刷新'}
          </Button>
          <Button size="sm" onClick={openAddAccount}>
            <Plus />
            添加账户
          </Button>
        </div>
      </header>
      {syncPanelOpen && <div className="border-b border-border bg-muted/30 px-4 py-3 text-xs"><div className="mb-2 flex items-center justify-between"><span className="font-medium">同步记录</span><span className="text-muted-foreground">实时监听由后台保持</span></div><div className="mb-3 flex flex-wrap items-center gap-2"><label htmlFor="mail-history-days">历史范围</label><select id="mail-history-days" className="rounded border border-border bg-background px-2 py-1" value={historyDays} onChange={(event) => setHistoryDays(event.target.value)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="custom">自定义</option></select>{historyDays === 'custom' && <><Input aria-label="历史开始日期" type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} className="h-8 w-36" /><Input aria-label="历史结束日期" type="date" value={historyUntil} onChange={(event) => setHistoryUntil(event.target.value)} className="h-8 w-36" /></>}<Button size="sm" variant="outline" onClick={() => void syncHistory()} disabled={historySyncing}>{historySyncing ? '拉取中…' : '拉取历史'}</Button>{historySyncing && <Button size="sm" variant="outline" onClick={() => void ipc.cancelMailSync()}>取消</Button>}</div>{syncTasks.length === 0 ? <p className="text-muted-foreground">暂无同步记录</p> : syncTasks.slice(0, 8).map((task) => <div key={task.id} className="flex items-center gap-3 border-t border-border py-2"><span className="w-28 truncate">{accounts.find((account) => account.id === task.account_id)?.display_name ?? task.account_id}</span><span>{task.phase === 'completed' ? '已完成' : task.phase === 'error' ? '失败' : '同步中'}</span><span className="flex-1 text-muted-foreground">{task.error ?? `处理 ${task.processed}${task.total ? ` / ${task.total}` : ''}`}</span></div>)}</div>}
      {accounts.length === 0 ? (
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Mail size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm">还没有邮箱账户</p>
            <Button className="mt-4" onClick={openAddAccount}>
              <Plus />
              添加腾讯企业邮箱或手工配置
            </Button>
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[208px_minmax(320px,1fr)_minmax(420px,1.3fr)]">
          <aside className="min-h-0 overflow-auto border-r border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">账户与文件夹</p>
            <button
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted ${folder === 'inbox' ? 'bg-muted' : ''}`}
              onClick={() => { setAccountId(null); setFolder('inbox'); }}
            >
              <Inbox size={16} />
              收件箱
            </button>
            <button
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted ${folder === 'spam' ? 'bg-muted' : ''}`}
              onClick={() => { setAccountId(null); setFolder('spam'); }}
            >
              <Trash2 size={16} />
              垃圾箱
            </button>
            <button
              className={`mb-3 flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted ${folder === 'deleted' ? 'bg-muted' : ''}`}
              onClick={() => { setAccountId(null); setFolder('deleted'); }}
            >
              <ArchiveX size={16} />
              已删除
            </button>
            {accounts.map((account) => (
              <ContextMenu key={account.id}>
                <ContextMenuTrigger asChild>
                  <div className={`mb-3 cursor-pointer rounded px-2 py-1 hover:bg-muted ${accountId === account.id ? 'bg-muted' : ''}`} onClick={() => setAccountId(account.id)}>
                    <div className="flex items-center gap-2 truncate text-sm font-medium"><span className="inline-flex size-5 items-center justify-center rounded bg-primary text-xs text-primary-foreground">{account.provider === 'gmail' ? 'G' : account.provider.includes('aliyun') ? 'A' : account.provider.includes('qq') || account.provider.includes('tencent') ? 'Q' : 'M'}</span>{account.display_name}<span className="ml-auto text-xs text-muted-foreground">{account.unread_total || ''}</span></div>
                    <div className="mb-1 truncate text-xs text-muted-foreground">{account.email}</div>
                    {account.last_error && (
                      <p className="mt-1 text-xs text-destructive">{account.last_error}</p>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem className="px-2 py-1 text-xs" onSelect={() => { setEditingAccount(account); setDialogOpen(true); }}>
                    <Pencil size={14} />
                    编辑账户
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </aside>
          <section className="min-h-0 overflow-auto border-r border-border">
            <div className="sticky top-0 border-b border-border bg-background p-3">
              <div className="relative">
                <Search size={16} className="absolute left-2 top-2 text-muted-foreground" />
                <Input
                  aria-label="搜索邮件"
                  className="pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索主题、发件人"
                />
              </div>
              {listLoaded && (
                <p className="mt-2 text-xs text-muted-foreground">
                  已显示 {messages.length} / 共 {total} 封
                </p>
              )}
              {folder === 'inbox' && <div className="mt-3 flex gap-1"><Button variant={readState === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setReadState('all')}>全部</Button><Button variant={readState === 'read' ? 'default' : 'outline'} size="sm" onClick={() => setReadState('read')}>已读</Button><Button variant={readState === 'unread' ? 'default' : 'outline'} size="sm" onClick={() => setReadState('unread')}>未读</Button></div>}
            </div>
            {messages.length === 0 ? (
              <div className="flex h-[calc(100%-56px)] items-center justify-center text-sm text-muted-foreground">
                暂无邮件，点击刷新同步
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <button
                    key={message.id}
                    className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-muted ${selected?.id === message.id ? 'bg-muted' : ''}`}
                    onClick={() => void select(message)}
                  >
                    <div className="flex justify-between gap-3">
                      <span className={message.is_read ? 'text-sm' : 'text-sm font-semibold'}>
                        {message.sender_name ?? message.sender_address}
                      </span>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(message.received_at)}
                      </time>
                    </div>
                    <p className={message.is_read ? 'truncate text-sm' : 'truncate text-sm font-semibold'}>
                      {message.subject || '(无主题)'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{message.snippet ?? ''}</p>
                  </button>
                ))}
                {hasMore && (
                  <div className="border-b border-border p-3 text-center">
                    <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? '加载中' : '加载更多'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="min-h-0 overflow-auto p-5">
            {detailLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" size={16} />
                正在加载邮件
              </div>
            ) : selected ? (
              <article key={selected.id} className="animate-in fade-in-0 duration-150">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <h1 className="text-lg font-semibold">{selected.subject || '(无主题)'}</h1>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => void ipc.openMailWebmail(selected.account_id)}><ExternalLink />网页邮箱</Button>
                    {folder !== 'deleted' && <Button variant="outline" size="sm" onClick={() => void ipc.moveMailToDeleted(selected.id).then(() => { toast.success('邮件已移入已删除'); setSelected(null); void load(); }).catch((error) => toast.error('删除邮件失败', { description: String(error) }))}><ArchiveX />移入已删除</Button>}
                    <Button variant="outline" size="sm" onClick={() => void ipc.markMailUnread(selected.id).then(() => { setSelected({ ...selected, is_read: false }); setMessages((current) => current.map((item) => item.id === selected.id ? { ...item, is_read: false } : item)); }).catch((error) => toast.error('标记未读失败', { description: String(error) }))}>标记未读</Button>
                  </div>
                </div>
                <p className="text-sm">{selected.sender_name ?? selected.sender_address}</p>
                <p className="mb-5 text-xs text-muted-foreground">
                  {formatTime(selected.received_at)}
                </p>
                <iframe
                  title="邮件正文"
                  sandbox=""
                  srcDoc={selected.sanitized_html ?? selected.text_body ?? ''}
                  className="h-[calc(100%-6rem)] min-h-[360px] w-full border-0"
                />
              </article>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                选择一封邮件查看详情
              </div>
            )}
          </section>
        </main>
      )}
      <AccountDialog
        open={dialogOpen}
        account={editingAccount}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingAccount(null);
        }}
        onSaved={() => void load()}
      />
    </div>
  );
}
