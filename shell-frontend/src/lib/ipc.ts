// Tauri IPC 封装，所有前端调用 Rust 命令都走这里
import { invoke } from '@tauri-apps/api/core';
import type {
  AppManifest,
  AppState,
  AppUserSettings,
  ShellConfig,
} from '../types/manifest';
import type { NetworkInfo } from '../types/network';
import type {
  AiConfigHistoryItem,
  AiHttpRequest,
  AiHttpResponse,
  AiTestConfig,
} from '../types/ai-test';
import type {
  InstalledApp,
  OfficialApp,
  OfficialAppInstallResult,
  OfficialRelease,
} from '../types/official-app';
import type { DevToolsSettings } from '../types/dev-tools';
import type { AideaUpdate } from '../types/update';
import type { DiagnosticLogRequest, LogSettings } from '../types/diagnostics';

export const ipc = {
  getAideaVersion: (): Promise<string> => invoke('get_aidea_version'),
  getOsUsername: (): Promise<string> => invoke('get_os_username'),
  getOsUserAvatar: (): Promise<string | null> => invoke('get_os_user_avatar'),
  openExternalUrl: (url: string): Promise<void> => invoke('open_external_url', { url }),
  checkAideaUpdate: (): Promise<AideaUpdate | null> => invoke('check_aidea_update'),
  installAideaUpdate: (): Promise<void> => invoke('install_aidea_update'),
  /** 列出所有已加载的子应用 */
  listApps: (): Promise<AppManifest[]> => invoke<AppManifest[]>('list_apps'),
  listOfficialApps: (): Promise<OfficialApp[]> => invoke('list_official_apps'),
  listOfficialAppReleases: (id: string): Promise<OfficialRelease[]> =>
    invoke('list_official_app_releases', { id }),
  refreshOfficialApps: (): Promise<OfficialApp[]> => invoke('refresh_official_apps'),
  listInstalledOfficialApps: (): Promise<InstalledApp[]> =>
    invoke('list_installed_official_apps'),
  installOfficialApp: (id: string): Promise<OfficialAppInstallResult> =>
    invoke('install_official_app', { id }),
  updateOfficialApp: (id: string): Promise<InstalledApp> =>
    invoke('update_official_app', { id }),
  readOfficialAppInstallLog: (id: string): Promise<string> =>
    invoke('read_official_app_install_log', { id }),
  uninstallOfficialApp: (id: string): Promise<void> =>
    invoke('uninstall_official_app', { id }),
  /** 加载壳全局设置 */
  getShellConfig: (): Promise<ShellConfig> => invoke<ShellConfig>('get_shell_config'),
  getLogSettings: (): Promise<LogSettings> => invoke<LogSettings>('get_log_settings'),
  saveLogSettings: (settings: LogSettings): Promise<void> =>
    invoke<void>('save_log_settings', { settings }),
  readDiagnosticLog: (request: DiagnosticLogRequest): Promise<string> =>
    invoke<string>('read_diagnostic_log', { request }),
  recordBuiltinDiagnostic: (id: string, source: 'frontend' | 'ipc', message: string): Promise<void> =>
    invoke<void>('record_builtin_diagnostic', { id, source, message }),
  recordAideaDiagnostic: (source: 'frontend' | 'ipc', message: string): Promise<void> =>
    invoke<void>('record_aidea_diagnostic', { source, message }),

  resetAppSettings: (id: string): Promise<void> => invoke<void>('reset_app_settings', { id }),
  saveAppUserSettings: (id: string, settings: AppUserSettings): Promise<void> =>
    invoke<void>('save_app_user_settings', { id, settings }),

  /** 启动子应用，返回 pid */
  startApp: (id: string): Promise<number> => invoke<number>('start_app', { id }),

  /** 停止子应用 */
  stopApp: (id: string): Promise<void> => invoke<void>('stop_app', { id }),

  /** 用户确认后释放遗留官方应用端口 */
  releaseAppPort: (id: string): Promise<void> => invoke<void>('release_app_port', { id }),

  /** 查询所有子应用的进程状态 */
  getAppStates: (): Promise<AppState[]> => invoke<AppState[]>('get_app_states'),
  getDevToolsSettings: (): Promise<DevToolsSettings> => invoke('get_dev_tools_settings'),
  saveDevToolsSettings: (settings: DevToolsSettings): Promise<void> =>
    invoke('save_dev_tools_settings', { settings }),

  /** 查询本机网络信息：内网 IP 列表 + 公网 IP 详情 */
  getNetworkInfo: (): Promise<NetworkInfo> => invoke<NetworkInfo>('get_network_info'),
  /** 通过 Rust 后端发送模板渲染后的 HTTP 请求，避免 Key 暴露给 WebView 网络层 */
  sendAiHttpRequest: (request: AiHttpRequest): Promise<AiHttpResponse> =>
    invoke<AiHttpResponse>('send_ai_http_request', { request }),
  /** 保存 DevTools 自己的 AI 配置。 */
  saveAiConfig: (config: AiTestConfig): Promise<void> => invoke<void>('save_ai_config', { config }),
  /** 获取 AI 配置历史元数据。 */
  listAiConfigs: (): Promise<AiConfigHistoryItem[]> =>
    invoke<AiConfigHistoryItem[]>('list_ai_configs'),
  /** 读取 DevTools 自己数据库中的 AI 配置。 */
  loadAiConfig: (id: string): Promise<AiTestConfig> =>
    invoke<AiTestConfig>('load_ai_config', { id }),
  /** 删除 AI 配置历史。 */
  deleteAiConfig: (id: string): Promise<void> => invoke<void>('delete_ai_config', { id }),
};
