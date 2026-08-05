// 无选中应用时的空状态
export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-muted-foreground text-sm">
          从左侧选择一个应用
        </p>
        <p className="text-muted-foreground text-xs mt-2 opacity-60">
          aIdea
        </p>
      </div>
    </div>
  );
}
