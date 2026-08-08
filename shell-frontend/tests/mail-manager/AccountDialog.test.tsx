import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDialog } from '../../src/builtin-apps/mail-manager/AccountDialog';
import type { MailAccount } from '../../src/types/mail';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockSaveMailAccount = vi.fn();
const mockLoadMailAccountSecret = vi.fn();
const mockTestMailAccountConnection = vi.fn();

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  setPointerCapture: { configurable: true, value: () => undefined },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
});
Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    saveMailAccount: (...args: unknown[]) => mockSaveMailAccount(...args),
    loadMailAccountSecret: (...args: unknown[]) => mockLoadMailAccountSecret(...args),
    testMailAccountConnection: (...args: unknown[]) => mockTestMailAccountConnection(...args),
  },
}));

describe('AccountDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMailAccount.mockResolvedValue(undefined);
    mockLoadMailAccountSecret.mockResolvedValue('saved-secret');
    mockTestMailAccountConnection.mockResolvedValue(undefined);
  });

  it('阿里云邮箱预设保存时使用个人版网页邮箱地址', async () => {
    render(<AccountDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '阿里云邮箱（手工确认服务器）' }));
    fireEvent.change(screen.getByLabelText('邮箱地址（同时作为登录账号）'), {
      target: { value: 'fourli@aliyun.com' },
    });
    fireEvent.change(screen.getByLabelText('密码或授权码'), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText('IMAP 主机'), {
      target: { value: 'imap.aliyun.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockSaveMailAccount).toHaveBeenCalledWith(
        expect.objectContaining({ webmail_url: 'https://mail.aliyun.com' }),
      );
    });
  });

  it('远程目录默认隐藏在高级设置中', () => {
    render(<AccountDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByLabelText('已删除远程文件夹')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    expect(screen.getByLabelText('已删除远程文件夹')).toBeInTheDocument();
  });

  it('编辑账户默认不读取凭据，点击眼睛后读取并显示', async () => {
    const account: MailAccount = {
      id: 'account-1',
      display_name: '阿里云邮箱',
      email: 'fourli@aliyun.com',
      provider: 'aliyun-mail',
      imap_host: 'imap.aliyun.com',
      imap_port: 993,
      tls_mode: 'tls',
      username: 'fourli@aliyun.com',
      auth_kind: 'password',
      webmail_url: 'https://mail.aliyun.com',
      inbox_folder: 'INBOX',
      trash_folder: null,
      spam_folder: null,
      deleted_folder: null,
      enabled: true,
      last_sync_at: null,
      last_error: null,
      inbox_total: 0,
      unread_total: 0,
    };
    render(<AccountDialog open account={account} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    expect(mockLoadMailAccountSecret).not.toHaveBeenCalled();
    const secretInput = screen.getByLabelText('密码或授权码');
    expect(secretInput).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    await waitFor(() => expect(mockLoadMailAccountSecret).toHaveBeenCalledWith('account-1'));
    expect(await screen.findByDisplayValue('saved-secret')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await waitFor(() =>
      expect(mockTestMailAccountConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'account-1', secret: 'saved-secret' }),
      ),
    );
    expect(mockSaveMailAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }));
    expect(screen.getByLabelText('密码或授权码')).toHaveAttribute('type', 'password');
    expect(mockLoadMailAccountSecret).toHaveBeenCalledTimes(1);
  });

  it('编辑账户不读取凭据也可以保存其他设置', async () => {
    const account: MailAccount = {
      id: 'account-1',
      display_name: '阿里云邮箱',
      email: 'fourli@aliyun.com',
      provider: 'aliyun-mail',
      imap_host: 'imap.aliyun.com',
      imap_port: 993,
      tls_mode: 'tls',
      username: 'fourli@aliyun.com',
      auth_kind: 'password',
      webmail_url: 'https://mail.aliyun.com',
      inbox_folder: 'INBOX',
      trash_folder: null,
      spam_folder: null,
      deleted_folder: null,
      enabled: true,
      last_sync_at: null,
      last_error: null,
      inbox_total: 0,
      unread_total: 0,
    };
    render(<AccountDialog open account={account} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('账户名称'), { target: { value: '阿里云工作邮箱' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockSaveMailAccount).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'account-1', secret: '' }),
      ),
    );
    expect(mockLoadMailAccountSecret).not.toHaveBeenCalled();
  });
});
