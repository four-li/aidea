import type { SettingsConfig } from './manifest';

export interface OfficialPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon: string;
  repository: string;
  revision: string;
  runtime: string;
  install: string[][];
  process: {
    command: string[];
    working_directory: string;
    ready_url: string;
  };
  settings?: SettingsConfig;
  update_notes: string;
  /** 由后端按已安装记录计算，市场版本更高时为 true。 */
  update_available: boolean;
  installed_version?: string;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  revision: string;
  status: string;
}
