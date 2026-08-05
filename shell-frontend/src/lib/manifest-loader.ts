// 前端侧 manifest 加载器，封装 ipc.listApps 便于上层 hook 使用
import { ipc } from './ipc';
import type { AppManifest, AppStatus } from '../types/manifest';

/** 加载所有子应用，过滤掉 disabled（不显示在侧边栏） */
export async function loadVisibleApps(): Promise<AppManifest[]> {
  const all = await ipc.listApps();
  // 仅 active 显示在侧边栏，disabled 不显示但保留配置记录
  return all.filter((app) => app.status === ('active' as AppStatus));
}
