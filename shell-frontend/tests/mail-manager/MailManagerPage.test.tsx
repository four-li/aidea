import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailManagerPage } from '../../src/builtin-apps/mail-manager/MailManagerPage';
import type { MailMessageDetail } from '../../src/types/mail';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockListMailAccounts = vi.fn();
const mockListMailMessages = vi.fn();
const mockGetMailMessage = vi.fn();
const mockMarkMailRead = vi.fn();
const mockOpenMailWebmail = vi.fn();
const mockLoadMailAccountSecret = vi.fn();

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    listMailAccounts: (...args: unknown[]) => mockListMailAccounts(...args),
    listMailMessages: (...args: unknown[]) => mockListMailMessages(...args),
    getMailMessage: (...args: unknown[]) => mockGetMailMessage(...args),
    markMailRead: (...args: unknown[]) => mockMarkMailRead(...args),
    syncMailAccounts: vi.fn(),
    openMailWebmail: (...args: unknown[]) => mockOpenMailWebmail(...args),
    loadMailAccountSecret: (...args: unknown[]) => mockLoadMailAccountSecret(...args),
  },
}));

const account = {
  id: 'account-1',
  display_name: '腾讯企业邮箱',
  email: 'ops@example.com',
  provider: 'tencent-exmail',
  imap_host: 'imap.exmail.qq.com',
  imap_port: 993,
  tls_mode: 'tls',
  username: 'ops@example.com',
  auth_kind: 'app-password',
  webmail_url: 'https://exmail.qq.com',
  inbox_folder: 'INBOX',
  trash_folder: null,
  spam_folder: null,
  deleted_folder: null,
  enabled: true,
  last_sync_at: null,
  last_error: null,
  inbox_total: 3,
  unread_total: 1,
};

const message = {
  id: 1,
  account_id: 'account-1',
  folder_id: 1,
  folder_kind: 'inbox' as const,
  sender_name: '运维',
  sender_address: 'ops@example.com',
  subject: '服务告警',
  received_at: 1_700_000_000,
  is_read: true,
  snippet: '服务不可用',
};

describe('MailManagerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMailAccounts.mockResolvedValue([account]);
    mockListMailMessages.mockResolvedValue({ items: [message], total: 3 });
    mockMarkMailRead.mockResolvedValue(undefined);
    mockOpenMailWebmail.mockResolvedValue(undefined);
    mockLoadMailAccountSecret.mockResolvedValue('saved-secret');
  });

  it('显示当前页邮件数和匹配总数', async () => {
    render(<MailManagerPage />);

    expect(await screen.findByText('已显示 1 / 共 3 封')).toBeInTheDocument();
  });

  it('未选择邮件时不显示网页邮箱跳转', async () => {
    render(<MailManagerPage />);

    await screen.findByText('已显示 1 / 共 3 封');
    expect(screen.queryByRole('button', { name: '网页邮箱' })).not.toBeInTheDocument();
  });

  it('读取详情期间显示加载反馈', async () => {
    let resolveDetail: (detail: MailMessageDetail) => void = () => {};
    mockGetMailMessage.mockReturnValue(
      new Promise<MailMessageDetail>((resolve) => {
        resolveDetail = resolve;
      })
    );
    render(<MailManagerPage />);

    await screen.findByText('已显示 1 / 共 3 封');
    fireEvent.click(screen.getByRole('button', { name: /服务告警/ }));
    expect(screen.getByText('正在加载邮件')).toBeInTheDocument();

    await act(async () => {
      resolveDetail({
        ...message,
        remote_uid: 1,
        text_body: '服务不可用',
        sanitized_html: '<p>服务不可用</p>',
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '服务告警' })).toBeInTheDocument();
    });
  });

  it('详情中的网页邮箱跳转到邮件所属账户', async () => {
    mockGetMailMessage.mockResolvedValue({
      ...message,
      remote_uid: 1,
      text_body: '服务不可用',
      sanitized_html: '<p>服务不可用</p>',
    });
    render(<MailManagerPage />);

    await screen.findByText('已显示 1 / 共 3 封');
    fireEvent.click(screen.getByRole('button', { name: /服务告警/ }));
    await screen.findByRole('heading', { name: '服务告警' });
    fireEvent.click(screen.getByRole('button', { name: '网页邮箱' }));

    expect(mockOpenMailWebmail).toHaveBeenCalledWith('account-1');
  });

  it('右键账户可打开编辑弹窗', async () => {
    render(<MailManagerPage />);

    fireEvent.contextMenu(await screen.findByText('腾讯企业邮箱'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑账户' }));
    expect(await screen.findByRole('heading', { name: '编辑邮箱账户' })).toBeInTheDocument();
  });
});
