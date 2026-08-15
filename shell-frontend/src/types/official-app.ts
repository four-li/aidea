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
  artifact: OfficialArtifact;
  process: {
    command: string[];
    working_directory: string;
    ready_url: string;
  };
  /** 后端无法读取 manifest 时为 false，此时只能展示占位卡片。 */
  available?: boolean;
  /** 由后端按已安装记录计算，市场版本更高时为 true。 */
  update_available: boolean;
  installed_version?: string;
}

export interface OfficialRelease {
  version: string;
  title: string;
  body: string;
  published_at?: string;
  prerelease: boolean;
  url: string;
}

export interface InstalledApp {
  id: string;
  version: string;
  status: string;
}

export interface OfficialAppInstallResult {
  installed: InstalledApp;
  start_error: string | null;
}
