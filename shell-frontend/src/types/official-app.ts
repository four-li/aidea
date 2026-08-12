import type { SettingsConfig } from './manifest';

export interface OfficialArtifact {
  url: string;
  sha256: string;
}

export interface OfficialApp {
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
  artifact?: OfficialArtifact;
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

export interface InstalledApp {
  id: string;
  version: string;
  revision: string;
  status: string;
}
