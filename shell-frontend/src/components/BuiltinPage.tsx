// builtin 模式渲染：壳内置页面
import type { AppManifest } from '../types/manifest';
import { DeveloperGuidePage } from '../builtin-apps/developer-guide';
import { DevToolsPage } from '../builtin-apps/dev-tools';

interface Props {
  app: AppManifest;
  onBackToMain?: () => void;
}

export function BuiltinPage({ app, onBackToMain }: Props) {
  // 根据 app.id 直接渲染对应组件，不用懒加载避免加载问题
  if (app.id === 'dev-tools') return <DevToolsPage />;
  if (app.id === 'developer-guide') return <DeveloperGuidePage onBack={onBackToMain} />;

  // 未知的 builtin 应用，显示占位提示
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-foreground text-sm">内置应用 {app.name}</p>
        <p className="text-muted-foreground text-xs mt-2 opacity-60">尚未实现</p>
      </div>
    </div>
  );
}
