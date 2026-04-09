import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, WindowClassificationProfile, FocusSubject, FocusQueueItem, PomodoroSettings, TodoTask, TodoArchiveRecord, Category } from '@/types';
import { createInitialState } from '@/data/mockData';
import { buildReminderStamp, normalizeTodoTask, shouldTriggerReminder, validateTodoTask } from '@/lib/todo';
import { toast } from 'sonner';

const STORAGE_KEY = 'efficiency-app-state';

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
    distractionThresholdMinutes: pickNumber(input?.distractionThresholdMinutes, 1, 240, fallback.distractionThresholdMinutes),
    cycleCount: pickNumber(input?.cycleCount, 0, 9999, fallback.cycleCount),
    distractionMode: input?.distractionMode === '累计' ? '累计' : '连续',
    notifyEnabled: input?.notifyEnabled ?? fallback.notifyEnabled,
    soundEnabled: input?.soundEnabled ?? fallback.soundEnabled,
  };
}

function normalizeAppState(raw: unknown): AppState {
  const initial = createInitialState();
  if (!raw || typeof raw !== 'object') {
    return initial;
  }

  const input = raw as Partial<AppState>;
  const profiles = Array.isArray(input.profiles) && input.profiles.length > 0
    ? input.profiles
    : initial.profiles;
  const profileMap = new Map(profiles.map(profile => [profile.classificationKey, profile]));

  const sessions = Array.isArray(input.sessions) ? input.sessions : initial.sessions;
  const subjects = Array.isArray(input.subjects) ? input.subjects : initial.subjects;
  const queue = Array.isArray(input.queue)
    ? input.queue.map((item, index) => ({ ...item, orderIndex: index }))
    : initial.queue;
  const todos = (Array.isArray(input.todos) ? input.todos : initial.todos).map(task => normalizeTodoTask(task));
  const archives = Array.isArray(input.archives) ? input.archives : initial.archives;
  const powerEvents = Array.isArray(input.powerEvents) ? input.powerEvents : initial.powerEvents;
  const pomodoroSettings = normalizePomodoroSettings(input.pomodoroSettings, initial.pomodoroSettings);

  const focusedFromState = input.currentFocusedWindow;
  const currentFocusedWindow = focusedFromState && profileMap.has(focusedFromState.classificationKey)
    ? profileMap.get(focusedFromState.classificationKey) ?? null
    : initial.currentFocusedWindow;

  return {
    profiles,
    sessions,
    subjects,
    queue,
    pomodoroSettings,
    todos,
    archives,
    powerEvents,
    currentFocusedWindow,
    displayMode: input.displayMode === '显示窗口' ? '显示窗口' : '显示性质',
  };
}

function loadState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeAppState(JSON.parse(stored));
    }
  } catch {
    return createInitialState();
  }
  return createInitialState();
}

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
  setDisplayMode: (m: '显示性质' | '显示窗口') => void;
  setCurrentWindow: (w: WindowClassificationProfile) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, 500);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const playNotificationTone = () => {
      try {
        const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
        // Ignore audio failures in restricted browser environments.
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

  // Simulate window focus changes
  useEffect(() => {
    const interval = setInterval(() => {
      const profiles = stateRef.current.profiles;
      const idx = Math.floor(Math.random() * profiles.length);
      setState(s => ({ ...s, currentFocusedWindow: profiles[idx] }));
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const updateProfile = useCallback((id: string, category: Category) => {
    setState(s => ({
      ...s,
      profiles: s.profiles.map(p => p.id === id ? { ...p, category, updatedAt: new Date().toISOString() } : p),
    }));
  }, []);

  const addSubject = useCallback((sub: FocusSubject) => {
    setState(s => ({ ...s, subjects: [...s.subjects, sub] }));
  }, []);

  const updateSubject = useCallback((sub: FocusSubject) => {
    setState(s => ({ ...s, subjects: s.subjects.map(x => x.id === sub.id ? sub : x) }));
  }, []);

  const deleteSubject = useCallback((id: string) => {
    setState(s => ({ ...s, subjects: s.subjects.filter(x => x.id !== id) }));
  }, []);

  const setQueue = useCallback((q: FocusQueueItem[]) => {
    setState(s => ({
      ...s,
      queue: q.map((item, index) => ({ ...item, orderIndex: index })),
    }));
  }, []);

  const addToQueue = useCallback((item: FocusQueueItem) => {
    setState(s => ({
      ...s,
      queue: [...s.queue, { ...item, orderIndex: s.queue.length }],
    }));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setState(s => ({ ...s, queue: s.queue.filter(x => x.id !== id).map((x, i) => ({ ...x, orderIndex: i })) }));
  }, []);

  const updateSettings = useCallback((partial: Partial<PomodoroSettings>) => {
    setState(s => ({
      ...s,
      pomodoroSettings: normalizePomodoroSettings(
        { ...s.pomodoroSettings, ...partial },
        s.pomodoroSettings,
      ),
    }));
  }, []);

  const addTodo = useCallback((t: TodoTask) => {
    const normalized = normalizeTodoTask(t);
    const error = validateTodoTask(normalized);
    if (error) {
      toast.error('创建待办失败', { description: error });
      return;
    }

    setState(s => ({ ...s, todos: [...s.todos, normalized] }));
  }, []);

  const updateTodo = useCallback((t: TodoTask) => {
    const normalized = normalizeTodoTask(t);
    const error = validateTodoTask(normalized);
    if (error) {
      toast.error('更新待办失败', { description: error });
      return;
    }

    setState(s => ({ ...s, todos: s.todos.map(x => x.id === t.id ? normalized : x) }));
  }, []);

  const completeTodo = useCallback((id: string) => {
    setState(s => {
      const task = s.todos.find(t => t.id === id);
      if (!task) return s;
      const now = new Date().toISOString();
      const normalizedTask = normalizeTodoTask(task);
      const archive: TodoArchiveRecord = {
        id: `archive-${Date.now()}`,
        taskId: normalizedTask.id,
        title: normalizedTask.title,
        completedAt: now,
        insightSnapshot: normalizedTask.currentInsight,
        taskSnapshotJson: JSON.stringify(normalizedTask),
        occurrenceIndex: s.archives.filter(a => a.taskId === normalizedTask.id).length + 1,
      };
      const updatedTask = normalizedTask.taskType === '重复'
        ? { ...normalizedTask, currentInsight: '', updatedAt: now }
        : { ...normalizedTask, isArchived: true, completedAt: now, updatedAt: now };
      return {
        ...s,
        todos: s.todos.map(t => t.id === id ? updatedTask : t),
        archives: [...s.archives, archive],
      };
    });
  }, []);

  const deleteTodo = useCallback((id: string) => {
    setState(s => ({ ...s, todos: s.todos.filter(t => t.id !== id) }));
  }, []);

  const deleteArchiveGroup = useCallback((taskId: string) => {
    setState(s => ({
      ...s,
      archives: s.archives.filter(a => a.taskId !== taskId),
      todos: s.todos.filter(todo => !(todo.id === taskId && todo.isArchived)),
    }));
  }, []);

  const setDisplayMode = useCallback((m: '显示性质' | '显示窗口') => {
    setState(s => ({ ...s, displayMode: m }));
  }, []);

  const setCurrentWindow = useCallback((w: WindowClassificationProfile) => {
    setState(s => ({ ...s, currentFocusedWindow: w }));
  }, []);

  return (
    <AppContext.Provider value={{
      state, updateProfile, addSubject, updateSubject, deleteSubject,
      setQueue, addToQueue, removeFromQueue, updateSettings,
      addTodo, updateTodo, completeTodo, deleteTodo, deleteArchiveGroup,
      setDisplayMode, setCurrentWindow,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be inside AppProvider');
  return ctx;
}
