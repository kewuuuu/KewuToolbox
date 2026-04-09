import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft } from 'lucide-react';
import { normalizeTodoTask, validateTodoTask } from '@/lib/todo';
import { toast } from 'sonner';

export default function TodoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { state, updateTodo } = useAppState();
  const navigate = useNavigate();
  const todo = state.todos.find(t => t.id === id);
  const [insight, setInsight] = useState(todo?.currentInsight || '');
  const [saveStatus, setSaveStatus] = useState('已保存');
  const saveTimer = useRef<number>();

  useEffect(() => {
    if (todo) setInsight(todo.currentInsight);
  }, [todo]);

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
    };
  }, []);

  const handleInsightChange = (value: string) => {
    setInsight(value);
    setSaveStatus('保存中...');
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (todo) {
        const nextTodo = normalizeTodoTask({ ...todo, currentInsight: value, updatedAt: new Date().toISOString() });
        updateTodo(nextTodo);
        setSaveStatus('已保存');
      }
    }, 800);
  };

  if (!todo) {
    return (
      <DashboardLayout pageTitle="待办详情">
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">待办不存在</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/todos')}>返回列表</Button>
        </div>
      </DashboardLayout>
    );
  }

  const handleFieldUpdate = (fields: Partial<typeof todo>) => {
    const nextTodo = normalizeTodoTask({ ...todo, ...fields, updatedAt: new Date().toISOString() });
    const error = validateTodoTask(nextTodo);
    if (error) {
      toast.error('更新失败', { description: error });
      return;
    }

    updateTodo(nextTodo);
  };

  return (
    <DashboardLayout pageTitle="待办详情">
      <div className="max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-3 gap-1" onClick={() => navigate('/todos')}>
          <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Settings */}
          <Card className="p-5 bg-card border-border space-y-4">
            <h3 className="text-sm font-semibold text-foreground">任务设置</h3>
            <div>
              <label className="text-xs text-muted-foreground">标题</label>
              <Input value={todo.title} onChange={e => handleFieldUpdate({ title: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">类型: {todo.taskType}</label>
              {todo.taskType === '重复' && todo.repeatMode && (
                <p className="text-xs text-primary mt-1">周期: {todo.repeatMode}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={todo.reminderEnabled} onCheckedChange={v => handleFieldUpdate({ reminderEnabled: v })} />
              <span className="text-xs text-muted-foreground">定时提醒</span>
            </div>
            {todo.reminderEnabled && (
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] text-muted-foreground">时</label><Input type="number" value={todo.reminderHour || 0} onChange={e => handleFieldUpdate({ reminderHour: +e.target.value })} className="h-7 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">分</label><Input type="number" value={todo.reminderMinute || 0} onChange={e => handleFieldUpdate({ reminderMinute: +e.target.value })} className="h-7 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">秒</label><Input type="number" value={todo.reminderSecond || 0} onChange={e => handleFieldUpdate({ reminderSecond: +e.target.value })} className="h-7 text-xs" /></div>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">创建: {new Date(todo.createdAt).toLocaleString('zh-CN')}</p>
            <p className="text-[10px] text-muted-foreground">更新: {new Date(todo.updatedAt).toLocaleString('zh-CN')}</p>
          </Card>

          {/* Insight Editor */}
          <Card className="p-5 bg-card border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">心得记录</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded ${saveStatus === '已保存' ? 'bg-cat-rest/10 text-cat-rest' : 'bg-cat-entertainment/10 text-cat-entertainment'}`}>
                {saveStatus}
              </span>
            </div>
            <Textarea
              value={insight}
              onChange={e => handleInsightChange(e.target.value)}
              placeholder="记录你的心得和想法..."
              className="min-h-[300px] resize-none text-sm"
            />
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
