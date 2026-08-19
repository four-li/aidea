import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltinPage } from '../../src/components/BuiltinPage';
import type { AppManifest } from '../../src/types/manifest';

const mocks = vi.hoisted(() => ({
  getAiServiceStatus: vi.fn(),
  listModels: vi.fn(),
  getModel: vi.fn(),
  saveModel: vi.fn(),
  deleteModel: vi.fn(),
  reorderModels: vi.fn(),
  listServices: vi.fn(),
  saveServiceModel: vi.fn(),
  fetchProviderModels: vi.fn(),
  testModel: vi.fn(),
  auditSettings: vi.fn(),
  saveAuditSettings: vi.fn(),
  auditRuns: vi.fn(),
  auditRun: vi.fn(),
  pendingApprovals: vi.fn(),
  resolveApproval: vi.fn(),
}));

vi.mock('../../src/lib/ipc', () => ({
  ipc: {
    getAiServiceStatus: mocks.getAiServiceStatus,
    listAiServiceModels: mocks.listModels,
    getAiServiceModel: mocks.getModel,
    saveAiServiceModel: mocks.saveModel,
    deleteAiServiceModel: mocks.deleteModel,
    reorderAiServiceModels: mocks.reorderModels,
    listAiServiceServices: mocks.listServices,
    saveAiServiceServiceModel: mocks.saveServiceModel,
    fetchAiServiceProviderModels: mocks.fetchProviderModels,
    testAiServiceModel: mocks.testModel,
    getAiServiceAuditSettings: mocks.auditSettings,
    saveAiServiceAuditSettings: mocks.saveAuditSettings,
    listAiServiceAuditRuns: mocks.auditRuns,
    getAiServiceAuditRun: mocks.auditRun,
    listAiServicePendingApprovals: mocks.pendingApprovals,
    resolveAiServiceApproval: mocks.resolveApproval,
  },
}));

const aiServiceManifest: AppManifest = {
  id: 'ai-service',
  name: 'AI Service',
  version: '0.1.0',
  category: '开发',
  status: 'active',
  ui: { mode: 'builtin', icon: 'Sparkles' },
};

describe('AI Service 内置应用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAiServiceStatus.mockResolvedValue({ state: 'ready', error: null });
    mocks.listModels.mockResolvedValue([]);
    mocks.getModel.mockResolvedValue({
      id: 'model-1',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-saved-key',
      model: 'gpt-5',
      sort_order: 0,
      enabled: true,
    });
    mocks.listServices.mockResolvedValue([]);
    mocks.saveModel.mockResolvedValue(undefined);
    mocks.deleteModel.mockResolvedValue(undefined);
    mocks.reorderModels.mockResolvedValue(undefined);
    mocks.saveServiceModel.mockResolvedValue(undefined);
    mocks.fetchProviderModels.mockResolvedValue(['gpt-5', 'gpt-5-mini']);
    mocks.testModel.mockResolvedValue({
      data: 'OK',
      elapsed_ms: 1,
      request: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: 'Bearer ***', 'Content-Type': 'application/json' },
        body: { model: 'gpt-5' },
      },
      response: { status: 200, body: { choices: [{ message: { content: 'OK' } }] } },
    });
    mocks.auditSettings.mockResolvedValue(true);
    mocks.saveAuditSettings.mockResolvedValue(undefined);
    mocks.auditRuns.mockResolvedValue([]);
    mocks.auditRun.mockResolvedValue(null);
    mocks.pendingApprovals.mockResolvedValue([]);
    mocks.resolveApproval.mockResolvedValue(undefined);
  });

  it('作为独立内置应用装载四个确定页面', () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    expect(aiServiceManifest.id).toBe('ai-service');
    expect(screen.getByRole('tablist', { name: 'AI Service 页面导航' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    expect(screen.getByRole('tab', { name: '模型配置' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '服务列表' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '模型测试' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '审计记录' })).toBeInTheDocument();
  });

  it('模型选择框只使用键盘焦点样式，不显示常驻蓝色焦点环', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    const testTab = screen.getByRole('tab', { name: '模型测试' });
    fireEvent.mouseDown(testTab, { button: 0 });
    fireEvent.click(testTab);
    const trigger = await screen.findByRole('combobox', { name: '测试模型' });
    expect(trigger.className).toContain('focus-visible:ring-2');
    expect(trigger.className).not.toContain('focus:ring-2');
  });

  it('新增模型后通过 AI Service IPC 保存配置', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));

    await waitFor(() =>
      expect(mocks.saveModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5', api_key: 'sk-test' }),
      ),
    );
  });

  it('编辑已保存模型时默认隐藏 API Key，并允许临时显示', async () => {
    mocks.listModels.mockResolvedValue([
      {
        id: 'model-1',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5',
        sort_order: 0,
        enabled: true,
        key_hint: '...-key',
      },
    ]);
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑模型：gpt-5' }));

    await waitFor(() => expect(mocks.getModel).toHaveBeenCalledWith('model-1'));
    const apiKey = screen.getByLabelText('API Key');
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveValue('sk-saved-key');

    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));

    expect(apiKey).toHaveAttribute('type', 'text');
  });

  it('保存模型时不允许空 API Key', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'gpt-5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));

    expect(mocks.saveModel).not.toHaveBeenCalled();
  });

  it('模型名称使用一个可输入下拉框，Base URL 默认留空', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.getByLabelText('Base URL')).toHaveAttribute(
      'placeholder',
      '例如：https://api.openai.com/v1',
    );
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.openrouter.ai/v1' },
    });
    expect(screen.getByLabelText('提供方名称')).toHaveValue('openrouter');

    fireEvent.change(screen.getByLabelText('提供方名称'), { target: { value: '团队代理' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    expect(screen.getByLabelText('提供方名称')).toHaveValue('团队代理');

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));

    await waitFor(() =>
      expect(mocks.fetchProviderModels).toHaveBeenCalledWith({
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test',
      }),
    );
    expect(screen.queryByRole('combobox', { name: '已获取模型列表' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'gpt-5-mini' }));
    expect(screen.getByLabelText('模型名称')).toHaveValue('gpt-5-mini');
  });

  it('获取模型列表后直接展示完整列表，不受已有模型名称过滤', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '团队指定模型' } });
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));

    expect(await screen.findByRole('option', { name: 'gpt-5' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gpt-5-mini' })).toBeInTheDocument();
  });

  it('将模型列表放在配置弹窗内，避免被弹窗滚动锁拦截', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));

    const modelList = await screen.findByRole('listbox', { name: '已获取模型列表' });
    expect(screen.getByRole('dialog', { name: '新增模型' })).toContainElement(modelList);
  });

  it('点击配置弹窗的其他区域时收起模型列表', async () => {
    render(<BuiltinPage app={aiServiceManifest} />);

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '获取模型列表' }));
    expect(await screen.findByRole('listbox', { name: '已获取模型列表' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByLabelText('提供方名称'));

    expect(screen.queryByRole('listbox', { name: '已获取模型列表' })).not.toBeInTheDocument();
  });

  it('模型测试显示可编辑请求、原始响应，并可新增后自动选中新模型', async () => {
    const existing = {
      id: 'model-1',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-5',
      sort_order: 0,
      enabled: true,
      key_hint: '...key',
    };
    const created = {
      id: 'model-2',
      provider: 'acme',
      base_url: 'https://api.acme.test/v1',
      model: 'gpt-new',
      sort_order: 1,
      enabled: true,
      key_hint: '...new',
    };
    let savedId = '';
    mocks.listModels.mockImplementation(() =>
      Promise.resolve(savedId ? [existing, { ...created, id: savedId }] : [existing]),
    );
    mocks.saveModel.mockImplementation((model) => {
      savedId = model.id;
      return Promise.resolve();
    });
    render(<BuiltinPage app={aiServiceManifest} />);

    const testTab = screen.getByRole('tab', { name: '模型测试' });
    fireEvent.mouseDown(testTab, { button: 0 });
    fireEvent.click(testTab);
    expect(await screen.findByRole('combobox', { name: '测试模型' })).toHaveTextContent(
      'openai · gpt-5',
    );
    fireEvent.click(screen.getByRole('button', { name: '开始测试' }));

    expect(await screen.findByText('请求参数')).toBeInTheDocument();
    expect(screen.getByText('响应参数')).toBeInTheDocument();
    const requestModeTab = screen.getByRole('tab', { name: '模型请求' });
    expect(
      document.getElementById(requestModeTab.getAttribute('aria-controls') ?? ''),
    ).toContainElement(screen.getByLabelText('请求参数'));
    const toolbar = screen.getByRole('toolbar', { name: '模型测试工具栏' });
    expect(toolbar).toContainElement(screen.getByRole('tab', { name: '模型请求' }));
    expect(toolbar).toContainElement(screen.getByRole('combobox', { name: '测试模型' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '新增模型' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '开始测试' }));
    expect(
      screen.queryByText('请求参数可直接编辑，API Key 始终只保留在 AI Service 本机配置中。'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '最终结果' })).not.toBeInTheDocument();
    expect((screen.getByLabelText('请求参数') as HTMLTextAreaElement).value).toContain(
      '"model": "gpt-5"',
    );
    expect(document.body.textContent).not.toContain('sk-saved-key');

    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.acme.test/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-new' } });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'gpt-new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));

    await waitFor(() =>
      expect(mocks.saveModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-new' })),
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '测试模型' })).toHaveTextContent(
        'acme · gpt-new',
      ),
    );
  });

  it('模型测试请求中显示动画进度和已等待时间', async () => {
    mocks.listModels.mockResolvedValue([
      {
        id: 'model-1',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5',
        sort_order: 0,
        enabled: true,
        key_hint: '...key',
      },
    ]);
    let resolveRequest: (value: unknown) => void = () => undefined;
    mocks.testModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<BuiltinPage app={aiServiceManifest} />);

    const testTab = screen.getByRole('tab', { name: '模型测试' });
    fireEvent.mouseDown(testTab, { button: 0 });
    fireEvent.click(testTab);
    await waitFor(() => expect(screen.getByRole('button', { name: '开始测试' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '开始测试' }));

    expect(await screen.findByRole('status')).toHaveTextContent('请求中');
    expect(screen.getByText('已等待 0 秒')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: '模型请求进度' });
    expect(progress).toHaveAttribute('aria-valuetext', '请求中，已等待 0 秒');
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(progress.firstElementChild).toHaveClass(
      'animate-[ai-service-request_1.2s_linear_infinite]',
    );

    resolveRequest({
      data: 'OK',
      elapsed_ms: 1,
      request: {},
      response: { status: 200, body: {} },
    });

    expect(await screen.findByText(/^请求完成/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: '模型请求进度' })).not.toBeInTheDocument();
  });

  it('服务列表说明调用契约，并带着服务进入服务调用测试', async () => {
    mocks.listModels.mockResolvedValue([
      {
        id: 'model-1',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5',
        sort_order: 0,
        enabled: true,
        key_hint: '...key',
      },
    ]);
    mocks.listServices.mockResolvedValue([
      {
        id: 'agent',
        path: '/api/agent',
        protocol: '同步 JSON',
        description: '让 AI Service 根据 message 自行调用本机工具后返回最终结果。',
        model_id: null,
      },
    ]);
    render(<BuiltinPage app={aiServiceManifest} />);

    const serviceTab = screen.getByRole('tab', { name: '服务列表' });
    fireEvent.mouseDown(serviceTab, { button: 0 });
    fireEvent.click(serviceTab);

    expect(await screen.findByText('/api/agent')).toBeInTheDocument();
    expect(
      screen.getByText('让 AI Service 根据 message 自行调用本机工具后返回最终结果。'),
    ).toBeInTheDocument();
    expect(screen.getByText('{"message":"..."}')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '测试 agent 服务' }));

    expect(screen.getByRole('tab', { name: '模型测试', selected: true })).toBeInTheDocument();
    expect(
      await screen.findByRole('tab', { name: '服务调用', selected: true }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('请求参数'), {
      target: { value: '{"message":"请整理当前提交"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始测试' }));

    await waitFor(() =>
      expect(mocks.testModel).toHaveBeenCalledWith({
        service_id: 'agent',
        request: { message: '请整理当前提交' },
      }),
    );
  });

  it('模型请求可在发送前编辑 JSON，并保留失败时的上游响应', async () => {
    mocks.listModels.mockResolvedValue([
      {
        id: 'model-1',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-5',
        sort_order: 0,
        enabled: true,
        key_hint: '...key',
      },
    ]);
    mocks.testModel.mockResolvedValue({
      data: '',
      elapsed_ms: 42,
      error: '上游返回 HTTP 401',
      request: { model: 'gpt-5-mini', messages: [{ role: 'user', content: '测试' }] },
      response: { status: 401, body: { error: { message: 'invalid API key' } } },
    });
    render(<BuiltinPage app={aiServiceManifest} />);

    const testTab = screen.getByRole('tab', { name: '模型测试' });
    fireEvent.mouseDown(testTab, { button: 0 });
    fireEvent.click(testTab);

    const request = await screen.findByLabelText('请求参数');
    fireEvent.change(request, {
      target: {
        value: '{"model":"gpt-5-mini","messages":[{"role":"user","content":"测试"}]}',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始测试' }));

    await waitFor(() =>
      expect(mocks.testModel).toHaveBeenCalledWith({
        model_id: 'model-1',
        request: { model: 'gpt-5-mini', messages: [{ role: 'user', content: '测试' }] },
      }),
    );
    expect(await screen.findByText('请求失败：上游返回 HTTP 401')).toBeInTheDocument();
    expect(document.body.textContent).toContain('invalid API key');
  });
});
