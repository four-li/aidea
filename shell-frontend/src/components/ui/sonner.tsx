// Sonner toast：操作反馈通知
import { Toaster as Sonner } from 'sonner';
import { useTheme } from '../../hooks/useTheme';

const Toaster = () => {
  const { mode } = useTheme();
  return (
    <Sonner
      theme={mode as 'light' | 'dark' | 'system'}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: '!text-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
    />
  );
};

export { Toaster };
