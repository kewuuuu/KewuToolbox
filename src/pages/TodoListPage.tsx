import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { TodoTask, TaskType, RepeatMode } from '@/types';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { normalizeTodoTask, validateTodoTask } from '@/lib/todo';

export default function TodoListPage() {
  const { state, addTodo, completeTodo } = useAppState();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | '一次性' | '重复'>('all');

  // Form state
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('一次性');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('每日');
  const [weeklyDays, setWeeklyDays] = useState<number[]>([]);
  const [monthlyDays, setMonthlyDays] = useState<number[]>([]);
  const [customPattern, setCustomPattern] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [rYear, setRYear] = useState<string>('');
  const [rMonth, setRMonth] = useState<string>('');
  const [rDay, setRDay] = useState<string>('');
  const [rHour, setRHour] = useState('9');
  const [rMinute, setRMinute] = useState('0');
  const [rSecond, setRSecond] = useState('0');

  const activeTodos = state.todos.filter(t => !t.isArchived);
  const filtered = activeTodos
    .filter(t => filter === 'all' || t.taskType === filter)
    .filter(t => !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleCreate = () => {
    if (!title.trim()) {
      toast.error('创建失败', { description: '标题不能为空' });
      return;
    }

    const now = new Date().toISOString();
    const draft: TodoTask = {
      id: `todo-${Date.now()}`,
      title: title.trim(),
      taskType,
      repeatMode: taskType === '重复' ? repeatMode : undefined,
      weeklyDays: repeatMode === '每周' ? weeklyDays : undefined,
      monthlyDays: repeatMode === '每月' ? monthlyDays : undefined,
      customPattern: repeatMode === '自定义' ? customPattern : undefined,
      reminderEnabled,
      reminderYear: rYear ? +rYear : undefined,
      reminderMonth: rMonth ? +rMonth : undefined,
      reminderDay: rDay ? +rDay : undefined,
      reminderHour: reminderEnabled ? +rHour : undefined,
      reminderMinute: reminderEnabled ? +rMinute : undefined,
      reminderSecond: reminderEnabled ? +rSecond : undefined,
      currentInsight: '',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    const normalized = normalizeTodoTask(draft);
    const error = validateTodoTask(normalized);
    if (error) {
      toast.error('创建失败', { description: error });
      return;
    }

    addTodo(normalized);
    toast.success('待办已创建');
    setTitle('');
    setTaskType('一次性');
    setRepeatMode('每日');
    setWeeklyDays([]);
    setMonthlyDays([]);
    setCustomPattern('');
    setReminderEnabled(false);
    setRYear('');
    setRMonth('');
    setRDay('');
    setRHour('9');
    setRMinute('0');
    setRSecond('0');
    setShowForm(false);
  };

  const handleComplete = (id: string) => {
    completeTodo(id);
    toast.success('已完成并归档');
  };

  const getRecurrenceSummary = (t: TodoTask) => {
    if (t.taskType !== '重复') return '';
    if (t.repeatMode === '每日') return '每日';
    if (t.repeatMode === '每周') return `每周 ${(t.weeklyDays || []).join(',')}`;
    if (t.repeatMode === '每月') return `每月 ${(t.monthlyDays || []).join(',')}日`;
    return `自定义: ${t.customPattern}`;
  };

  const getReminderSummary = (t: TodoTask) => {
    if (!t.reminderEnabled) return '';
    const parts = [];
    if (t.reminderYear) parts.push(`${t.reminderYear}年`);
    if (t.reminderMonth) parts.push(`${t.reminderMonth}月`);
    if (t.reminderDay) parts.push(`${t.reminderDay}日`);
    parts.push(`${t.reminderHour || 0}:${String(t.reminderMinute || 0).padStart(2, '0')}`);
    return parts.join('');
  };

  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <DashboardLayout pageTitle="待办列表">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" className="gap-1" onClick={() => setShowForm(!showForm)}>
            {showForm ? <ChevronUp className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            新建待办
          </Button>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="搜索..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-8 pl-8 text-xs" />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['all', '一次性', '重复'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                {f === 'all' ? '全部' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Create Form */}
        {showForm && (
          <Card className="p-4 bg-card border-border space-y-3">
            <Input placeholder="待办标题" value={title} onChange={e => setTitle(e.target.value)} />
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">任务类型</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['一次性', '重复'] as const).map(t => (
                    <button key={t} onClick={() => setTaskType(t)}
                      className={`px-3 py-1 text-xs ${taskType === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {taskType === '重复' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">周期</label>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {(['每日', '每周', '每月', '自定义'] as const).map(m => (
                      <button key={m} onClick={() => setRepeatMode(m)}
                        className={`px-2 py-1 text-xs ${repeatMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {taskType === '重复' && repeatMode === '每周' && (
              <div className="flex gap-1">
                {dayNames.map((d, i) => (
                  <button key={i} onClick={() => setWeeklyDays(prev => prev.includes(i + 1) ? prev.filter(x => x !== i + 1) : [...prev, i + 1])}
                    className={`w-8 h-8 rounded-full text-xs border transition-colors ${weeklyDays.includes(i + 1) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            {taskType === '重复' && repeatMode === '每月' && (
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <button key={d} onClick={() => setMonthlyDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                    className={`w-7 h-7 rounded-full text-[10px] border transition-colors ${monthlyDays.includes(d) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            {taskType === '重复' && repeatMode === '自定义' && (
              <div>
                <Input placeholder="自定义模式，如: 0,2,3,1,-1" value={customPattern} onChange={e => setCustomPattern(e.target.value)} className="text-xs" />
                <p className="text-[10px] text-muted-foreground mt-1">格式: 执行天数,跳过天数,... 末尾 -1 表示无限循环</p>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
              <span className="text-xs text-muted-foreground">定时提醒</span>
            </div>
            {reminderEnabled && (
              <div className="flex gap-2 items-end">
                <div><label className="text-[10px] text-muted-foreground">年</label><Input value={rYear} onChange={e => setRYear(e.target.value)} placeholder="留空" className="h-7 w-16 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">月</label><Input value={rMonth} onChange={e => setRMonth(e.target.value)} placeholder="留空" className="h-7 w-14 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">日</label><Input value={rDay} onChange={e => setRDay(e.target.value)} placeholder="留空" className="h-7 w-14 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">时</label><Input type="number" value={rHour} onChange={e => setRHour(e.target.value)} className="h-7 w-14 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">分</label><Input type="number" value={rMinute} onChange={e => setRMinute(e.target.value)} className="h-7 w-14 text-xs" /></div>
                <div><label className="text-[10px] text-muted-foreground">秒</label><Input type="number" value={rSecond} onChange={e => setRSecond(e.target.value)} className="h-7 w-14 text-xs" /></div>
              </div>
            )}
            <Button onClick={handleCreate} size="sm">创建</Button>
          </Card>
        )}

        {/* Task Cards */}
        <div className="space-y-1.5">
          {filtered.map(t => (
            <Card key={t.id} className="p-3 bg-card border-border hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/todos/${t.id}`)}>
              <div className="flex items-center gap-3">
                <div onClick={e => { e.stopPropagation(); handleComplete(t.id); }}>
                  <Checkbox />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{t.title}</span>
                    {t.taskType === '重复' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{getRecurrenceSummary(t)}</span>
                    )}
                    {t.reminderEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cat-entertainment/10 text-cat-entertainment">⏰ {getReminderSummary(t)}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    更新于 {new Date(t.updatedAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">无待办事项</p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
