import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export default function ArchiveDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { state } = useAppState();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const records = state.archives
    .filter(a => a.taskId === taskId)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  const title = records[0]?.title || '未知任务';

  return (
    <DashboardLayout pageTitle="归档详情">
      <div className="max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-3 gap-1" onClick={() => navigate('/archives')}>
          <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
        </Button>
        <h2 className="text-lg font-semibold text-foreground mb-4">{title} · 归档记录</h2>

        {records.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">无记录</p>
        ) : (
          <div className="space-y-2">
            {records.map(r => (
              <Card key={r.id} className="bg-card border-border">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-primary font-medium">第 {r.occurrenceIndex} 次</span>
                      <span className="text-xs text-muted-foreground ml-3">
                        {new Date(r.completedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                      {expandedId === r.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  {r.insightSnapshot && (
                    <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{r.insightSnapshot}</p>
                  )}
                  {expandedId === r.id && (
                    <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
                      <p className="text-[10px] text-muted-foreground mb-1">任务快照</p>
                      <pre className="text-[10px] text-muted-foreground overflow-auto max-h-32">
                        {JSON.stringify(JSON.parse(r.taskSnapshotJson), null, 2)}
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
