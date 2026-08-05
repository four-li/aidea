import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IpLookup } from '../../../../src/builtin-apps/dev-tools/tabs/ip-lookup/IpLookup';

// mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// mock lib/clipboard.ts（走 Tauri plugin，jsdom 环境没有）
vi.mock('../../../../src/lib/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// mock lib/ipc.ts，getNetworkInfo 返回可控数据
const mockGetNetworkInfo = vi.fn();
vi.mock('../../../../src/lib/ipc', () => ({
  ipc: {
    getNetworkInfo: (...args: unknown[]) => mockGetNetworkInfo(...args),
  },
}));

import { copyToClipboard } from '../../../../src/lib/clipboard';

describe('IpLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('挂载即自动调用 getNetworkInfo 加载', () => {
    mockGetNetworkInfo.mockReturnValue(new Promise(() => {})); // 永不 resolve，停在 loading
    render(<IpLookup />);
    expect(mockGetNetworkInfo).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it('多源全部成功且 IP 一致 → 逐个展示来源 + IP + 地区/ISP，无警告条', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: ['192.168.1.100'],
      public: [
        {
          source: 'ipinfo.io',
          info: {
            ip: '114.114.114.114',
            region: 'CN / Hubei / Wuhan',
            org: 'AS4837 CHINANET',
          },
          error: null,
        },
        {
          source: 'ip-api.com',
          info: {
            ip: '114.114.114.114',
            region: 'CN / Hubei / Wuhan',
            org: 'China Unicom',
          },
          error: null,
        },
      ],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    // 两个来源都展示
    expect(screen.getByText('ipinfo.io')).toBeInTheDocument();
    expect(screen.getByText('ip-api.com')).toBeInTheDocument();
    // IP 一致 → 无警告条
    expect(screen.queryByText(/可能开启了代理/)).not.toBeInTheDocument();
    // 地区 + ISP（两个源都返回相同值）
    expect(screen.getAllByText('CN / Hubei / Wuhan').length).toBe(2);
    expect(screen.getByText('AS4837 CHINANET')).toBeInTheDocument();
    expect(screen.getByText('China Unicom')).toBeInTheDocument();
  });

  it('多源成功但 IP 不一致 → 顶部警告条 + 每个源卡片角标', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: [],
      public: [
        {
          source: 'ipinfo.io',
          info: { ip: '1.1.1.1', region: 'US', org: null },
          error: null,
        },
        {
          source: 'ip-api.com',
          info: { ip: '114.114.114.114', region: 'CN', org: null },
          error: null,
        },
      ],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText(/可能开启了代理/)).toBeInTheDocument();
    });
    // 每个源卡片都有"与其他源 IP 不同"角标
    expect(screen.getAllByText(/与其他源 IP 不同/).length).toBe(2);
  });

  it('部分源成功部分失败 → 成功源展示详情，失败源展示错误', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: [],
      public: [
        {
          source: 'ipinfo.io',
          info: { ip: '114.114.114.114', region: 'CN', org: null },
          error: null,
        },
        {
          source: 'ip-api.com',
          info: null,
          error: 'timeout',
        },
      ],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('114.114.114.114')).toBeInTheDocument();
    });
    expect(screen.getByText('ipinfo.io')).toBeInTheDocument();
    expect(screen.getByText('ip-api.com')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('全部数据源失败 → 所有源卡片都显示错误', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: [],
      public: [
        { source: 'ipinfo.io', info: null, error: 'timeout' },
        { source: 'ip-api.com', info: null, error: 'network error' },
        { source: 'ifconfig.me', info: null, error: 'connection refused' },
      ],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('ipinfo.io')).toBeInTheDocument();
    });
    expect(screen.getByText('ip-api.com')).toBeInTheDocument();
    expect(screen.getByText('ifconfig.me')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('network error')).toBeInTheDocument();
    expect(screen.getByText('connection refused')).toBeInTheDocument();
  });

  it('整体请求失败 → 显示错误提示和重试按钮', async () => {
    mockGetNetworkInfo.mockRejectedValue(new Error('network error'));

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    });
    expect(screen.getByText(/查询失败/)).toBeInTheDocument();
  });

  it('点击刷新按钮 → 重新调用 getNetworkInfo', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: ['192.168.1.1'],
      public: [],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    expect(mockGetNetworkInfo).toHaveBeenCalledTimes(2);
  });

  it('点击内网 IP 复制按钮 → 调用 copyToClipboard', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: ['192.168.1.100'],
      public: [],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '复制 192.168.1.100' }));

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('192.168.1.100');
    });
  });

  it('点击公网 IP 复制按钮 → 调用 copyToClipboard', async () => {
    mockGetNetworkInfo.mockResolvedValue({
      local_ips: [],
      public: [
        {
          source: 'ipinfo.io',
          info: { ip: '114.114.114.114', region: null, org: null },
          error: null,
        },
      ],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByText('114.114.114.114')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '复制 114.114.114.114' }));

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('114.114.114.114');
    });
  });

  it('点击重试按钮 → 重新调用 getNetworkInfo', async () => {
    mockGetNetworkInfo.mockRejectedValueOnce(new Error('fail'));
    mockGetNetworkInfo.mockResolvedValueOnce({
      local_ips: ['192.168.1.1'],
      public: [],
    });

    render(<IpLookup />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(mockGetNetworkInfo).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });
  });
});
