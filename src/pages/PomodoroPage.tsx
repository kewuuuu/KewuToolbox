import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, RotateCcw, SkipForward, Trash2, GripVertical, Plus } from 'lucide-react';
import { FocusQueueItem } from '@/types';
import { toast } from 'sonner';

type TimerMode = '专注' | '休息';

export default function PomodoroPage() {
  const { state, updateSettings, setQueue, removeFromQueue, addToQueue } = useAppState();
  const settings = state.pomodoroSettings;

  const [mode, setMode] = useState<TimerMode>('专注');
  const [secondsLeft, setSecondsLeft] = useState(settings.focusMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentQueueIdx, setCurrentQueueIdx] = useState(0);
  const [offTargetSeconds, setOffTargetSeconds] = useState(0);
  const intervalRef = useRef<number>();

  const totalSeconds = mode === '专注' ? settings.focusMinutes * 60 : settings.breakMinutes * 60;
  const progress = ((totalSeconds - secondsLeft) / totalSeconds) * 100;

  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleTimerEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [isRunning, mode]);

  // Simulate off-target detection
  useEffect(() => {
    if (!isRunning || mode !== '专注') return;
    const currentItem = state.queue[currentQueueIdx];
    if (!currentItem || !state.currentFocusedWindow) return;
    const isOnTarget = currentItem.windowGroup.some(
      w => w.classificationKey === state.currentFocusedWindow?.classificationKey
    );
    if (!isOnTarget) {
      setOffTargetSeconds(prev => {
        const next = prev + 1;
        if (next >= settings.distractionThresholdMinutes * 60 && settings.notifyEnabled) {
          toast.warning('⚠️ 你已偏离专注目标！', { description: `已偏离 ${Math.floor(next / 60)} 分钟` });
        }
        return next;
      });
    }
  }, [state.currentFocusedWindow, isRunning]);

  const handleTimerEnd = useCallback(() => {
    setIsRunning(false);
    if (mode === '专注') {
      toast.success('🎉 专注完成！', { description: '休息一下吧' });
      setMode('休息');
      setSecondsLeft(settings.breakMinutes * 60);
    } else {
      if (currentCycle < settings.cycleCount) {
        setCurrentCycle(c => c + 1);
        setMode('专注');
        setSecondsLeft(settings.focusMinutes * 60);
        toast.info('休息结束，开始下一个专注周期');
      } else {
        toast.success('🏆 所有周期已完成！');
        setCurrentCycle(1);
        setCurrentQueueIdx(prev => Math.min(prev + 1, state.queue.length - 1));
      }
    }
    setOffTargetSeconds(0);
  }, [mode, currentCycle, settings]);

  const handleStart = () => setIsRunning(true);
  const handlePause = () => setIsRunning(false);
  const handleReset = () => {
    setIsRunning(false);
    setSecondsLeft(mode === '专注' ? settings.focusMinutes * 60 : settings.breakMinutes * 60);
    setOffTargetSeconds(0);
  };
  const handleSkip = () => {
    setIsRunning(false);
    handleTimerEnd();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const fw = state.currentFocusedWindow;
  const currentItem = state.queue[currentQueueIdx];
  const isOnTarget = currentItem && fw
    ? currentItem.windowGroup.some(w => w.classificationKey === fw?.classificationKey)
    : false;

  const handleAddSubjectToQueue = (subjectId: string) => {
    const sub = state.subjects.find(s => s.id === subjectId);
    if (!sub) return;
    addToQueue({
      id: `q-${Date.now()}`,
      itemType: 'Subject',
      title: sub.title,
      durationMinutes: sub.defaultMinutes,
      windowGroup: sub.windowGroup,
      sourceSubjectId: sub.id,
      orderIndex: state.queue.length,
    });
  };

  return (
    <DashboardLayout pageTitle="番茄钟">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Timer Card */}
          <Card className="p-6 bg-card border-border">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  mode === '专注' ? 'bg-primary/20 text-primary' : 'bg-cat-rest/20 text-cat-rest'
                }`}>
                  {mode}
                </span>
                <span className="text-xs text-muted-foreground">
                  周期 {currentCycle}/{settings.cycleCount}
                </span>
              </div>

              {/* Circular progress */}
              <div className="relative w-56 h-56 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                  <circle cx="50" cy="50" r="45" fill="none" stroke={mode === '专注' ? 'hsl(var(--primary))' : 'hsl(var(--cat-rest))'} strokeWidth="3"
                    strokeDasharray={`${progress * 2.827} ${282.7 - progress * 2.827}`}
                    strokeLinecap="round" className="transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-light tabular-nums tracking-wider text-foreground">
                    {formatTime(secondsLeft)}
                  </span>
                  {currentItem && (
                    <span className="text-xs text-muted-foreground mt-1 max-w-[140px] truncate">
                      {currentItem.title}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-center gap-2">
                {!isRunning ? (
                  <Button onClick={handleStart} className="gap-1"><Play className="w-4 h-4" /> 开始</Button>
                ) : (
                  <Button onClick={handlePause} variant="secondary" className="gap-1"><Pause className="w-4 h-4" /> 暂停</Button>
                )}
                <Button onClick={handleReset} variant="outline" size="icon"><RotateCcw className="w-4 h-4" /></Button>
                <Button onClick={handleSkip} variant="outline" size="icon"><SkipForward className="w-4 h-4" /></Button>
              </div>

              <div className="text-xs text-muted-foreground">
                队列进度: {currentQueueIdx + 1} / {Math.max(state.queue.length, 1)}
              </div>
            </div>
          </Card>

          {/* Settings Card */}
          <Card className="p-5 bg-card border-border space-y-4">
            <h3 className="text-sm font-semibold text-foreground">设置</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">专注时长 (分钟)</label>
                <Input type="number" value={settings.focusMinutes} onChange={e => updateSettings({ focusMinutes: +e.target.value })} className="h-8 mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">休息时长 (分钟)</label>
                <Input type="number" value={settings.breakMinutes} onChange={e => updateSettings({ breakMinutes: +e.target.value })} className="h-8 mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">循环次数</label>
                <Input type="number" value={settings.cycleCount} onChange={e => updateSettings({ cycleCount: +e.target.value })} className="h-8 mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">偏离阈值 (分钟)</label>
                <Input type="number" value={settings.distractionThresholdMinutes} onChange={e => updateSettings({ distractionThresholdMinutes: +e.target.value })} className="h-8 mt-1" />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">偏离计算模式</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(['连续', '累计'] as const).map(m => (
                    <button key={m} onClick={() => updateSettings({ distractionMode: m })}
                      className={`flex-1 py-1.5 text-xs transition-colors ${settings.distractionMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">偏离提醒</span>
                <Switch checked={settings.notifyEnabled} onCheckedChange={v => updateSettings({ notifyEnabled: v })} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">提示音</span>
                <Switch checked={settings.soundEnabled} onCheckedChange={v => updateSettings({ soundEnabled: v })} />
              </div>
            </div>

            {/* Current Focus Status */}
            {fw && (
              <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">当前焦点窗口</h4>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(fw.category) }} />
                  <span className="text-sm text-foreground">{fw.displayName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: getCategoryColor(fw.category) + '22', color: getCategoryColor(fw.category) }}>
                    {fw.category}
                  </span>
                </div>
                {isRunning && mode === '专注' && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isOnTarget ? 'bg-cat-rest' : 'bg-destructive animate-pulse'}`} />
                    <span className="text-xs text-muted-foreground">
                      {isOnTarget ? '目标窗口' : `偏离 ${Math.floor(offTargetSeconds / 60)}分${offTargetSeconds % 60}秒`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Queue Section */}
        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-3">专注队列</h3>
          {state.queue.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">队列为空，请添加专注事项</p>
          ) : (
            <div className="space-y-1.5">
              {state.queue.map((item, idx) => (
                <div key={item.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                  idx === currentQueueIdx ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'
                }`}>
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{item.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{item.durationMinutes}分钟</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{item.windowGroup.length}个窗口</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {item.itemType === 'Subject' ? '事项' : '临时'}
                  </span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeFromQueue(item.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Select onValueChange={handleAddSubjectToQueue}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="从专注事项添加..." />
              </SelectTrigger>
              <SelectContent>
                {state.subjects.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.title} ({s.defaultMinutes}分钟)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
