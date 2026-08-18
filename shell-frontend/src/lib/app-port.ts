/** 从官方应用健康检查地址提取端口号。 */
export function getAppPort(readyUrl: string): string | null {
  if (!readyUrl) return null;
  try {
    return new URL(readyUrl).port || null;
  } catch {
    return null;
  }
}
