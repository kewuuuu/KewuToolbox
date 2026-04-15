import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FocusSubnav } from '@/components/focus/FocusSubnav';
import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { playSoundById, resolveSoundPlaybackForEvent } from '@/lib/sound';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, RotateCcw, SkipForward, Trash2, GripVertical, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

const FALLBACK_FOCUS_MINUTES = 25;

function clampMinutes(input: number, fallback: number) {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.max(1, Math.min(240, Math.floor(input)));
}

export default function PomodoroPage() {
  const { state, updateSettings, removeFromQueue, addToQueue, setQueue } = useAppState();
  const navigate = useNavigate();
  const settings = state.pomodoroSettings;

  const [secondsLeft, setSecondsLeft] = useState(() => {
    const firstQueueItem = state.queue[0];
    const focusMinutes = clampMinutes(firstQueueItem?.durationMinutes ?? FALLBACK_FOCUS_MINUTES, FALLBACK_FOCUS_MINUTES);
    return focusMinutes * 60;
  });
  const [isRunning, setIsRunning] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentQueueIdx, setCurrentQueueIdx] = useState(0);
  const [offTargetSeconds, setOffTargetSeconds] = useState(0);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const prevQueueIdxRef = useRef(0);
  const timerEndsAtRef = useRef<number | null>(null);
  const distractionAlertedRef = useRef(false);
  const offTargetMsRef = useRef(0);
  const distractionLastTickAtRef = useRef<number | null>(null);
  const focusedClassificationKeyRef = useRef<string | undefined>(state.currentFocusedWindow?.classificationKey);

  const getFocusSecondsForIndex = useCallback(
    (queueIndex: number) => {
      const queueItem = state.queue[queueIndex];
      const focusMinutes = clampMinutes(queueItem?.durationMinutes ?? FALLBACK_FOCUS_MINUTES, FALLBACK_FOCUS_MINUTES);
      return focusMinutes * 60;
    },
    [state.queue],
  );

  const totalSeconds = getFocusSecondsForIndex(currentQueueIdx);
  const progress = totalSeconds > 0 ? ((totalSeconds - secondsLeft) / totalSeconds) * 100 : 0;

  const playCompletionSound = useCallback(() => {
    const playback = resolveSoundPlaybackForEvent(settings, state.soundFiles, 'completion');
    void playSoundById(state.soundFiles, {
      enabled: true,
      soundFileId: playback.soundFileId,
      eventVolumeMultiplier: playback.eventVolumeMultiplier,
    });
  }, [
    settings,
    state.soundFiles,
  ]);

  const playDistractionSound = useCallback(() => {
    const playback = resolveSoundPlaybackForEvent(settings, state.soundFiles, 'distraction');
    void playSoundById(state.soundFiles, {
      enabled: true,
      soundFileId: playback.soundFileId,
      eventVolumeMultiplier: playback.eventVolumeMultiplier,
    });
  }, [
    settings,
    state.soundFiles,
  ]);

  useEffect(() => {
    focusedClassificationKeyRef.current = state.currentFocusedWindow?.classificationKey;
  }, [state.currentFocusedWindow?.classificationKey]);

  const resetDistractionTracking = useCallback(() => {
    distractionAlertedRef.current = false;
    offTargetMsRef.current = 0;
    distractionLastTickAtRef.current = null;
    setOffTargetSeconds(0);
  }, []);

  const pushSystemNotification = useCallback(
    async (title: string, body: string) => {
      if (!settings.notifyEnabled) {
        return;
      }

      if (window.desktopApi?.notify) {
        try {
          await window.desktopApi.notify({ title, body });
          return;
        } catch {
          // Fall through to renderer notification.
        }
      }

      if (!('Notification' in window)) {
        return;
      }

      const notify = () => {
        try {
          new Notification(title, { body });
        } catch {
          // Ignore notification errors.
        }
      };

      if (Notification.permission === 'granted') {
        notify();
        return;
      }
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          notify();
        }
      }
    },
    [settings.notifyEnabled],
  );

  const handleTimerEnd = useCallback((triggeredByTimeout = false) => {
    setIsRunning(false);
    timerEndsAtRef.current = null;
    resetDistractionTracking();

    const currentItem = state.queue[currentQueueIdx];

    if (triggeredByTimeout) {
      playCompletionSound();
      toast.success('专注到点');
      void pushSystemNotification(
        '专注到点提醒',
        currentItem ? `${currentItem.title} 已到点` : '当前专注计划已到点',
      );
    }

    if (state.queue.length === 0) {
      setCurrentCycle(1);
      setCurrentQueueIdx(0);
      setSecondsLeft(FALLBACK_FOCUS_MINUTES * 60);
      return;
    }

    const isInfiniteCycle = settings.cycleCount <= 0;
    const reachedCycleLimit = !isInfiniteCycle && currentCycle >= settings.cycleCount;
    if (reachedCycleLimit) {
      const nextQueueIndex = currentQueueIdx + 1;
      if (nextQueueIndex < state.queue.length) {
        setCurrentQueueIdx(nextQueueIndex);
        setCurrentCycle(1);
        setSecondsLeft(getFocusSecondsForIndex(nextQueueIndex));
        toast.success('当前专注计划完成，已切换到下一个');
        return;
      }

      toast.success('队列全部完成');
      setCurrentQueueIdx(0);
      setCurrentCycle(1);
      setSecondsLeft(getFocusSecondsForIndex(0));
      return;
    }

    setCurrentCycle(cycle => cycle + 1);
    setSecondsLeft(getFocusSecondsForIndex(currentQueueIdx));
    toast.info('开始下一轮专注');
  }, [
    currentCycle,
    currentQueueIdx,
    getFocusSecondsForIndex,
    playCompletionSound,
    pushSystemNotification,
    resetDistractionTracking,
    settings.cycleCount,
    state.queue,
  ]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    if (timerEndsAtRef.current == null) {
      timerEndsAtRef.current = Date.now() + Math.max(0, secondsLeft) * 1000;
    }
    if (distractionLastTickAtRef.current == null) {
      distractionLastTickAtRef.current = Date.now();
    }

    const tick = () => {
      const nowMs = Date.now();
      const timerEndsAt = timerEndsAtRef.current;
      if (timerEndsAt != null) {
        const remainingMs = timerEndsAt - nowMs;
        if (remainingMs <= 0) {
          setSecondsLeft(0);
          handleTimerEnd(true);
          return;
        }
        const nextSeconds = Math.ceil(remainingMs / 1000);
        setSecondsLeft(prev => (prev === nextSeconds ? prev : nextSeconds));
      }

      const currentTickAt = distractionLastTickAtRef.current ?? nowMs;
      const deltaMs = Math.max(0, nowMs - currentTickAt);
      distractionLastTickAtRef.current = nowMs;
      if (deltaMs <= 0) {
        return;
      }

      const currentItem = state.queue[currentQueueIdx];
      const hasTargetWindows = Boolean(currentItem && currentItem.windowGroup.length > 0);
      if (!hasTargetWindows) {
        if (offTargetMsRef.current !== 0 || distractionAlertedRef.current) {
          resetDistractionTracking();
        }
        return;
      }

      const focusedClassificationKey = focusedClassificationKeyRef.current;
      const targetClassificationKeys = new Set(currentItem.windowGroup.map(item => item.classificationKey));
      const onTarget = Boolean(focusedClassificationKey && targetClassificationKeys.has(focusedClassificationKey));

      if (onTarget) {
        if (settings.distractionMode === '连续') {
          if (offTargetMsRef.current !== 0) {
            offTargetMsRef.current = 0;
            setOffTargetSeconds(0);
          }
          distractionAlertedRef.current = false;
        }
        return;
      }

      offTargetMsRef.current += deltaMs;
      const nextOffTargetSeconds = Math.floor(offTargetMsRef.current / 1000);
      setOffTargetSeconds(prev => (prev === nextOffTargetSeconds ? prev : nextOffTargetSeconds));

      const thresholdSeconds = Math.max(1, Math.floor(Number(settings.distractionThresholdMinutes) || 1)) * 60;
      if (!settings.notifyEnabled || nextOffTargetSeconds < thresholdSeconds || distractionAlertedRef.current) {
        return;
      }

      toast.warning('你已偏离专注窗口', {
        description: `已偏离 ${Math.floor(nextOffTargetSeconds / 60)} 分 ${nextOffTargetSeconds % 60} 秒`,
      });
      playDistractionSound();
      void pushSystemNotification(
        '偏离提醒',
        currentItem ? `当前计划「${currentItem.title}」已偏离阈值` : '当前专注已偏离阈值',
      );
      distractionAlertedRef.current = true;
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [
    currentQueueIdx,
    handleTimerEnd,
    isRunning,
    playDistractionSound,
    pushSystemNotification,
    resetDistractionTracking,
    settings.distractionMode,
    settings.distractionThresholdMinutes,
    settings.notifyEnabled,
    state.queue,
  ]);

  useEffect(() => {
    if (currentQueueIdx < state.queue.length) {
      return;
    }
    setCurrentQueueIdx(Math.max(0, state.queue.length - 1));
  }, [currentQueueIdx, state.queue.length]);

  useEffect(() => {
    if (prevQueueIdxRef.current === currentQueueIdx) {
      return;
    }
    prevQueueIdxRef.current = currentQueueIdx;
    if (isRunning) {
      return;
    }
    timerEndsAtRef.current = null;
    distractionLastTickAtRef.current = null;
    setSecondsLeft(getFocusSecondsForIndex(currentQueueIdx));
  }, [currentQueueIdx, getFocusSecondsForIndex, isRunning]);

  const handleStart = () => {
    if (state.queue.length === 0) {
      toast.error('请先添加专注计划');
      return;
    }
    timerEndsAtRef.current = Date.now() + Math.max(0, secondsLeft) * 1000;
    distractionLastTickAtRef.current = Date.now();
    setIsRunning(true);
  };

  const handlePause = () => {
    if (timerEndsAtRef.current != null) {
      const remainingSeconds = Math.max(0, Math.ceil((timerEndsAtRef.current - Date.now()) / 1000));
      setSecondsLeft(remainingSeconds);
    }
    timerEndsAtRef.current = null;
    distractionLastTickAtRef.current = null;
    setIsRunning(false);
  };
  const handleReset = () => {
    setIsRunning(false);
    timerEndsAtRef.current = null;
    setSecondsLeft(getFocusSecondsForIndex(currentQueueIdx));
    resetDistractionTracking();
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
  const hasTargetWindows = Boolean(currentItem && currentItem.windowGroup.length > 0);
  const isOnTarget = hasTargetWindows && fw
    ? currentItem.windowGroup.some(w => w.classificationKey === fw.classificationKey)
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

  const moveQueueItem = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const sourceIndex = state.queue.findIndex(item => item.id === sourceId);
    const targetIndex = state.queue.findIndex(item => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextQueue = [...state.queue];
    const [movedItem] = nextQueue.splice(sourceIndex, 1);
    nextQueue.splice(targetIndex, 0, movedItem);
    setQueue(nextQueue);

    const currentItemId = state.queue[currentQueueIdx]?.id;
    if (!currentItemId) {
      return;
    }
    const nextCurrentQueueIndex = nextQueue.findIndex(item => item.id === currentItemId);
    if (nextCurrentQueueIndex >= 0 && nextCurrentQueueIndex !== currentQueueIdx) {
      setCurrentQueueIdx(nextCurrentQueueIndex);
    }
  };

  return (
    <DashboardLayout pageTitle="番茄钟">
      <div className="max-w-6xl mx-auto space-y-4">
        <FocusSubnav />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-6 bg-card border-border">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  isRunning ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
                }`}>
                  {isRunning ? '专注中' : '待开始'}
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
                    stroke="hsl(var(--primary))"
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
                <span className="text-xs text-muted-foreground">系统通知</span>
                <Switch checked={settings.notifyEnabled} onCheckedChange={value => updateSettings({ notifyEnabled: value })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary/20 p-2">
                <span className="text-xs font-medium text-foreground">提示音配置</span>
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
                {isRunning && (
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        !hasTargetWindows
                          ? 'bg-muted-foreground'
                          : isOnTarget
                            ? 'bg-cat-rest'
                            : 'bg-destructive animate-pulse'
                      }`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {!hasTargetWindows
                        ? '当前计划未指定窗口，不检测偏离'
                        : isOnTarget
                          ? '当前在目标窗口'
                          : `已偏离 ${Math.floor(offTargetSeconds / 60)} 分 ${offTargetSeconds % 60} 秒`}
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
                  } ${
                    dragOverItemId === item.id && draggingItemId !== item.id ? 'ring-1 ring-primary/70' : ''
                  } ${
                    draggingItemId === item.id ? 'opacity-60' : ''
                  }`}
                  onDragOver={event => {
                    if (!draggingItemId || draggingItemId === item.id) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverItemId(item.id);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    if (!draggingItemId) {
                      return;
                    }
                    moveQueueItem(draggingItemId, item.id);
                    setDraggingItemId(null);
                    setDragOverItemId(null);
                  }}
                  onDragEnd={() => {
                    setDraggingItemId(null);
                    setDragOverItemId(null);
                  }}
                >
                  <button
                    type="button"
                    className="text-muted-foreground cursor-grab active:cursor-grabbing"
                    draggable={state.queue.length > 1}
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item.id);
                      setDraggingItemId(item.id);
                      setDragOverItemId(item.id);
                    }}
                    title="拖动调整顺序"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </button>
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
