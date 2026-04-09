import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ArchiveListPage() {
  const { state, deleteArchiveGroup } = useAppState();
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState(0);

  // Group archives by taskId
  const groups = Array.from(
    state.archives.reduce((map, a) => {
      if (!map.has(a.taskId)) map.set(a.taskId, []);
      map.get(a.taskId)!.push(a);
      return map;
    }, new Map<string, typeof state.archives>())
  ).map(([taskId, records]) => {
    const task = state.todos.find(t => t.id === taskId);
    return {
      taskId,
      title: records[0].title,
      count: records.length,
      lastCompleted: records.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0].completedAt,
      isActive: task && !task.isArchived,
    };
  });

  const handleDeleteClick = (taskId: string) => {
    if (deleteConfirm === taskId && deleteStep === 1) {
      deleteArchiveGroup(taskId);
      setDeleteConfirm(null);
      setDeleteStep(0);
    } else {
      setDeleteConfirm(taskId);
      setDeleteStep(1);
    }
  };

  return (
    <DashboardLayout pageTitle="归档列表">
      <div className="max-w-4xl mx-auto space-y-3">
        <h2 className="text-lg font-semibold text-foreground">归档记录</h2>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">暂无归档记录</p>
        ) : (
          groups.map(g => (
            <Card key={g.taskId} className="p-4 bg-card border-border hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/archives/${g.taskId}`)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{g.title}</span>
                    {g.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cat-rest/10 text-cat-rest">进行中</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>完成 {g.count} 次</span>
                    <span>最近: {new Date(g.lastCompleted).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                    onClick={e => { e.stopPropagation(); handleDeleteClick(g.taskId); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))
        )}

        <Dialog open={deleteConfirm !== null && deleteStep === 1} onOpenChange={() => { setDeleteConfirm(null); setDeleteStep(0); }}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">确定要删除该任务的所有归档记录吗？此操作不可撤销。</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDeleteConfirm(null); setDeleteStep(0); }}>取消</Button>
              <Button variant="destructive" onClick={() => deleteConfirm && handleDeleteClick(deleteConfirm)}>确认删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
