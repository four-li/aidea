import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiModelTester } from '../../../../src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester';

const mockTestAiModel = vi.fn();
const mockSaveAiConfig = vi.fn();
const mockListAiConfigs = vi.fn().mockResolvedValue([]);
const mockLoadAiConfig = vi.fn();
const mockDeleteAiConfig = vi.fn();
vi.mock('../../../../src/lib/ipc', () => ({
  ipc: {
    sendAiHttpRequest: (...args: unknown[]) => mockTestAiModel(...args),
    saveAiConfig: (...args: unknown[]) => mockSaveAiConfig(...args),
    listAiConfigs: () => mockListAiConfigs(),
    loadAiConfig: (...args: unknown[]) => mockLoadAiConfig(...args),
    deleteAiConfig: (...args: unknown[]) => mockDeleteAiConfig(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AiModelTester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAiConfigs.mockResolvedValue([]);
    mockSaveAiConfig.mockResolvedValue(undefined);
  });

  it('左侧模板渲染请求后发送，右侧显示响应和提取结果', async () => {
    mockTestAiModel.mockResolvedValue({
      status: 200,
      elapsed_ms: 120,
      body: { choices: [{ message: { content: 'OK' } }] },
    });

    render(<AiModelTester />);

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-test' } });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() => {
      expect(mockTestAiModel).toHaveBeenCalledWith({
        url: 'https://api.example.com/v1/chat/completions',
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test', 'Content-Type': 'application/json' },
        body: {
          model: 'gpt-test',
          messages: [{ role: 'user', content: '请只回复 OK' }],
          max_tokens: 5,
          temperature: 0,
        },
      });
    });
    expect(screen.getByLabelText('提取结果')).toHaveValue('"OK"');
  });

  it('仅在请求成功后保存配置', async () => {
    render(<AiModelTester />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });

    expect(mockSaveAiConfig).not.toHaveBeenCalled();

    mockTestAiModel.mockResolvedValue({ status: 200, elapsed_ms: 1, body: {} });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));
    await waitFor(() => {
      expect(mockSaveAiConfig).toHaveBeenCalledWith({
        api_key: 'sk-test',
        base_url: 'https://api.example.com',
        model: '',
      });
    });
    expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument();
  });

  it('可以删除历史配置', async () => {
    mockListAiConfigs.mockResolvedValue([
      {
        id: 'history-id',
        base_url: 'https://api.example.com',
        model: 'gpt-test',
        key_hint: '...test',
        saved_at: 1,
      },
    ]);
    render(<AiModelTester />);

    await screen.findByLabelText('历史配置');
    await waitFor(() => expect(mockListAiConfigs).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('历史配置'));
    fireEvent.click(await screen.findByLabelText('删除历史配置'));

    await waitFor(() => expect(mockDeleteAiConfig).toHaveBeenCalledWith('history-id'));
  });
});
