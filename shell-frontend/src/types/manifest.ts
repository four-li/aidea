// 与 Rust 侧 manifest.rs 的 serde 结构一一对应
// serde rename_all = "lowercase" → TS 用字符串字面量

export type UiMode = 'webview' | 'builtin' | 'none';
export type AppStatus = 'active' | 'disabled' | 'deprecated';
export type ProcessStatus = 'running' | 'stopped';

export interface UiConfig {
  mode: UiMode;
  url?: string;
  icon?: string;
}

export interface ProcessConfig {
  start: string;
  stop: string | Record<string, string>; // StopMethod 是 untagged enum
  autostart: boolean;
  working_dir?: string;
  log_file?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  category: string;
  path: string;
  status: AppStatus;
  ui: UiConfig;
  process?: ProcessConfig;
}

export interface AppState {
  id: string;
  status: ProcessStatus;
  pid: number | null;
}

export interface ShellConfig {
  theme: string;
  data_dir: string;
  log_dir: string;
  overrides: Record<string, AppOverride>;
}

// 用户对子应用的覆盖配置，全可选，null 表示清除
export interface AppOverride {
  name?: string | null;
  icon?: string | null;
  url?: string | null;
  start?: string | null;
}
