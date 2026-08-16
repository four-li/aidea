export type DiagnosticScope = 'aidea' | 'builtin' | 'official';
export type DiagnosticChannel = 'runtime' | 'install' | 'platform';
export type LogVerbosity = 'minimal' | 'standard' | 'debug';
export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticSummary {
  scope: DiagnosticScope;
  app_id?: string;
  warn_count: number;
}

export interface LogSettings {
  level: LogVerbosity;
  retention_days: number;
  max_total_mb: number;
}

export interface DiagnosticLogRequest {
  scope: DiagnosticScope;
  app_id?: string;
  channel: DiagnosticChannel;
}
