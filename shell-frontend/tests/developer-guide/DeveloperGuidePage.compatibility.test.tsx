import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeveloperGuidePage } from '../../src/builtin-apps/developer-guide';

describe('开发手册兼容性', () => {
  it('不使用完整 GFM 插件也会渲染文档表格', () => {
    render(<DeveloperGuidePage />);

    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });
});
