import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, WindowClassificationProfile, FocusSubject, FocusQueueItem, PomodoroSettings, TodoTask, TodoArchiveRecord, Category } from '@/types';
import { createInitialState } from '@/data/mockData';

const STORAGE_KEY = 'efficiency-app-state';

function loadState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
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
    setState(s => ({ ...s, queue: q }));
  }, []);

  const addToQueue = useCallback((item: FocusQueueItem) => {
    setState(s => ({ ...s, queue: [...s.queue, { ...item, orderIndex: s.queue.length }] }));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setState(s => ({ ...s, queue: s.queue.filter(x => x.id !== id).map((x, i) => ({ ...x, orderIndex: i })) }));
  }, []);

  const updateSettings = useCallback((partial: Partial<PomodoroSettings>) => {
    setState(s => ({ ...s, pomodoroSettings: { ...s.pomodoroSettings, ...partial } }));
  }, []);

  const addTodo = useCallback((t: TodoTask) => {
    setState(s => ({ ...s, todos: [...s.todos, t] }));
  }, []);

  const updateTodo = useCallback((t: TodoTask) => {
    setState(s => ({ ...s, todos: s.todos.map(x => x.id === t.id ? t : x) }));
  }, []);

  const completeTodo = useCallback((id: string) => {
    setState(s => {
      const task = s.todos.find(t => t.id === id);
      if (!task) return s;
      const now = new Date().toISOString();
      const archive: TodoArchiveRecord = {
        id: `archive-${Date.now()}`,
        taskId: task.id,
        title: task.title,
        completedAt: now,
        insightSnapshot: task.currentInsight,
        taskSnapshotJson: JSON.stringify(task),
        occurrenceIndex: s.archives.filter(a => a.taskId === task.id).length + 1,
      };
      const updatedTask = task.taskType === '重复'
        ? { ...task, currentInsight: '', updatedAt: now }
        : { ...task, isArchived: true, completedAt: now, updatedAt: now };
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
    setState(s => ({ ...s, archives: s.archives.filter(a => a.taskId !== taskId) }));
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
