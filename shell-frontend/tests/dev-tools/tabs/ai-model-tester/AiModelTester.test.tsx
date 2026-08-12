import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AiModelTester } from '../../../../src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester';

const mockTestAiModel = vi.fn();
const mockSaveAiConfig = vi.fn();
const mockListAiConfigs = vi.fn().mockResolvedValue([]);
const mockLoadAiConfig = vi.fn();
const mockDeleteAiConfig = vi.fn();
const mockToastError = vi.fn();
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
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

describe('AiModelTester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAiConfigs.mockResolvedValue([]);
    mockSaveAiConfig.mockResolvedValue(undefined);
    mockToastError.mockClear();
  });

  it('左侧模板渲染请求后发送，右侧显示响应和提取结果', async () => {
    mockTestAiModel
      .mockResolvedValueOnce({
        status: 200,
        elapsed_ms: 30,
        body: { data: [{ id: 'gpt-test' }] },
      })
      .mockResolvedValueOnce({
        status: 200,
        elapsed_ms: 120,
        body: { choices: [{ message: { content: 'OK' } }] },
      });

    render(<AiModelTester />);

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));
    await screen.findByText('gpt-test');
    expect(screen.getByRole('button', { name: '发送请求' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() => {
      expect(mockTestAiModel).toHaveBeenLastCalledWith({
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

  it('模板变量包含 JavaScript 特殊字符时仍能正确发送', async () => {
    mockTestAiModel.mockResolvedValue({ status: 200, elapsed_ms: 1, body: {} });

    render(<AiModelTester />);
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'key"with\\slash' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() => expect(mockTestAiModel).toHaveBeenCalled());
    expect(mockTestAiModel).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer key"with\\slash',
        }),
      }),
    );
  });

  it('请求成功但历史配置保存失败时仍保留响应', async () => {
    mockTestAiModel.mockResolvedValue({
      status: 200,
      elapsed_ms: 1,
      body: { ok: true },
    });
    mockSaveAiConfig.mockRejectedValue(new Error('database unavailable'));

    render(<AiModelTester />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() =>
      expect(screen.getByLabelText('原始响应')).toHaveValue('{\n  "ok": true\n}'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockToastError).toHaveBeenCalledWith(
      '请求成功，但历史配置保存失败',
      expect.objectContaining({ description: 'database unavailable' }),
    );
  });

  it('点击同步按钮后拉取模型列表并填充下拉', async () => {
    mockTestAiModel.mockResolvedValue({
      status: 200,
      elapsed_ms: 30,
      body: { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] },
    });

    render(<AiModelTester />);

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));

    await waitFor(() => {
      expect(mockTestAiModel).toHaveBeenCalledWith({
        url: 'https://api.example.com/v1/models',
        method: 'GET',
        headers: { Authorization: 'Bearer sk-test' },
      });
    });
    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
  });

  it('模型同步按钮放在 Model 表单组内', () => {
    render(<AiModelTester />);

    const modelGroup = screen.getByRole('group', { name: 'Model' });

    expect(within(modelGroup).getByLabelText('Model')).toBeInTheDocument();
    expect(within(modelGroup).getByRole('button', { name: '同步模型列表' })).toBeInTheDocument();
  });

  it('模型列表同步失败时弹出错误且不清空配置', async () => {
    mockTestAiModel.mockRejectedValue(new Error('network down'));

    render(<AiModelTester />);

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('模型列表拉取失败', {
        description: 'network down',
      });
    });
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.example.com');
  });

  it('未填写 API Key 时同步模型列表会立即提示且不发请求', () => {
    render(<AiModelTester />);

    fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));

    expect(mockTestAiModel).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('模型列表拉取失败', {
      description: '请先填写 App Key',
    });
    expect(screen.getByRole('button', { name: '同步模型列表' })).toBeEnabled();
  });

  it('使用左侧功能菜单并将多模态改名为图片理解', () => {
    render(<AiModelTester />);

    expect(screen.getByRole('button', { name: '连通性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图片理解' })).toBeInTheDocument();
    expect(screen.queryByText('多模态')).not.toBeInTheDocument();
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

  it('图片理解未上传图片时不能发送请求', () => {
    render(<AiModelTester />);

    fireEvent.click(screen.getByRole('button', { name: '图片理解' }));

    expect(screen.getByRole('button', { name: '发送请求' })).toBeDisabled();
  });

  it('图片理解上传图片后发送请求会替换 imageData', async () => {
    class MockFileReader {
      result: string | ArrayBuffer | null = 'data:image/png;base64,aW1hZ2U=';
      onload: (() => void) | null = null;

      readAsDataURL() {
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    mockTestAiModel
      .mockResolvedValueOnce({
        status: 200,
        elapsed_ms: 1,
        body: { data: [{ id: 'vision-test' }] },
      })
      .mockResolvedValueOnce({ status: 200, elapsed_ms: 1, body: {} });
    const file = new File(['image'], 'demo.png', { type: 'image/png' });

    render(<AiModelTester />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));
    await screen.findByText('vision-test');
    fireEvent.click(screen.getByRole('button', { name: '图片理解' }));
    fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [file] } });

    await screen.findByText(/demo.png/);
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() => expect(mockTestAiModel).toHaveBeenCalledTimes(2));
    expect(mockTestAiModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
                }),
              ]),
            }),
          ],
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('没有提取输出时不显示提取结果区域', async () => {
    mockTestAiModel.mockResolvedValue({ status: 200, elapsed_ms: 1, body: {} });

    render(<AiModelTester />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

    await waitFor(() => expect(mockTestAiModel).toHaveBeenCalled());
    expect(screen.queryByLabelText('提取结果')).not.toBeInTheDocument();
  });
});
