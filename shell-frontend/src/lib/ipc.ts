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
  AiServiceApprovalRequest,
  AiServiceAuditRunDetail,
  AiServiceAuditRunSummary,
  AiServiceDefinition,
  AiServiceModel,
  AiServiceModelSummary,
  AiServiceModelTestRequest,
  AiServiceModelTestResult,
} from '../types/ai-service';
import type {
  InstalledApp,
  OfficialApp,
  OfficialAppInstallResult,
  OfficialRelease,
} from '../types/official-app';
import type { DevToolsSettings } from '../types/dev-tools';
import type { AideaUpdate } from '../types/update';
import type {
  DiagnosticLogLevel,
  DiagnosticLogRequest,
  DiagnosticSummary,
  LogSettings,
} from '../types/diagnostics';

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
  listDiagnosticSummaries: (): Promise<DiagnosticSummary[]> =>
    invoke<DiagnosticSummary[]>('list_diagnostic_summaries'),
  clearDiagnosticLogs: (): Promise<void> => invoke<void>('clear_diagnostic_logs'),
  readDiagnosticLog: (request: DiagnosticLogRequest): Promise<string> =>
    invoke<string>('read_diagnostic_log', { request }),
  recordBuiltinDiagnostic: (
    id: string,
    source: 'frontend' | 'ipc',
    level: DiagnosticLogLevel,
    event: string,
    message: string,
  ): Promise<void> =>
    invoke<void>('record_builtin_diagnostic', { id, source, level, event, message }),
  recordAideaDiagnostic: (
    source: 'frontend' | 'ipc',
    level: DiagnosticLogLevel,
    event: string,
    message: string,
  ): Promise<void> => invoke<void>('record_aidea_diagnostic', { source, level, event, message }),

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
  listAiServiceModels: (): Promise<AiServiceModelSummary[]> =>
    invoke<AiServiceModelSummary[]>('list_ai_service_models'),
  getAiServiceModel: (id: string): Promise<AiServiceModel> =>
    invoke<AiServiceModel>('get_ai_service_model', { id }),
  saveAiServiceModel: (model: AiServiceModel): Promise<void> =>
    invoke<void>('save_ai_service_model', { model }),
  fetchAiServiceProviderModels: (request: { base_url: string; api_key: string }): Promise<string[]> =>
    invoke<string[]>('fetch_ai_service_provider_models', { request }),
  deleteAiServiceModel: (id: string): Promise<void> =>
    invoke<void>('delete_ai_service_model', { id }),
  reorderAiServiceModels: (ids: string[]): Promise<void> =>
    invoke<void>('reorder_ai_service_models', { ids }),
  listAiServiceServices: (): Promise<AiServiceDefinition[]> =>
    invoke<AiServiceDefinition[]>('list_ai_service_services'),
  saveAiServiceServiceModel: (serviceId: string, modelId: string | null): Promise<void> =>
    invoke<void>('save_ai_service_service_model', { serviceId, modelId }),
  testAiServiceModel: (request: AiServiceModelTestRequest): Promise<AiServiceModelTestResult> =>
    invoke<AiServiceModelTestResult>('test_ai_service_model', { request }),
  getAiServiceToken: (): Promise<string> => invoke<string>('get_ai_service_token'),
  getAiServiceAuditSettings: (): Promise<boolean> =>
    invoke<boolean>('get_ai_service_audit_settings'),
  saveAiServiceAuditSettings: (enabled: boolean): Promise<void> =>
    invoke<void>('save_ai_service_audit_settings', { enabled }),
  listAiServiceAuditRuns: (): Promise<AiServiceAuditRunSummary[]> =>
    invoke<AiServiceAuditRunSummary[]>('list_ai_service_audit_runs'),
  getAiServiceAuditRun: (id: string): Promise<AiServiceAuditRunDetail | null> =>
    invoke<AiServiceAuditRunDetail | null>('get_ai_service_audit_run', { id }),
  listAiServicePendingApprovals: (): Promise<AiServiceApprovalRequest[]> =>
    invoke<AiServiceApprovalRequest[]>('list_ai_service_pending_approvals'),
  resolveAiServiceApproval: (id: string, approved: boolean): Promise<void> =>
    invoke<void>('resolve_ai_service_approval', { id, approved }),
};
