export interface AiServiceModel {
  id: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  sort_order: number;
  enabled: boolean;
}

export interface AiServiceModelSummary {
  id: string;
  provider: string;
  base_url: string;
  model: string;
  sort_order: number;
  enabled: boolean;
  key_hint: string;
}

export interface AiServiceDefinition {
  id: string;
  path: string;
  protocol: string;
  description: string;
  model_id: string | null;
}

export interface AiServiceTokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface AiServiceAuditRunSummary {
  id: string;
  service: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  elapsed_ms: number | null;
  loop_count: number;
  usage: AiServiceTokenUsage;
  error_summary: string | null;
}

export interface AiServiceAuditEvent {
  sequence: number;
  event_type: string;
  name: string;
  elapsed_ms: number;
  usage: AiServiceTokenUsage;
  summary: string | null;
}

export interface AiServiceAuditRunDetail {
  run: AiServiceAuditRunSummary;
  events: AiServiceAuditEvent[];
}

export interface AiServiceApprovalRequest {
  id: string;
  command: string;
  cwd: string;
}

export type AiServiceModelTestRequest =
  | { model_id: string; request: Record<string, unknown> }
  | { service_id: string; request: { message: string } };

export interface AiServiceModelTestResult {
  data: string;
  elapsed_ms: number;
  request: unknown;
  response: unknown;
  error?: string | null;
}
