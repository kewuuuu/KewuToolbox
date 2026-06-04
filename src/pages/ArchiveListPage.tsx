import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAppState } from '@/store/AppContext';
import { TodoArchiveRecord } from '@/types';

function buildLegacyArchiveRecord(task: {
  id: string;
  title: string;
  completedAt?: string;
  updatedAt: string;
  currentInsight?: string;
}): TodoArchiveRecord {
  const completedAt = task.completedAt || task.updatedAt || new Date().toISOString();
  return {
    id: `legacy-archive-${task.id}`,
    taskId: task.id,
    title: task.title || '未命名任务',
    completedAt,
    insightSnapshot: task.currentInsight || '',
    taskSnapshotJson: JSON.stringify(task),
    occurrenceIndex: 1,
  };
}

export default function ArchiveListPage() {
  const { state, deleteArchiveGroup } = useAppState();
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const archiveRecords = useMemo(() => {
    const records = [...state.archives];
    const archivedTodoIds = new Set(records.map(item => item.taskId));
    for (const todo of state.todos) {
      if (todo.isArchived && !archivedTodoIds.has(todo.id)) {
        records.push(buildLegacyArchiveRecord(todo));
      }
    }
    return records;
  }, [state.archives, state.todos]);

  const groups = useMemo(() => {
    const grouped = archiveRecords.reduce((map, record) => {
      const records = map.get(record.taskId) || [];
      records.push(record);
      map.set(record.taskId, records);
      return map;
    }, new Map<string, TodoArchiveRecord[]>());

    return [...grouped.entries()]
      .map(([taskId, records]) => {
        const sortedRecords = [...records].sort(
          (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
        );
        const task = state.todos.find(item => item.id === taskId);
        return {
          taskId,
          title: sortedRecords[0]?.title || task?.title || '未命名任务',
          count: sortedRecords.length,
          lastCompleted: sortedRecords[0]?.completedAt || '',
          isActive: Boolean(task && !task.isArchived),
          isLegacyOnly: records.every(record => record.id.startsWith('legacy-archive-')),
        };
      })
      .sort((a, b) => new Date(b.lastCompleted).getTime() - new Date(a.lastCompleted).getTime());
  }, [archiveRecords, state.todos]);

  const confirmDelete = () => {
    if (!deleteConfirm) {
      return;
    }
    deleteArchiveGroup(deleteConfirm);
    setDeleteConfirm(null);
  };

  return (
    <DashboardLayout pageTitle="归档列表">
      <div className="max-w-4xl mx-auto space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">归档记录</h2>
          <p className="text-xs text-muted-foreground mt-1">
            完成的待办会进入归档；如果旧版本只保存了已归档待办，也会在这里兼容显示。
          </p>
        </div>

        {groups.length === 0 ? (
          <Card className="p-8 bg-card border-border text-center">
            <p className="text-sm font-medium text-foreground">暂无归档记录</p>
            <p className="text-xs text-muted-foreground mt-2">
              当前数据文件中没有 `archives` 记录，也没有已归档的待办任务。
            </p>
          </Card>
        ) : (
          groups.map(group => (
            <Card
              key={group.taskId}
              className="p-4 bg-card border-border hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/archives/${group.taskId}`)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{group.title}</span>
                    {group.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">仍在重复</span>
                    )}
                    {group.isLegacyOnly && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        旧数据
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>完成 {group.count} 次</span>
                    <span>
                      最近完成：
                      {group.lastCompleted ? new Date(group.lastCompleted).toLocaleString('zh-CN') : '-'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={event => {
                      event.stopPropagation();
                      setDeleteConfirm(group.taskId);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))
        )}

        <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              确定要删除该任务的所有归档记录吗？此操作不可撤销。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                取消
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
