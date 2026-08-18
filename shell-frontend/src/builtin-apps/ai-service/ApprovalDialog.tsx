import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ipc } from '../../lib/ipc';
import type { AiServiceApprovalRequest } from '../../types/ai-service';

export function ApprovalDialog() {
  const [pending, setPending] = useState<AiServiceApprovalRequest | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const requests = await ipc.listAiServicePendingApprovals();
        if (!disposed) setPending(requests[0] ?? null);
      } catch (error) {
        if (!disposed) toast.error('读取授权请求失败', { description: String(error) });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const resolve = async (approved: boolean) => {
    if (!pending) return;
    setWorking(true);
    try {
      await ipc.resolveAiServiceApproval(pending.id, approved);
      setPending(null);
    } catch (error) {
      toast.error('处理授权请求失败', { description: String(error) });
    } finally {
      setWorking(false);
    }
  };

  const commandName = pending?.command.trim().split(/\s+/)[0] || '高风险命令';

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && void resolve(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>高风险命令授权</DialogTitle>
          <DialogDescription>
            当前 Agent 请求执行一个需要确认的命令。允许后只执行这一次，不会修改其他命令的策略。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p>
            <span className="text-muted-foreground">命令类别：</span>
            <code>{commandName}</code>
          </p>
          <p className="break-all">
            <span className="text-muted-foreground">工作目录：</span>
            {pending?.cwd}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={working} onClick={() => void resolve(false)}>
            拒绝本次执行
          </Button>
          <Button disabled={working} onClick={() => void resolve(true)}>
            允许本次执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
