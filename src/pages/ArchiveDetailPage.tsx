import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

function formatTaskSnapshot(snapshotJson: string) {
  try {
    return JSON.stringify(JSON.parse(snapshotJson), null, 2);
  } catch {
    return snapshotJson || '{}';
  }
}

export default function ArchiveDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { state } = useAppState();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const records = useMemo(() => {
    const matched = state.archives.filter(record => record.taskId === taskId);
    if (matched.length > 0) {
      return matched.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    }

    const archivedTodo = state.todos.find(todo => todo.id === taskId && todo.isArchived);
    if (archivedTodo) {
      return [buildLegacyArchiveRecord(archivedTodo)];
    }

    return [];
  }, [state.archives, state.todos, taskId]);

  const title = records[0]?.title || '未知任务';

  return (
    <DashboardLayout pageTitle="归档详情">
      <div className="max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-3 gap-1" onClick={() => navigate('/archives')}>
          <ArrowLeft className="w-3.5 h-3.5" />
          返回列表
        </Button>

        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">{title} · 归档记录</h2>
          <p className="text-xs text-muted-foreground mt-1">可展开查看每次完成时保存的任务快照。</p>
        </div>

        {records.length === 0 ? (
          <Card className="p-8 bg-card border-border text-center">
            <p className="text-sm font-medium text-foreground">没有找到归档记录</p>
            <p className="text-xs text-muted-foreground mt-2">该任务可能已被删除，或当前数据文件中没有对应归档。</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {records.map(record => (
              <Card key={record.id} className="bg-card border-border">
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs text-primary font-medium">第 {record.occurrenceIndex} 次</span>
                      <span className="text-xs text-muted-foreground ml-3">
                        {new Date(record.completedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                    >
                      {expandedId === record.id ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>

                  {record.insightSnapshot ? (
                    <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{record.insightSnapshot}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">本次没有填写心得。</p>
                  )}

                  {expandedId === record.id && (
                    <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
                      <p className="text-[10px] text-muted-foreground mb-1">任务快照</p>
                      <pre className="text-[10px] text-muted-foreground overflow-auto max-h-48">
                        {formatTaskSnapshot(record.taskSnapshotJson)}
                      </pre>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
