export type DiagnosticScope = 'aidea' | 'builtin' | 'official';
export type DiagnosticChannel = 'runtime' | 'install' | 'platform';

export interface LogSettings {
  retention_days: number;
  max_total_mb: number;
}

export interface DiagnosticLogRequest {
  scope: DiagnosticScope;
  app_id?: string;
  channel: DiagnosticChannel;
}
