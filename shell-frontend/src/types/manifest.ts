// 与 Rust 侧 manifest.rs 的 serde 结构一一对应
// serde rename_all = "lowercase" → TS 用字符串字面量

export type UiMode = 'webview' | 'builtin' | 'none';
export type AppStatus = 'active' | 'disabled' | 'deprecated';
export type ProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped';

export interface UiConfig {
  mode: UiMode;
  url?: string;
  icon?: string;
}

export interface SettingsConfig {
  reset_command?: string[];
}

export interface ProcessConfig {
  log_file?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  category: string;
  status: AppStatus;
  ui: UiConfig;
  settings?: SettingsConfig;
  process?: ProcessConfig;
  issue?: AppIssue;
}

export interface AppState {
  id: string;
  status: ProcessStatus;
  pid: number | null;
  issue?: AppIssue;
}

export interface AppIssue {
  level: 'warning';
  message: string;
  updated_at: number;
}

export interface ShellConfig {
  app_settings: Record<string, AppUserSettings>;
}

export type StartupMode = 'manual' | 'with-aidea';

export interface AppUserSettings {
  visible: boolean;
  startup_mode: StartupMode;
}
