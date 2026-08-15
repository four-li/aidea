import appBridge from '../../../../docs/guide/aidea-app-bridge.md?raw';
import aiGateway from '../../../../docs/guide/aidea-ai-gateway.md?raw';
import builtinApp from '../../../../docs/guide/aidea-builtin-app.md?raw';
import officialApp from '../../../../docs/guide/aidea-official-app.md?raw';
import platform from '../../../../docs/guide/aidea-platform.md?raw';
import release from '../../../../docs/guide/aidea-release.md?raw';
import search from '../../../../docs/guide/aidea-search.md?raw';
import storage from '../../../../docs/guide/aidea-storage.md?raw';
import guideIndex from '../../../../docs/guide/README.md?raw';
import ui from '../../../../docs/guide/aidea-ui.md?raw';

export interface GuideDocument {
  id: string;
  label: string;
  content: string;
}

// 目录只描述打包顺序；正文始终直接来自 docs/guide 的 Markdown 源文件。
export const GUIDE_DOCUMENTS: GuideDocument[] = [
  { id: 'README.md', label: '开发手册', content: guideIndex },
  { id: 'aidea-platform.md', label: '平台规范', content: platform },
  { id: 'aidea-builtin-app.md', label: '内置应用规范', content: builtinApp },
  { id: 'aidea-official-app.md', label: '官方应用规范', content: officialApp },
  { id: 'aidea-app-bridge.md', label: 'App Bridge', content: appBridge },
  { id: 'aidea-ai-gateway.md', label: 'AI 网关契约', content: aiGateway },
  { id: 'aidea-storage.md', label: '数据与存储规范', content: storage },
  { id: 'aidea-ui.md', label: 'UI 规范', content: ui },
  { id: 'aidea-search.md', label: '应用内搜索规范', content: search },
  { id: 'aidea-release.md', label: 'aIdea 发布规范', content: release },
];
