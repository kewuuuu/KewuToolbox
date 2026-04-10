import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppUserState,
  Category,
  FocusQueueItem,
  FocusSubject,
  PomodoroSettings,
  TodoArchiveRecord,
  TodoTask,
  WindowClassificationProfile,
} from '@/types';
import { createInitialState } from '@/data/mockData';
import { buildReminderStamp, normalizeTodoTask, shouldTriggerReminder, validateTodoTask } from '@/lib/todo';
import { toast } from 'sonner';

const STORAGE_KEY = 'mindful-desktop-state';

interface AppContextType {
  state: AppState;
  updateProfile: (id: string, category: Category) => void;
  addSubject: (s: FocusSubject) => void;
  updateSubject: (s: FocusSubject) => void;
  deleteSubject: (id: string) => void;
  setQueue: (q: FocusQueueItem[]) => void;
  addToQueue: (item: FocusQueueItem) => void;
  removeFromQueue: (id: string) => void;
  updateSettings: (s: Partial<PomodoroSettings>) => void;
  addTodo: (t: TodoTask) => void;
  updateTodo: (t: TodoTask) => void;
  completeTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  deleteArchiveGroup: (taskId: string) => void;
  setDisplayMode: (m: string) => void;
  setCurrentWindow: (w: WindowClassificationProfile) => void;
}

const AppContext = createContext<AppContextType | null>(null);

function isElectronRuntime() {
  return Boolean(window.desktopApi?.isElectron);
}

function normalizePomodoroSettings(input: Partial<PomodoroSettings> | undefined, fallback: PomodoroSettings): PomodoroSettings {
  const pickNumber = (value: number | undefined, min: number, max: number, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };

  return {
    ...fallback,
    ...input,
    focusMinutes: pickNumber(input?.focusMinutes, 1, 240, fallback.focusMinutes),
    breakMinutes: pickNumber(input?.breakMinutes, 1, 120, fallback.breakMinutes),
    distractionThresholdMinutes: pickNumber(
      input?.distractionThresholdMinutes,
      1,
      240,
      fallback.distractionThresholdMinutes,
    ),
    cycleCount: pickNumber(input?.cycleCount, 0, 9999, fallback.cycleCount),
    distractionMode:
      typeof input?.distractionMode === 'string' && input.distractionMode.trim().length > 0
        ? input.distractionMode
        : fallback.distractionMode,
    notifyEnabled: input?.notifyEnabled ?? fallback.notifyEnabled,
    soundEnabled: input?.soundEnabled ?? fallback.soundEnabled,
  };
}

function normalizeState(raw: unknown): AppState {
  const initial = createInitialState();
  if (!raw || typeof raw !== 'object') {
    return initial;
  }

  const input = raw as Partial<AppState>;
  const profiles = Array.isArray(input.profiles) ? input.profiles : initial.profiles;
  const profileMap = new Map(profiles.map(profile => [profile.classificationKey, profile]));
  const currentFocusedKey = input.currentFocusedWindow?.classificationKey;

  return {
    ...initial,
    ...input,
    profiles,
    sessions: Array.isArray(input.sessions) ? input.sessions : initial.sessions,
    windowStats: Array.isArray(input.windowStats) ? input.windowStats : initial.windowStats,
    subjects: Array.isArray(input.subjects) ? input.subjects : initial.subjects,
    queue: Array.isArray(input.queue)
      ? input.queue.map((item, index) => ({ ...item, orderIndex: index }))
      : initial.queue,
    todos: (Array.isArray(input.todos) ? input.todos : initial.todos).map(task => normalizeTodoTask(task)),
    archives: Array.isArray(input.archives) ? input.archives : initial.archives,
    powerEvents: Array.isArray(input.powerEvents) ? input.powerEvents : initial.powerEvents,
    pomodoroSettings: normalizePomodoroSettings(input.pomodoroSettings, initial.pomodoroSettings),
    currentFocusedWindow: currentFocusedKey ? profileMap.get(currentFocusedKey) ?? null : null,
    displayMode: typeof input.displayMode === 'string' ? input.displayMode : initial.displayMode,
  };
}

function extractUserState(state: AppState): AppUserState {
  return {
    profiles: state.profiles,
    subjects: state.subjects,
    queue: state.queue,
    pomodoroSettings: state.pomodoroSettings,
    todos: state.todos,
    archives: state.archives,
    displayMode: state.displayMode,
  };
}

function mergeLiveState(prev: AppState, incoming: AppState): AppState {
  const localCategoryMap = new Map(prev.profiles.map(profile => [profile.classificationKey, profile.category]));
  const profiles = incoming.profiles.map(profile => ({
    ...profile,
    category: localCategoryMap.get(profile.classificationKey) ?? profile.category,
  }));
  const profileMap = new Map(profiles.map(profile => [profile.classificationKey, profile]));
  const focused = incoming.currentFocusedWindow
    ? profileMap.get(incoming.currentFocusedWindow.classificationKey) ?? incoming.currentFocusedWindow
    : null;

  return {
    ...prev,
    profiles,
    sessions: incoming.sessions,
    windowStats: incoming.windowStats.map(item => ({
      ...item,
      category: localCategoryMap.get(item.classificationKey) ?? item.category,
    })),
    powerEvents: incoming.powerEvents,
    currentFocusedWindow: focused,
  };
}

function loadBrowserState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createInitialState();
    }
    return normalizeState(JSON.parse(stored));
  } catch {
    return createInitialState();
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => (isElectronRuntime() ? createInitialState() : loadBrowserState()));
  const lastSavedUserStateRef = useRef<string>('');

  useEffect(() => {
    if (!isElectronRuntime()) {
      return;
    }

    let disposed = false;
    let unbind: (() => void) | null = null;

    const bootstrap = async () => {
      const remote = await window.desktopApi!.getState();
      if (disposed) {
        return;
      }
      const normalized = normalizeState(remote);
      setState(normalized);
      lastSavedUserStateRef.current = JSON.stringify(extractUserState(normalized));

      unbind = window.desktopApi!.onState(nextState => {
        if (disposed) {
          return;
        }
        setState(prev => mergeLiveState(prev, normalizeState(nextState)));
      });
    };

    void bootstrap();
    return () => {
      disposed = true;
      if (unbind) {
        unbind();
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isElectronRuntime()) {
        const userState = extractUserState(state);
        const snapshot = JSON.stringify(userState);
        if (snapshot === lastSavedUserStateRef.current) {
          return;
        }
        lastSavedUserStateRef.current = snapshot;
        void window.desktopApi?.saveUserState(userState);
        return;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, 300);

    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const playNotificationTone = () => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) {
          return;
        }

        const audioContext = new AudioCtx();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.2);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.22);
        window.setTimeout(() => void audioContext.close(), 260);
      } catch {
        // Ignore audio failure in restricted environments.
      }
    };

    const timer = window.setInterval(() => {
      const now = new Date();
      const dueTitles: string[] = [];
      let shouldPlaySound = false;

      setState(prev => {
        let changed = false;
        const stamp = buildReminderStamp(now);
        const nextTodos = prev.todos.map(todo => {
          if (!shouldTriggerReminder(todo, now)) {
            return todo;
          }

          if (todo.lastReminderStamp === stamp) {
            return todo;
          }

          changed = true;
          dueTitles.push(todo.title);
          shouldPlaySound = true;
          return {
            ...todo,
            lastReminderStamp: stamp,
            updatedAt: now.toISOString(),
          };
        });

        return changed ? { ...prev, todos: nextTodos } : prev;
      });

      if (dueTitles.length === 0) {
        return;
      }

      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          dueTitles.forEach(title => {
            new Notification('待办提醒', { body: title });
          });
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission();
        }
      }

      dueTitles.forEach(title => {
        toast.info('待办提醒', { description: title });
      });

      if (shouldPlaySound) {
        playNotificationTone();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const updateProfile = useCallback((id: string, category: Category) => {
    setState(s => ({
      ...s,
      profiles: s.profiles.map(p =>
        p.id === id ? { ...p, category, updatedAt: new Date().toISOString() } : p,
      ),
      windowStats: s.windowStats.map(item => {
        const profile = s.profiles.find(p => p.classificationKey === item.classificationKey);
        if (!profile || profile.id !== id) {
          return item;
        }
        return { ...item, category };
      }),
    }));
  }, []);

  const addSubject = useCallback((subject: FocusSubject) => {
    setState(s => ({ ...s, subjects: [...s.subjects, subject] }));
  }, []);

  const updateSubject = useCallback((subject: FocusSubject) => {
    setState(s => ({ ...s, subjects: s.subjects.map(item => (item.id === subject.id ? subject : item)) }));
  }, []);

  const deleteSubject = useCallback((id: string) => {
    setState(s => ({ ...s, subjects: s.subjects.filter(item => item.id !== id) }));
  }, []);

  const setQueue = useCallback((queue: FocusQueueItem[]) => {
    setState(s => ({
      ...s,
      queue: queue.map((item, index) => ({ ...item, orderIndex: index })),
    }));
  }, []);

  const addToQueue = useCallback((item: FocusQueueItem) => {
    setState(s => ({
      ...s,
      queue: [...s.queue, { ...item, orderIndex: s.queue.length }],
    }));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setState(s => ({
      ...s,
      queue: s.queue.filter(item => item.id !== id).map((item, index) => ({ ...item, orderIndex: index })),
    }));
  }, []);

  const updateSettings = useCallback((partial: Partial<PomodoroSettings>) => {
    setState(s => ({
      ...s,
      pomodoroSettings: normalizePomodoroSettings({ ...s.pomodoroSettings, ...partial }, s.pomodoroSettings),
    }));
  }, []);

  const addTodo = useCallback((todo: TodoTask) => {
    const normalized = normalizeTodoTask(todo);
    const error = validateTodoTask(normalized);
    if (error) {
      toast.error('创建待办失败', { description: error });
      return;
    }

    setState(s => ({ ...s, todos: [...s.todos, normalized] }));
  }, []);

  const updateTodo = useCallback((todo: TodoTask) => {
    const normalized = normalizeTodoTask(todo);
    const error = validateTodoTask(normalized);
    if (error) {
      toast.error('更新待办失败', { description: error });
      return;
    }

    setState(s => ({
      ...s,
      todos: s.todos.map(item => (item.id === normalized.id ? normalized : item)),
    }));
  }, []);

  const completeTodo = useCallback((id: string) => {
    setState(s => {
      const task = s.todos.find(item => item.id === id);
      if (!task) {
        return s;
      }

      const now = new Date().toISOString();
      const normalizedTask = normalizeTodoTask(task);
      const archive: TodoArchiveRecord = {
        id: `archive-${Date.now()}`,
        taskId: normalizedTask.id,
        title: normalizedTask.title,
        completedAt: now,
        insightSnapshot: normalizedTask.currentInsight,
        taskSnapshotJson: JSON.stringify(normalizedTask),
        occurrenceIndex: s.archives.filter(item => item.taskId === normalizedTask.id).length + 1,
      };

      const updatedTask =
        normalizedTask.taskType === '重复'
          ? { ...normalizedTask, currentInsight: '', updatedAt: now }
          : { ...normalizedTask, isArchived: true, completedAt: now, updatedAt: now };

      return {
        ...s,
        todos: s.todos.map(item => (item.id === id ? updatedTask : item)),
        archives: [...s.archives, archive],
      };
    });
  }, []);

  const deleteTodo = useCallback((id: string) => {
    setState(s => ({ ...s, todos: s.todos.filter(todo => todo.id !== id) }));
  }, []);

  const deleteArchiveGroup = useCallback((taskId: string) => {
    setState(s => ({
      ...s,
      archives: s.archives.filter(record => record.taskId !== taskId),
      todos: s.todos.filter(todo => !(todo.id === taskId && todo.isArchived)),
    }));
  }, []);

  const setDisplayMode = useCallback((mode: string) => {
    setState(s => ({ ...s, displayMode: mode }));
  }, []);

  const setCurrentWindow = useCallback((windowProfile: WindowClassificationProfile) => {
    setState(s => ({ ...s, currentFocusedWindow: windowProfile }));
  }, []);

  const value = useMemo<AppContextType>(
    () => ({
      state,
      updateProfile,
      addSubject,
      updateSubject,
      deleteSubject,
      setQueue,
      addToQueue,
      removeFromQueue,
      updateSettings,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      deleteArchiveGroup,
      setDisplayMode,
      setCurrentWindow,
    }),
    [
      state,
      updateProfile,
      addSubject,
      updateSubject,
      deleteSubject,
      setQueue,
      addToQueue,
      removeFromQueue,
      updateSettings,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      deleteArchiveGroup,
      setDisplayMode,
      setCurrentWindow,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used inside AppProvider');
  }
  return context;
}
