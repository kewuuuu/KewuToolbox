import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FocusSubnav } from '@/components/focus/FocusSubnav';
import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { playSoundById } from '@/lib/sound';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, RotateCcw, SkipForward, Trash2, GripVertical, Settings2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

type TimerMode = '专注' | '休息';

const DEFAULT_BREAK_MINUTES = 5;
const FALLBACK_FOCUS_MINUTES = 25;
const NONE_SOUND_ID = '__none__';

function clampMinutes(input: number, fallback: number) {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.max(1, Math.min(240, Math.floor(input)));
}

function toFinite(value: number | string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export default function PomodoroPage() {
  const { state, updateSettings, removeFromQueue, addToQueue, setQueue } = useAppState();
  const navigate = useNavigate();
  const settings = state.pomodoroSettings;

  const [mode, setMode] = useState<TimerMode>('专注');
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const firstQueueItem = state.queue[0];
    const focusMinutes = clampMinutes(firstQueueItem?.durationMinutes ?? FALLBACK_FOCUS_MINUTES, FALLBACK_FOCUS_MINUTES);
    return focusMinutes * 60;
  });
  const [isRunning, setIsRunning] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentQueueIdx, setCurrentQueueIdx] = useState(0);
  const [offTargetSeconds, setOffTargetSeconds] = useState(0);
  const [soundSettingsExpanded, setSoundSettingsExpanded] = useState(false);
  const intervalRef = useRef<number>();
  const distractionAlertedRef = useRef(false);

  const getFocusSecondsForIndex = useCallback(
    (queueIndex: number) => {
      const queueItem = state.queue[queueIndex];
      const focusMinutes = clampMinutes(queueItem?.durationMinutes ?? FALLBACK_FOCUS_MINUTES, FALLBACK_FOCUS_MINUTES);
      return focusMinutes * 60;
    },
    [state.queue],
  );

  const getBreakSeconds = useCallback(() => DEFAULT_BREAK_MINUTES * 60, []);

  const totalSeconds = mode === '专注' ? getFocusSecondsForIndex(currentQueueIdx) : getBreakSeconds();
  const progress = totalSeconds > 0 ? ((totalSeconds - secondsLeft) / totalSeconds) * 100 : 0;

  const playCompletionSound = useCallback(() => {
    void playSoundById(state.soundFiles, {
      enabled: settings.soundEnabled,
      soundFileId: settings.completionSoundFileId,
      eventVolumeMultiplier: settings.completionVolumeMultiplier,
    });
  }, [
    settings.completionSoundFileId,
    settings.completionVolumeMultiplier,
    settings.soundEnabled,
    state.soundFiles,
  ]);

  const playDistractionSound = useCallback(() => {
    void playSoundById(state.soundFiles, {
      enabled: settings.soundEnabled,
      soundFileId: settings.distractionSoundFileId,
      eventVolumeMultiplier: settings.distractionVolumeMultiplier,
    });
  }, [
    settings.distractionSoundFileId,
    settings.distractionVolumeMultiplier,
    settings.soundEnabled,
    state.soundFiles,
  ]);

  const handleTimerEnd = useCallback((triggeredByTimeout = false) => {
    setIsRunning(false);
    distractionAlertedRef.current = false;
    setOffTargetSeconds(0);

    if (triggeredByTimeout) {
      playCompletionSound();
    }

    if (state.queue.length === 0) {
      setMode('专注');
      setCurrentCycle(1);
      setCurrentQueueIdx(0);
      setSecondsLeft(FALLBACK_FOCUS_MINUTES * 60);
      return;
    }

    if (mode === '专注') {
      toast.success('专注完成，进入短休息');
      setMode('休息');
      setSecondsLeft(getBreakSeconds());
      return;
    }

    const isInfiniteCycle = settings.cycleCount <= 0;
    const reachedCycleLimit = !isInfiniteCycle && currentCycle >= settings.cycleCount;
    if (reachedCycleLimit) {
      const nextQueueIndex = currentQueueIdx + 1;
      if (nextQueueIndex < state.queue.length) {
        setCurrentQueueIdx(nextQueueIndex);
        setCurrentCycle(1);
        setMode('专注');
        setSecondsLeft(getFocusSecondsForIndex(nextQueueIndex));
        toast.success('当前计划完成，已切换到下一项');
        return;
      }

      toast.success('队列全部完成');
      setCurrentQueueIdx(0);
      setCurrentCycle(1);
      setMode('专注');
      setSecondsLeft(getFocusSecondsForIndex(0));
      return;
    }

    setCurrentCycle(cycle => cycle + 1);
    setMode('专注');
    setSecondsLeft(getFocusSecondsForIndex(currentQueueIdx));
    toast.info('休息结束，开始下一轮专注');
  }, [
    currentCycle,
    currentQueueIdx,
    getBreakSeconds,
    getFocusSecondsForIndex,
    mode,
    playCompletionSound,
    settings.cycleCount,
    state.queue.length,
  ]);

  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleTimerEnd(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [handleTimerEnd, isRunning]);

  useEffect(() => {
    if (!isRunning || mode !== '专注') {
      return;
    }

    const currentItem = state.queue[currentQueueIdx];
    if (!currentItem) {
      return;
    }
    const focusedClassificationKey = state.currentFocusedWindow?.classificationKey;
    const targetClassificationKeys = new Set(currentItem.windowGroup.map(item => item.classificationKey));

    const tick = window.setInterval(() => {
      const onTarget = focusedClassificationKey ? targetClassificationKeys.has(focusedClassificationKey) : false;

      setOffTargetSeconds(prev => {
        let next = prev;
        if (onTarget) {
          if (settings.distractionMode === '连续') {
            next = 0;
            distractionAlertedRef.current = false;
          }
        } else {
          next = prev + 1;
        }

        const thresholdSeconds = Math.max(1, settings.distractionThresholdMinutes) * 60;
        if (!onTarget && settings.notifyEnabled && next >= thresholdSeconds && !distractionAlertedRef.current) {
          toast.warning('你已偏离专注窗口', {
            description: `已偏离 ${Math.floor(next / 60)} 分 ${next % 60} 秒`,
          });
          playDistractionSound();
          distractionAlertedRef.current = true;
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [
    currentQueueIdx,
    isRunning,
    mode,
    playDistractionSound,
    settings.distractionMode,
    settings.distractionThresholdMinutes,
    settings.notifyEnabled,
    state.currentFocusedWindow?.classificationKey,
    state.queue,
  ]);

  useEffect(() => {
    if (currentQueueIdx < state.queue.length) {
      return;
    }
    setCurrentQueueIdx(Math.max(0, state.queue.length - 1));
  }, [currentQueueIdx, state.queue.length]);

  useEffect(() => {
    if (isRunning) {
      return;
    }

    if (mode === '专注') {
      setSecondsLeft(getFocusSecondsForIndex(currentQueueIdx));
      return;
    }

    setSecondsLeft(getBreakSeconds());
  }, [currentQueueIdx, getBreakSeconds, getFocusSecondsForIndex, isRunning, mode]);

  const handleStart = () => {
    if (mode === '专注' && state.queue.length === 0) {
      toast.error('请先添加专注计划');
      return;
    }
    setIsRunning(true);
  };

  const handlePause = () => setIsRunning(false);
  const handleReset = () => {
    setIsRunning(false);
    setSecondsLeft(mode === '专注' ? getFocusSecondsForIndex(currentQueueIdx) : getBreakSeconds());
    distractionAlertedRef.current = false;
    setOffTargetSeconds(0);
  };
  const handleSkip = () => {
    setIsRunning(false);
    handleTimerEnd(false);
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
      durationMinutes: clampMinutes(sub.defaultMinutes, FALLBACK_FOCUS_MINUTES),
      windowGroup: sub.windowGroup,
      sourceSubjectId: sub.id,
      orderIndex: state.queue.length,
    });
  };

  const handleDurationChange = (id: string, nextMinutesText: string) => {
    const parsed = Number(nextMinutesText);
    const nextMinutes = clampMinutes(parsed, FALLBACK_FOCUS_MINUTES);
    setQueue(
      state.queue.map(item =>
        item.id === id
          ? { ...item, durationMinutes: nextMinutes }
          : item,
      ),
    );
  };

  const toggleDistractionMode = () => {
    const nextMode = settings.distractionMode === '连续' ? '累计' : '连续';
    updateSettings({ distractionMode: nextMode });
  };

  const handleSelectCompletionSound = (value: string) => {
    updateSettings({ completionSoundFileId: value === NONE_SOUND_ID ? '' : value });
  };

  const handleSelectDistractionSound = (value: string) => {
    updateSettings({ distractionSoundFileId: value === NONE_SOUND_ID ? '' : value });
  };

  const handleTestCompletionSound = async () => {
    if (!settings.completionSoundFileId) {
      toast.info('请先选择到点提示音');
      return;
    }
    try {
      await playSoundById(state.soundFiles, {
        enabled: true,
        soundFileId: settings.completionSoundFileId,
        eventVolumeMultiplier: settings.completionVolumeMultiplier,
      });
    } catch {
      toast.error('试听失败，请检查音频文件');
    }
  };

  const handleTestDistractionSound = async () => {
    if (!settings.distractionSoundFileId) {
      toast.info('请先选择偏离警告音');
      return;
    }
    try {
      await playSoundById(state.soundFiles, {
        enabled: true,
        soundFileId: settings.distractionSoundFileId,
        eventVolumeMultiplier: settings.distractionVolumeMultiplier,
      });
    } catch {
      toast.error('试听失败，请检查音频文件');
    }
  };

  const hasAnySound = state.soundFiles.length > 0;

  return (
    <DashboardLayout pageTitle="番茄钟">
      <div className="max-w-6xl mx-auto space-y-4">
        <FocusSubnav />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-6 bg-card border-border">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  mode === '专注' ? 'bg-primary/20 text-primary' : 'bg-cat-rest/20 text-cat-rest'
                }`}>
                  {mode}
                </span>
                <span className="text-xs text-muted-foreground">
                  周期 {currentCycle}/{settings.cycleCount <= 0 ? '∞' : settings.cycleCount}
                </span>
              </div>

              <div className="relative w-56 h-56 mx-auto">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke={mode === '专注' ? 'hsl(var(--primary))' : 'hsl(var(--cat-rest))'}
                    strokeWidth="3"
                    strokeDasharray={`${progress * 2.827} ${282.7 - progress * 2.827}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-light tabular-nums tracking-wider text-foreground">
                    {formatTime(secondsLeft)}
                  </span>
                  {currentItem && (
                    <span className="text-xs text-muted-foreground mt-1 max-w-[160px] truncate">
                      {currentItem.title}
                    </span>
                  )}
                  {mode === '休息' && (
                    <span className="text-[10px] text-muted-foreground mt-1">固定休息 {DEFAULT_BREAK_MINUTES} 分钟</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-center gap-2">
                {!isRunning ? (
                  <Button onClick={handleStart} className="gap-1">
                    <Play className="w-4 h-4" />
                    开始
                  </Button>
                ) : (
                  <Button onClick={handlePause} variant="secondary" className="gap-1">
                    <Pause className="w-4 h-4" />
                    暂停
                  </Button>
                )}
                <Button onClick={handleReset} variant="outline" size="icon">
                  <RotateCcw className="w-4 h-4" />
                </Button>
                <Button onClick={handleSkip} variant="outline" size="icon">
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                队列进度: {state.queue.length === 0 ? 0 : currentQueueIdx + 1} / {state.queue.length}
              </div>
            </div>
          </Card>

          <Card className="p-5 bg-card border-border space-y-4">
            <h3 className="text-sm font-semibold text-foreground">专注规则</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">循环次数</label>
                <Input
                  type="number"
                  min={0}
                  value={settings.cycleCount}
                  onChange={e => updateSettings({ cycleCount: Number(e.target.value) })}
                  className="h-8 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">偏离阈值 (分钟)</label>
                <Input
                  type="number"
                  min={1}
                  value={settings.distractionThresholdMinutes}
                  onChange={e => updateSettings({ distractionThresholdMinutes: Number(e.target.value) })}
                  className="h-8 mt-1"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">偏离模式</span>
                <Button variant="outline" size="sm" onClick={toggleDistractionMode}>
                  {settings.distractionMode}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">偏离提醒</span>
                <Switch checked={settings.notifyEnabled} onCheckedChange={value => updateSettings({ notifyEnabled: value })} />
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/20 p-2">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => setSoundSettingsExpanded(prev => !prev)}
                >
                  <span className="text-xs font-medium text-foreground">提示音</span>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      soundSettingsExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {soundSettingsExpanded && (
                  <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">提示音总开关</span>
                <Switch checked={settings.soundEnabled} onCheckedChange={value => updateSettings({ soundEnabled: value })} />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-medium text-foreground">提示音</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => navigate('/settings?tab=sounds')}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  设置
                </Button>
              </div>

              {hasAnySound ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">到点提示音</label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={settings.completionSoundFileId || NONE_SOUND_ID}
                        onValueChange={handleSelectCompletionSound}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_SOUND_ID}>不播放</SelectItem>
                          {state.soundFiles.map(sound => (
                            <SelectItem key={sound.id} value={sound.id}>
                              {sound.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.1"
                        value={settings.completionVolumeMultiplier}
                        onChange={event => updateSettings({ completionVolumeMultiplier: toFinite(event.target.value, 1) })}
                        className="h-8 w-24"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleTestCompletionSound()}>
                        试听
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">偏离警告音</label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={settings.distractionSoundFileId || NONE_SOUND_ID}
                        onValueChange={handleSelectDistractionSound}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_SOUND_ID}>不播放</SelectItem>
                          {state.soundFiles.map(sound => (
                            <SelectItem key={sound.id} value={sound.id}>
                              {sound.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.1"
                        value={settings.distractionVolumeMultiplier}
                        onChange={event => updateSettings({ distractionVolumeMultiplier: toFinite(event.target.value, 1) })}
                        className="h-8 w-24"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleTestDistractionSound()}>
                        试听
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无提示音文件，请先进入“提示音管理”添加。</p>
              )}
                  </div>
                )}
              </div>
            </div>

            {fw && (
              <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">当前焦点窗口</h4>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(fw.category) }} />
                  <span className="text-sm text-foreground">{fw.displayName}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${getCategoryColor(fw.category)}22`, color: getCategoryColor(fw.category) }}
                  >
                    {fw.category}
                  </span>
                </div>
                {isRunning && mode === '专注' && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isOnTarget ? 'bg-cat-rest' : 'bg-destructive animate-pulse'}`} />
                    <span className="text-xs text-muted-foreground">
                      {isOnTarget ? '当前在目标窗口' : `已偏离 ${Math.floor(offTargetSeconds / 60)} 分 ${offTargetSeconds % 60} 秒`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-3">专注计划队列</h3>
          {state.queue.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">队列为空，请先从“专注事项”添加计划</p>
          ) : (
            <div className="space-y-1.5">
              {state.queue.map((item, idx) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                    idx === currentQueueIdx ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'
                  }`}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground">{item.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{item.windowGroup.length} 个窗口</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      className="h-7 w-20 text-xs"
                      value={item.durationMinutes}
                      onChange={event => handleDurationChange(item.id, event.target.value)}
                    />
                    <span className="text-[10px] text-muted-foreground">分钟</span>
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
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="从专注事项添加到队列..." />
              </SelectTrigger>
              <SelectContent>
                {state.subjects.map(subject => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.title} ({subject.defaultMinutes} 分钟)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
