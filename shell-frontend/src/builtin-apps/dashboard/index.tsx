// Dashboard 占位页面
import { LayoutDashboard } from 'lucide-react';

export function DashboardPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <LayoutDashboard size={32} className="text-primary" />
        </div>
        <h2 className="text-foreground text-lg font-medium mb-2">Dashboard</h2>
        <p className="text-muted-foreground text-sm">应用总览与快速入口</p>
        <p className="text-muted-foreground text-xs mt-4 opacity-60">
          此页面为占位符,后续实现具体内容
        </p>
      </div>
    </div>
  );
}
