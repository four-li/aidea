// Tauri IPC 封装，所有前端调用 Rust 命令都走这里
import { invoke } from '@tauri-apps/api/core';
import type { AppManifest, AppState, AppOverride, ShellConfig } from '../types/manifest';
import type { NetworkInfo } from '../types/network';
import type {
  AiConfigHistoryItem,
  AiHttpRequest,
  AiHttpResponse,
  AiTestConfig,
} from '../types/ai-test';

export const ipc = {
  /** 列出所有已加载的子应用（已合并用户 overrides） */
  listApps: (): Promise<AppManifest[]> => invoke<AppManifest[]>('list_apps'),
  /** 保存设置页创建的本地应用 manifest */
  saveAppManifest: (manifest: AppManifest): Promise<void> =>
    invoke<void>('save_app_manifest', { manifest }),

  /** 加载壳全局设置 */
  getShellConfig: (): Promise<ShellConfig> => invoke<ShellConfig>('get_shell_config'),

  /** 保存单个子应用的覆盖配置，重启 aIdea 后生效 */
  saveAppOverride: (id: string, overrideCfg: AppOverride): Promise<void> =>
    invoke<void>('save_app_override', { id, overrideCfg }),

  /** 删除单个子应用的覆盖配置，恢复 manifest 默认 */
  resetAppOverride: (id: string): Promise<void> => invoke<void>('reset_app_override', { id }),

  /** 启动子应用，返回 pid */
  startApp: (id: string): Promise<number> => invoke<number>('start_app', { id }),

  /** 停止子应用 */
  stopApp: (id: string): Promise<void> => invoke<void>('stop_app', { id }),

  /** 查询所有子应用的进程状态 */
  getAppStates: (): Promise<AppState[]> => invoke<AppState[]>('get_app_states'),

  /** 查询本机网络信息：内网 IP 列表 + 公网 IP 详情 */
  getNetworkInfo: (): Promise<NetworkInfo> => invoke<NetworkInfo>('get_network_info'),
  /** 通过 Rust 后端发送模板渲染后的 HTTP 请求，避免 Key 暴露给 WebView 网络层 */
  sendAiHttpRequest: (request: AiHttpRequest): Promise<AiHttpResponse> =>
    invoke<AiHttpResponse>('send_ai_http_request', { request }),
  /** 保存 Key 到 macOS 钥匙串，历史文件不含 Key。 */
  saveAiConfig: (config: AiTestConfig): Promise<void> => invoke<void>('save_ai_config', { config }),
  /** 获取不含 Key 的历史配置元数据。 */
  listAiConfigs: (): Promise<AiConfigHistoryItem[]> =>
    invoke<AiConfigHistoryItem[]>('list_ai_configs'),
  /** 经 macOS 系统认证后读取历史 Key。 */
  loadAiConfig: (id: string): Promise<AiTestConfig> =>
    invoke<AiTestConfig>('load_ai_config', { id }),
  /** 删除历史元数据和对应 Keychain API Key。 */
  deleteAiConfig: (id: string): Promise<void> => invoke<void>('delete_ai_config', { id }),
};
