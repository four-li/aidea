import { describe, expect, it } from 'vitest';
import { getAppPort } from './app-port';

describe('getAppPort', () => {
  it('从健康检查地址提取端口号', () => {
    expect(getAppPort('http://127.0.0.1:43120/health')).toBe('43120');
  });

  it('地址无效或没有端口时返回空值', () => {
    expect(getAppPort('')).toBeNull();
    expect(getAppPort('http://127.0.0.1/health')).toBeNull();
  });
});
