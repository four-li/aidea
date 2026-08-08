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
  update_notes: string;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  revision: string;
  status: string;
}
