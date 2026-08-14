// 官方应用入口：按 docs/guide/aidea-app-bridge.md 手写最小 postMessage 接入。
const APP_ID = 'reference-app';
const PROTOCOL = 'aidea-app-bridge';
const VERSION = 1;
const SHELL_ORIGINS = new Set(['tauri://localhost', 'http://localhost:5173']);

interface Envelope {
  protocol: typeof PROTOCOL;
  version: number;
  source: 'aidea-app' | 'aidea-shell';
  appId: string;
  id: string;
  type: string;
  payload: unknown;
  inReplyTo?: string;
}

let sequence = 0;
let shellOrigin: string | null = null;

function nextId(): string {
  sequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `reference-${Date.now()}-${sequence}`;
}

function getShellOrigin(): string | null {
  if (window.parent === window) return null;
  try {
    const origin = new URL(document.referrer).origin;
    return SHELL_ORIGINS.has(origin) ? origin : null;
  } catch {
    return null;
  }
}

function post(type: string, payload: unknown, inReplyTo?: string): void {
  if (!shellOrigin) return;
  const message: Envelope = {
    protocol: PROTOCOL,
    version: VERSION,
    source: 'aidea-app',
    appId: APP_ID,
    id: nextId(),
    type,
    payload,
    ...(inReplyTo ? { inReplyTo } : {}),
  };
  window.parent.postMessage(message, shellOrigin);
}

function applyTheme(mode: unknown): void {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
}

applyTheme(new URLSearchParams(window.location.search).get('aidea_theme'));

function render(): void {
  document.body.innerHTML = `
    <main>
      <h1>aIdea App Bridge 范本</h1>
      <p>搜索、业务路由和数据都由应用自己负责。</p>
      <button id="notify">发送原生通知</button>
    </main>
  `;
  document.querySelector<HTMLButtonElement>('#notify')?.addEventListener('click', () => {
    post('notify', { title: '示例通知', body: '来自官方应用范本' });
  });
}

shellOrigin = getShellOrigin();
if (shellOrigin) {
  window.addEventListener('message', (event: MessageEvent<Envelope>) => {
    const message = event.data;
    if (
      event.origin !== shellOrigin ||
      event.source !== window.parent ||
      message?.protocol !== PROTOCOL ||
      message?.source !== 'aidea-shell' ||
      message.appId !== APP_ID
    ) {
      return;
    }
    if (message.version !== VERSION) {
      post(
        'protocol:error',
        { code: 'unsupported_version', message: '不支持的 App Bridge 版本' },
        message.id,
      );
      return;
    }
    if (message.type === 'theme') applyTheme((message.payload as { mode?: unknown }).mode);
    if (message.type === 'navigate') {
      const path = (message.payload as { path?: unknown }).path;
      if (
        typeof path === 'string' &&
        path.startsWith('/') &&
        !path.startsWith('//') &&
        !path.includes('\\')
      ) {
        history.pushState({}, '', path);
        render();
      }
    }
  });
  post('ready', { appId: APP_ID, supported: ['navigate'] });
}

render();
