import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { CountdownTask, StopwatchLap, StopwatchRecord } from '@/types';
import { playSoundById, resolveSoundPlaybackForEvent } from '@/lib/sound';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Pause, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type ClockTab = 'stopwatch' | 'countdown' | 'records';

const FALLBACK_COUNTDOWN_SECONDS = 5 * 60;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toClockTab(input: string | null): ClockTab {
  if (input === 'countdown' || input === 'records') {
    return input;
  }
  return 'stopwatch';
}

function pad(num: number, width = 2) {
  return Math.max(0, Math.floor(num)).toString().padStart(width, '0');
}

function formatElapsedMs(ms: number) {
  const clamped = Math.max(0, Math.floor(ms));
  const centiseconds = Math.floor((clamped % 1000) / 10);
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function formatSeconds(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const seconds = clamped % 60;
  const minutes = Math.floor(clamped / 60) % 60;
  const hours = Math.floor(clamped / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    hour12: false,
  });
}

function calcCountdownRemaining(task: CountdownTask, nowMs: number) {
  if (!task.isRunning || !task.runStartedAt) {
    return Math.max(0, Math.floor(task.remainingSeconds));
  }
  const startedAtMs = new Date(task.runStartedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return Math.max(0, Math.floor(task.remainingSeconds));
  }
  const base = Number.isFinite(task.runInitialRemainingSeconds)
    ? Math.max(0, Math.floor(task.runInitialRemainingSeconds ?? task.remainingSeconds))
    : Math.max(0, Math.floor(task.remainingSeconds));
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  return Math.max(0, Math.ceil(base - elapsedSeconds));
}

export default function ClockPage() {
  const { state, setStopwatchRecords, setCountdownTasks } = useAppState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = toClockTab(searchParams.get('tab'));

  const [isRunning, setIsRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [laps, setLaps] = useState<StopwatchLap[]>([]);
  const [newCountdownTitle, setNewCountdownTitle] = useState('');
  const [newCountdownSeconds, setNewCountdownSeconds] = useState(String(FALLBACK_COUNTDOWN_SECONDS));
  const [pendingDeleteRecordId, setPendingDeleteRecordId] = useState<string | null>(null);
  const stopwatchStartedAtRef = useRef<number | null>(null);
  const stopwatchBaseElapsedRef = useRef(0);

  const sortedRecords = useMemo(
    () =>
      [...state.stopwatchRecords].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      ),
    [state.stopwatchRecords],
  );

  const updateTab = (nextTab: string) => {
    const normalized = toClockTab(nextTab);
    setSearchParams({ tab: normalized });
  };

  const pushSystemNotification = useCallback(async (title: string, body: string) => {
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
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const tick = window.setInterval(() => {
      const startAtMs = stopwatchStartedAtRef.current;
      if (!startAtMs) {
        return;
      }
      const nowMs = Date.now();
      setElapsedMs(stopwatchBaseElapsedRef.current + (nowMs - startAtMs));
    }, 10);
    return () => clearInterval(tick);
  }, [isRunning]);

  useEffect(() => {
    const hasRunningCountdown = state.countdownTasks.some(task => task.isRunning && !task.completed);
    if (!hasRunningCountdown) {
      return;
    }

    const tick = window.setInterval(() => {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let changed = false;
      const completedTitles: string[] = [];
      const nextTasks: CountdownTask[] = [];

      for (const task of state.countdownTasks) {
        if (!task.isRunning || task.completed) {
          nextTasks.push(task);
          continue;
        }

        const remainingSeconds = calcCountdownRemaining(task, nowMs);
        if (remainingSeconds > 0) {
          if (remainingSeconds === task.remainingSeconds) {
            nextTasks.push(task);
            continue;
          }
          changed = true;
          nextTasks.push({
            ...task,
            remainingSeconds,
            updatedAt: nowIso,
          });
          continue;
        }

        changed = true;
        completedTitles.push(task.title);
        if (state.preferences.countdownCompletedTaskBehavior === 'delete') {
          continue;
        }
        nextTasks.push({
          ...task,
          isRunning: false,
          completed: true,
          remainingSeconds: 0,
          runStartedAt: undefined,
          runInitialRemainingSeconds: undefined,
          completedAt: nowIso,
          updatedAt: nowIso,
        });
      }

      if (!changed) {
        return;
      }

      setCountdownTasks(nextTasks);

      for (const title of completedTitles) {
        toast.success('倒计时已完成', { description: title });
        void pushSystemNotification('倒计时到点提醒', `${title} 已完成`);
        const playback = resolveSoundPlaybackForEvent(state.pomodoroSettings, state.soundFiles, 'countdown');
        void playSoundById(state.soundFiles, {
          enabled: true,
          soundFileId: playback.soundFileId,
          eventVolumeMultiplier: playback.eventVolumeMultiplier,
        });
      }
    }, 200);

    return () => clearInterval(tick);
  }, [
    pushSystemNotification,
    setCountdownTasks,
    state.countdownTasks,
    state.pomodoroSettings,
    state.preferences.countdownCompletedTaskBehavior,
    state.soundFiles,
  ]);

  const handleStartStopwatch = () => {
    if (isRunning) {
      return;
    }
    const nowMs = Date.now();
    if (!sessionStartedAt) {
      setSessionStartedAt(new Date(nowMs).toISOString());
    }
    stopwatchStartedAtRef.current = nowMs;
    setIsRunning(true);
  };

  const handlePauseStopwatch = () => {
    if (!isRunning) {
      return;
    }
    const startAtMs = stopwatchStartedAtRef.current;
    if (startAtMs) {
      const currentElapsedMs = stopwatchBaseElapsedRef.current + (Date.now() - startAtMs);
      stopwatchBaseElapsedRef.current = currentElapsedMs;
      setElapsedMs(currentElapsedMs);
    }
    stopwatchStartedAtRef.current = null;
    setIsRunning(false);
  };

  const handleResetStopwatch = () => {
    setIsRunning(false);
    stopwatchStartedAtRef.current = null;
    stopwatchBaseElapsedRef.current = 0;
    setElapsedMs(0);
    setLaps([]);
    setSessionStartedAt(null);
  };

  const handleLap = () => {
    if (!isRunning) {
      return;
    }
    const startAtMs = stopwatchStartedAtRef.current;
    if (!startAtMs) {
      return;
    }
    const currentElapsedMs = stopwatchBaseElapsedRef.current + (Date.now() - startAtMs);
    const previousElapsedMs = laps.length > 0 ? laps[laps.length - 1].elapsedMs : 0;
    const nextLap: StopwatchLap = {
      id: makeId('lap'),
      elapsedMs: currentElapsedMs,
      splitMs: currentElapsedMs - previousElapsedMs,
      note: '',
      createdAt: new Date().toISOString(),
    };
    setElapsedMs(currentElapsedMs);
    setLaps(prev => [...prev, nextLap]);
  };

  const handleUpdateLapNote = (lapId: string, note: string) => {
    setLaps(prev => prev.map(lap => (lap.id === lapId ? { ...lap, note } : lap)));
  };

  const handleSaveStopwatchRecord = () => {
    const runningStartAtMs = stopwatchStartedAtRef.current;
    const finalElapsedMs =
      isRunning && runningStartAtMs
        ? stopwatchBaseElapsedRef.current + (Date.now() - runningStartAtMs)
        : elapsedMs;

    if (!sessionStartedAt || finalElapsedMs <= 0) {
      toast.error('秒表尚未开始或时长为 0');
      return;
    }
    if (isRunning) {
      handlePauseStopwatch();
    }

    const endIso = new Date().toISOString();
    const defaultName = `${formatDateTime(sessionStartedAt)} - ${formatDateTime(endIso)}`;
    const record: StopwatchRecord = {
      id: makeId('sw'),
      name: defaultName,
      startedAt: sessionStartedAt,
      endedAt: endIso,
      totalElapsedMs: Math.max(0, Math.floor(finalElapsedMs)),
      laps: laps.map(item => ({ ...item })),
      createdAt: endIso,
      updatedAt: endIso,
    };
    setStopwatchRecords([record, ...state.stopwatchRecords]);
    toast.success('已保存秒表记录');
    handleResetStopwatch();
    setSearchParams({ tab: 'records' });
  };

  const handleRenameRecord = (recordId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const now = new Date().toISOString();
    setStopwatchRecords(
      state.stopwatchRecords.map(record =>
        record.id === recordId
          ? { ...record, name: trimmed, updatedAt: now }
          : record,
      ),
    );
  };

  const handleDeleteRecord = (recordId: string) => {
    setStopwatchRecords(state.stopwatchRecords.filter(record => record.id !== recordId));
    setPendingDeleteRecordId(null);
  };

  const handleCreateCountdownTask = () => {
    const durationRaw = Number(newCountdownSeconds);
    if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
      toast.error('倒计时秒数必须大于 0');
      return;
    }
    const durationSeconds = Math.floor(durationRaw);
    const now = new Date().toISOString();
    const task: CountdownTask = {
      id: makeId('cd'),
      title: newCountdownTitle.trim() || `倒计时 ${formatSeconds(durationSeconds)}`,
      durationSeconds,
      remainingSeconds: durationSeconds,
      isRunning: false,
      completed: false,
      createdAt: now,
      updatedAt: now,
    };
    setCountdownTasks([task, ...state.countdownTasks]);
    setNewCountdownTitle('');
    setNewCountdownSeconds(String(FALLBACK_COUNTDOWN_SECONDS));
  };

  const handleUpdateCountdownTask = (taskId: string, patch: Partial<CountdownTask>) => {
    const now = new Date().toISOString();
    setCountdownTasks(
      state.countdownTasks.map(task =>
        task.id === taskId
          ? { ...task, ...patch, updatedAt: now }
          : task,
      ),
    );
  };

  const handleToggleCountdownRunning = (taskId: string) => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    setCountdownTasks(
      state.countdownTasks.map(task => {
        if (task.id !== taskId || task.completed) {
          return task;
        }

        if (!task.isRunning) {
          return {
            ...task,
            isRunning: true,
            runStartedAt: nowIso,
            runInitialRemainingSeconds: Math.max(0, Math.floor(task.remainingSeconds)),
            updatedAt: nowIso,
          };
        }

        const remainingSeconds = calcCountdownRemaining(task, nowMs);
        return {
          ...task,
          isRunning: false,
          remainingSeconds,
          runStartedAt: undefined,
          runInitialRemainingSeconds: undefined,
          updatedAt: nowIso,
        };
      }),
    );
  };

  const handleApplyCountdownDuration = (taskId: string) => {
    const nowIso = new Date().toISOString();
    setCountdownTasks(
      state.countdownTasks.map(task => {
        if (task.id !== taskId || task.isRunning) {
          return task;
        }
        const normalizedDuration = Math.max(1, Math.floor(task.durationSeconds));
        return {
          ...task,
          durationSeconds: normalizedDuration,
          remainingSeconds: normalizedDuration,
          completed: false,
          completedAt: undefined,
          runStartedAt: undefined,
          runInitialRemainingSeconds: undefined,
          updatedAt: nowIso,
        };
      }),
    );
  };

  const handleDeleteCountdownTask = (taskId: string) => {
    setCountdownTasks(state.countdownTasks.filter(task => task.id !== taskId));
  };

  return (
    <DashboardLayout pageTitle="时钟">
      <div className="max-w-6xl mx-auto">
        <Tabs value={tab} onValueChange={updateTab} className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="stopwatch">秒表</TabsTrigger>
            <TabsTrigger value="countdown">倒计时</TabsTrigger>
            <TabsTrigger value="records">秒表记录</TabsTrigger>
          </TabsList>

          <TabsContent value="stopwatch">
            <Card className="p-5 bg-card border-border space-y-4">
              <div className="text-center space-y-2">
                <p className="text-xs text-muted-foreground">精度 0.01 秒</p>
                <div className="text-5xl font-light tabular-nums tracking-wider text-foreground">
                  {formatElapsedMs(elapsedMs)}
                </div>
                <div className="flex items-center justify-center gap-2">
                  {!isRunning ? (
                    <Button onClick={handleStartStopwatch} className="gap-1">
                      <Play className="w-4 h-4" />
                      开始
                    </Button>
                  ) : (
                    <Button onClick={handlePauseStopwatch} variant="secondary" className="gap-1">
                      <Pause className="w-4 h-4" />
                      暂停
                    </Button>
                  )}
                  <Button onClick={handleLap} variant="outline" disabled={!isRunning}>
                    断点
                  </Button>
                  <Button onClick={handleSaveStopwatchRecord} variant="outline" disabled={elapsedMs <= 0}>
                    <Save className="w-4 h-4 mr-1" />
                    结束并保存
                  </Button>
                  <Button onClick={handleResetStopwatch} variant="ghost">
                    <RotateCcw className="w-4 h-4 mr-1" />
                    重置
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">当前断点列表</h3>
                {laps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无断点，点击“断点”可记录中间时刻。</p>
                ) : (
                  <div className="space-y-2">
                    {laps.map((lap, index) => (
                      <div key={lap.id} className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1.6fr] gap-2 items-center p-2 rounded-lg border border-border/70">
                        <span className="text-xs text-muted-foreground">#{index + 1}</span>
                        <span className="text-sm font-mono text-foreground">{formatElapsedMs(lap.elapsedMs)}</span>
                        <span className="text-sm font-mono text-muted-foreground">+{formatElapsedMs(lap.splitMs)}</span>
                        <Input
                          value={lap.note}
                          onChange={event => handleUpdateLapNote(lap.id, event.target.value)}
                          placeholder="备注"
                          className="h-8"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="countdown">
            <Card className="p-5 bg-card border-border space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">新建倒计时任务</h3>
                <div className="grid grid-cols-1 md:grid-cols-[1.2fr_180px_auto] gap-2">
                  <Input
                    value={newCountdownTitle}
                    onChange={event => setNewCountdownTitle(event.target.value)}
                    placeholder="任务名称（可选）"
                    className="h-8"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={newCountdownSeconds}
                    onChange={event => setNewCountdownSeconds(event.target.value)}
                    placeholder="时长（秒）"
                    className="h-8"
                  />
                  <Button onClick={handleCreateCountdownTask} className="gap-1">
                    <Plus className="w-4 h-4" />
                    添加
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  到点将触发系统通知与提示音。完成后处理方式可在“设置 - 通用配置”调整。
                </p>
              </div>

              <div className="space-y-2">
                {state.countdownTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">暂无倒计时任务</p>
                ) : (
                  state.countdownTasks.map(task => (
                    <div
                      key={task.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        task.completed ? 'border-border/60 bg-secondary/20 cursor-pointer' : 'border-border'
                      }`}
                      onClick={() => {
                        if (task.completed) {
                          handleDeleteCountdownTask(task.id);
                        }
                      }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_120px_140px_auto] gap-2 items-center">
                        <Input
                          value={task.title}
                          onClick={event => event.stopPropagation()}
                          onChange={event => handleUpdateCountdownTask(task.id, { title: event.target.value })}
                          disabled={task.completed}
                          className={task.completed ? 'line-through text-muted-foreground' : ''}
                        />
                        <Input
                          type="number"
                          min={1}
                          value={task.durationSeconds}
                          onClick={event => event.stopPropagation()}
                          onChange={event =>
                            handleUpdateCountdownTask(task.id, {
                              durationSeconds: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                            })
                          }
                          disabled={task.isRunning || task.completed}
                          className="h-8"
                        />
                        <div className="text-sm font-mono text-foreground">{formatSeconds(task.remainingSeconds)}</div>
                        <div className="flex items-center gap-1 justify-end">
                          {!task.completed && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant={task.isRunning ? 'secondary' : 'outline'}
                                onClick={event => {
                                  event.stopPropagation();
                                  handleToggleCountdownRunning(task.id);
                                }}
                              >
                                {task.isRunning ? '暂停' : '开始'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={event => {
                                  event.stopPropagation();
                                  handleApplyCountdownDuration(task.id);
                                }}
                                disabled={task.isRunning}
                              >
                                应用修改
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            onClick={event => {
                              event.stopPropagation();
                              handleDeleteCountdownTask(task.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {task.completed && (
                        <p className="text-xs text-muted-foreground mt-2">
                          已完成，点击该任务可直接删除。
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="records">
            <Card className="p-5 bg-card border-border space-y-3">
              <h3 className="text-sm font-semibold text-foreground">秒表记录</h3>
              {sortedRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">暂无秒表记录</p>
              ) : (
                sortedRecords.map(record => (
                  <div key={record.id} className="p-3 rounded-lg border border-border/70">
                    <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto_auto] gap-2 items-center">
                      <Input
                        value={record.name}
                        onChange={event => handleRenameRecord(record.id, event.target.value)}
                        className="h-8"
                      />
                      <span className="text-xs text-muted-foreground">{formatDateTime(record.startedAt)}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(record.endedAt)}</span>
                      <span className="text-sm font-mono text-foreground">{formatElapsedMs(record.totalElapsedMs)}</span>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/clock/records/${record.id}`)}>
                        详情
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setPendingDeleteRecordId(record.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={Boolean(pendingDeleteRecordId)} onOpenChange={open => !open && setPendingDeleteRecordId(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除秒表记录</AlertDialogTitle>
            <AlertDialogDescription>
              删除后不可恢复，请确认是否继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeleteRecordId) {
                  handleDeleteRecord(pendingDeleteRecordId);
                }
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
