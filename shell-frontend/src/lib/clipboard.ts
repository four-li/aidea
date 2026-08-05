// 剪贴板封装：走 Tauri plugin（macOS 原生 API），不用 navigator.clipboard
// 原因：Tauri 2 webview 默认拒 navigator.clipboard 特权，且非 HTTPS 不稳定
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';

/** 复制文本到剪贴板（Tauri plugin） */
export async function copyToClipboard(text: string): Promise<void> {
  await writeText(text);
}

/** 从剪贴板读取文本（Tauri plugin） */
export async function readFromClipboard(): Promise<string> {
  return await readText();
}
