export interface AiTestConfig {
  api_key: string;
  base_url: string;
  model: string;
}

export interface AiHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface AiHttpResponse {
  status: number;
  elapsed_ms: number;
  body: unknown;
}

export interface AiConfigHistoryItem {
  id: string;
  base_url: string;
  model: string;
  key_hint: string;
  saved_at: number;
}
