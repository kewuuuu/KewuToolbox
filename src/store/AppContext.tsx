import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppPreferences,
  AppUserState,
  Category,
  CountdownTask,
  FocusQueueItem,
  FocusSubject,
  ProcessTag,
  ProcessBlacklistRule,
  PomodoroSettings,
  UrlWhitelistRule,
  SoundFileItem,
  StopwatchRecord,
  TodoArchiveRecord,
  TodoTask,
  WindowClassificationProfile,
} from '@/types';
import { createInitialState } from '@/data/mockData';
import { createDefaultSoundFiles } from '@/data/defaultSoundFiles';
import { buildReminderStamp, normalizeTodoTask, shouldTriggerReminder, validateTodoTask } from '@/lib/todo';
import { playSoundById } from '@/lib/sound';
import { toast } from 'sonner';

const STORAGE_KEY = 'kewu-toolbox-state';

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
  setStopwatchRecords: (records: StopwatchRecord[]) => void;
  setCountdownTasks: (tasks: CountdownTask[]) => void;
  updatePreferences: (p: Partial<AppPreferences>) => void;
  clearAllData: () => Promise<void>;
  addSoundFile: (name: string, filePath: string, defaultVolumeMultiplier?: number) => SoundFileItem | null;
  updateSoundFile: (file: SoundFileItem) => void;
  deleteSoundFile: (id: string) => void;
  addTodo: (t: TodoTask) => void;
  updateTodo: (t: TodoTask) => void;
  completeTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  deleteArchiveGroup: (taskId: string) => void;
  deleteMonitoringRecords: (classificationKeys: string[]) => void;
  addProcessTag: (name: string) => ProcessTag | null;
  updateProcessTag: (tagId: string, name: string) => void;
  deleteProcessTag: (tagId: string) => void;
  setProcessTagForProfile: (classificationKey: string, tagId?: string) => void;
  setDisplayMode: (m: string) => void;
  setCurrentWindow: (w: WindowClassificationProfile) => void;
}

const AppContext = createContext<AppContextType | null>(null);

function isElectronRuntime() {
  return Boolean(window.desktopApi?.isElectron);
}

function normalizePomodoroSettings(input: Partial<PomodoroSettings> | undefined, fallback: PomodoroSettings): PomodoroSettings {
  const pickInteger = (value: number | undefined, min: number, max: number, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };

  const pickFinite = (value: number | undefined, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return parsed;
  };

  return {
    ...fallback,
    ...input,
    focusMinutes: pickInteger(input?.focusMinutes, 1, 240, fallback.focusMinutes),
    breakMinutes: pickInteger(input?.breakMinutes, 1, 120, fallback.breakMinutes),
    distractionThresholdMinutes: pickInteger(
      input?.distractionThresholdMinutes,
      1,
      240,
      fallback.distractionThresholdMinutes,
    ),
    cycleCount: pickInteger(input?.cycleCount, 0, 9999, fallback.cycleCount),
    distractionMode:
      typeof input?.distractionMode === 'string' && input.distractionMode.trim().length > 0
        ? input.distractionMode
        : fallback.distractionMode,
    notifyEnabled: input?.notifyEnabled ?? fallback.notifyEnabled,
    soundEnabled: input?.soundEnabled ?? fallback.soundEnabled,
    completionSoundFileId:
      typeof input?.completionSoundFileId === 'string' ? input.completionSoundFileId : fallback.completionSoundFileId,
    completionVolumeMultiplier: pickFinite(
      input?.completionVolumeMultiplier,
      fallback.completionVolumeMultiplier,
    ),
    distractionSoundFileId:
      typeof input?.distractionSoundFileId === 'string'
        ? input.distractionSoundFileId
        : fallback.distractionSoundFileId,
    distractionVolumeMultiplier: pickFinite(
      input?.distractionVolumeMultiplier,
      fallback.distractionVolumeMultiplier,
    ),
    countdownSoundFileId:
      typeof input?.countdownSoundFileId === 'string'
        ? input.countdownSoundFileId
        : fallback.countdownSoundFileId,
    countdownVolumeMultiplier: pickFinite(
      input?.countdownVolumeMultiplier,
      fallback.countdownVolumeMultiplier,
    ),
  };
}

function normalizePreferences(
  input: Partial<AppPreferences> | undefined,
  fallback: AppPreferences,
): AppPreferences {
  const normalizePattern = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const normalizeUrlWhitelist = (raw: unknown, fallbackValue: UrlWhitelistRule[]) => {
    if (!Array.isArray(raw)) {
      return fallbackValue;
    }
    return raw
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const value = item as Partial<UrlWhitelistRule>;
        const pattern = normalizePattern(value.pattern);
        if (!pattern) {
          return null;
        }
        const now = new Date().toISOString();
        return {
          id:
            typeof value.id === 'string' && value.id.trim().length > 0
              ? value.id
              : `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          pattern,
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
        } satisfies UrlWhitelistRule;
      })
      .filter((item): item is UrlWhitelistRule => item !== null);
  };
  const normalizeProcessBlacklist = (raw: unknown, fallbackValue: ProcessBlacklistRule[]) => {
    if (!Array.isArray(raw)) {
      return fallbackValue;
    }
    return raw
      .filter(item => item && typeof item === 'object')
      .map(item => {
        const value = item as Partial<ProcessBlacklistRule>;
        const namePattern = normalizePattern(value.namePattern);
        const typePattern = normalizePattern(value.typePattern);
        const processPattern = normalizePattern(value.processPattern);
        if (!namePattern && !typePattern && !processPattern) {
          return null;
        }
        const now = new Date().toISOString();
        return {
          id:
            typeof value.id === 'string' && value.id.trim().length > 0
              ? value.id
              : `bl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          namePattern: namePattern || undefined,
          typePattern: typePattern || undefined,
          processPattern: processPattern || undefined,
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
        } satisfies ProcessBlacklistRule;
      })
      .filter((item): item is ProcessBlacklistRule => item !== null);
  };

  const threshold = Number(input?.recordWindowThresholdSeconds);
  const recordWindowThresholdSeconds = Number.isFinite(threshold)
    ? Math.max(0, Math.floor(threshold))
    : fallback.recordWindowThresholdSeconds;

  return {
    recordWindowThresholdSeconds,
    uiTheme: input?.uiTheme === 'light' || input?.uiTheme === 'dark' ? input.uiTheme : fallback.uiTheme,
    autoLaunchEnabled:
      typeof input?.autoLaunchEnabled === 'boolean' ? input.autoLaunchEnabled : fallback.autoLaunchEnabled,
    urlWhitelist: normalizeUrlWhitelist(input?.urlWhitelist, fallback.urlWhitelist),
    processBlacklist: normalizeProcessBlacklist(input?.processBlacklist, fallback.processBlacklist),
    countdownCompletedTaskBehavior:
      input?.countdownCompletedTaskBehavior === 'delete' ? 'delete' : fallback.countdownCompletedTaskBehavior,
  };
}

function normalizeSoundFiles(raw: unknown): SoundFileItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const value = item as Partial<SoundFileItem>;
      const now = new Date().toISOString();
      const parsedMultiplier = Number(value.defaultVolumeMultiplier);
      return {
        id: typeof value.id === 'string' ? value.id : `sound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名提示音',
        filePath: typeof value.filePath === 'string' ? value.filePath.trim() : '',
        defaultVolumeMultiplier: Number.isFinite(parsedMultiplier) ? parsedMultiplier : 1,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
      };
    })
    .filter(item => item.filePath.length > 0);
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
  let normalizedSoundFiles = normalizeSoundFiles((input as { soundFiles?: unknown }).soundFiles);
  const defaultSoundFiles = createDefaultSoundFiles();
  if (normalizedSoundFiles.length === 0) {
    normalizedSoundFiles = defaultSoundFiles;
  } else {
    const existingIds = new Set(normalizedSoundFiles.map(item => item.id));
    for (const builtin of defaultSoundFiles) {
      if (!existingIds.has(builtin.id)) {
        normalizedSoundFiles.push(builtin);
      }
    }
  }

  // Migrate legacy single-path sound setting to managed sound list.
  if (normalizedSoundFiles.length > 0) {
    const legacyPath = (input.pomodoroSettings as { customSoundPath?: string } | undefined)?.customSoundPath;
    if (typeof legacyPath === 'string' && legacyPath.trim().length > 0) {
      const exists = normalizedSoundFiles.some(item => item.filePath === legacyPath.trim());
      if (!exists) {
        const now = new Date().toISOString();
        normalizedSoundFiles.push({
          id: `sound-legacy-${Date.now()}`,
          name: '迁移提示音',
          filePath: legacyPath.trim(),
          defaultVolumeMultiplier: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  const fallbackSoundId = normalizedSoundFiles[0]?.id ?? '';
  const normalizedSettings = normalizePomodoroSettings(input.pomodoroSettings, initial.pomodoroSettings);
  const normalizedPreferences = normalizePreferences(input.preferences, initial.preferences);

  return {
    ...initial,
    ...input,
    profiles,
    sessions: Array.isArray(input.sessions) ? input.sessions : initial.sessions,
    windowStats: Array.isArray(input.windowStats) ? input.windowStats : initial.windowStats,
    currentProcessKeys: Array.isArray(input.currentProcessKeys) ? input.currentProcessKeys : initial.currentProcessKeys,
    processTags: Array.isArray(input.processTags) ? input.processTags : initial.processTags,
    processTagAssignments: Array.isArray(input.processTagAssignments) ? input.processTagAssignments : initial.processTagAssignments,
    processTagStats: Array.isArray(input.processTagStats) ? input.processTagStats : initial.processTagStats,
    soundFiles: normalizedSoundFiles,
    preferences: normalizedPreferences,
    subjects: Array.isArray(input.subjects) ? input.subjects : initial.subjects,
    queue: Array.isArray(input.queue)
      ? input.queue.map((item, index) => ({ ...item, orderIndex: index }))
      : initial.queue,
    stopwatchRecords: Array.isArray(input.stopwatchRecords) ? input.stopwatchRecords : initial.stopwatchRecords,
    countdownTasks: Array.isArray(input.countdownTasks) ? input.countdownTasks : initial.countdownTasks,
    todos: (Array.isArray(input.todos) ? input.todos : initial.todos).map(task => normalizeTodoTask(task)),
    archives: Array.isArray(input.archives) ? input.archives : initial.archives,
    powerEvents: Array.isArray(input.powerEvents) ? input.powerEvents : initial.powerEvents,
    pomodoroSettings: {
      ...normalizedSettings,
      completionSoundFileId:
        normalizedSettings.completionSoundFileId && normalizedSoundFiles.some(item => item.id === normalizedSettings.completionSoundFileId)
          ? normalizedSettings.completionSoundFileId
          : fallbackSoundId,
      distractionSoundFileId:
        normalizedSettings.distractionSoundFileId && normalizedSoundFiles.some(item => item.id === normalizedSettings.distractionSoundFileId)
          ? normalizedSettings.distractionSoundFileId
          : fallbackSoundId,
      countdownSoundFileId:
        normalizedSettings.countdownSoundFileId && normalizedSoundFiles.some(item => item.id === normalizedSettings.countdownSoundFileId)
          ? normalizedSettings.countdownSoundFileId
          : fallbackSoundId,
    },
    currentFocusedWindow: currentFocusedKey ? profileMap.get(currentFocusedKey) ?? null : null,
    displayMode: typeof input.displayMode === 'string' ? input.displayMode : initial.displayMode,
  };
}

function extractUserState(state: AppState): AppUserState {
  return {
    profiles: state.profiles,
    processTags: state.processTags,
    processTagAssignments: state.processTagAssignments,
    soundFiles: state.soundFiles,
    preferences: state.preferences,
    subjects: state.subjects,
    queue: state.queue,
    pomodoroSettings: state.pomodoroSettings,
    stopwatchRecords: state.stopwatchRecords,
    countdownTasks: state.countdownTasks,
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
    currentProcessKeys: incoming.currentProcessKeys,
    processTagStats: incoming.processTagStats,
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
  const soundStateRef = useRef({
    settings: state.pomodoroSettings,
    soundFiles: state.soundFiles,
  });

  useEffect(() => {
    soundStateRef.current = {
      settings: state.pomodoroSettings,
      soundFiles: state.soundFiles,
    };
  }, [state.pomodoroSettings, state.soundFiles]);

  useEffect(() => {
    const root = document.documentElement;
    if (state.preferences.uiTheme === 'light') {
      root.classList.add('theme-light');
      return;
    }
    root.classList.remove('theme-light');
  }, [state.preferences.uiTheme]);

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
        const { settings, soundFiles } = soundStateRef.current;
        void playSoundById(soundFiles, {
          enabled: settings.soundEnabled,
          soundFileId: settings.completionSoundFileId,
          eventVolumeMultiplier: settings.completionVolumeMultiplier,
        });
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

  const setStopwatchRecords = useCallback((records: StopwatchRecord[]) => {
    setState(s => ({
      ...s,
      stopwatchRecords: records,
    }));
  }, []);

  const setCountdownTasks = useCallback((tasks: CountdownTask[]) => {
    setState(s => ({
      ...s,
      countdownTasks: tasks,
    }));
  }, []);

  const updatePreferences = useCallback((partial: Partial<AppPreferences>) => {
    setState(s => ({
      ...s,
      preferences: normalizePreferences({ ...s.preferences, ...partial }, s.preferences),
    }));
  }, []);

  const clearAllData = useCallback(async () => {
    if (isElectronRuntime() && window.desktopApi?.clearAllData) {
      const cleared = normalizeState(await window.desktopApi.clearAllData());
      setState(cleared);
      lastSavedUserStateRef.current = JSON.stringify(extractUserState(cleared));
      return;
    }

    const initial = createInitialState();
    setState(initial);
    lastSavedUserStateRef.current = JSON.stringify(extractUserState(initial));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  }, []);

  const addSoundFile = useCallback((name: string, filePath: string, defaultVolumeMultiplier = 1) => {
    const trimmedName = name.trim();
    const trimmedPath = filePath.trim();
    if (!trimmedName || !trimmedPath) {
      return null;
    }
    const now = new Date().toISOString();
    const parsedMultiplier = Number(defaultVolumeMultiplier);
    const sound: SoundFileItem = {
      id: `sound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      filePath: trimmedPath,
      defaultVolumeMultiplier: Number.isFinite(parsedMultiplier) ? parsedMultiplier : 1,
      createdAt: now,
      updatedAt: now,
    };
    setState(s => ({
      ...s,
      soundFiles: [sound, ...s.soundFiles],
      pomodoroSettings: {
        ...s.pomodoroSettings,
        completionSoundFileId: s.pomodoroSettings.completionSoundFileId || sound.id,
        distractionSoundFileId: s.pomodoroSettings.distractionSoundFileId || sound.id,
        countdownSoundFileId: s.pomodoroSettings.countdownSoundFileId || sound.id,
      },
    }));
    return sound;
  }, []);

  const updateSoundFile = useCallback((soundFile: SoundFileItem) => {
    if (!soundFile.id) {
      return;
    }
    const trimmedName = soundFile.name.trim();
    const trimmedPath = soundFile.filePath.trim();
    if (!trimmedName || !trimmedPath) {
      return;
    }
    setState(s => ({
      ...s,
      soundFiles: s.soundFiles.map(item =>
        item.id === soundFile.id
          ? {
              ...item,
              name: trimmedName,
              filePath: trimmedPath,
              defaultVolumeMultiplier: Number.isFinite(soundFile.defaultVolumeMultiplier)
                ? soundFile.defaultVolumeMultiplier
                : item.defaultVolumeMultiplier,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
  }, []);

  const deleteSoundFile = useCallback((id: string) => {
    setState(s => {
      const remaining = s.soundFiles.filter(item => item.id !== id);
      const fallbackSoundId = remaining[0]?.id ?? '';
      const nextSettings = { ...s.pomodoroSettings };
      if (nextSettings.completionSoundFileId === id) {
        nextSettings.completionSoundFileId = fallbackSoundId;
      }
      if (nextSettings.distractionSoundFileId === id) {
        nextSettings.distractionSoundFileId = fallbackSoundId;
      }
      if (nextSettings.countdownSoundFileId === id) {
        nextSettings.countdownSoundFileId = fallbackSoundId;
      }
      return {
        ...s,
        soundFiles: remaining,
        pomodoroSettings: nextSettings,
      };
    });
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

  const deleteMonitoringRecords = useCallback((classificationKeys: string[]) => {
    const keySet = new Set(
      classificationKeys
        .map(key => key?.trim())
        .filter((key): key is string => Boolean(key)),
    );
    if (keySet.size === 0) {
      return;
    }

    setState(s => {
      const currentFocusedWindow =
        s.currentFocusedWindow && keySet.has(s.currentFocusedWindow.classificationKey)
          ? null
          : s.currentFocusedWindow;

      return {
        ...s,
        profiles: s.profiles.filter(profile => !keySet.has(profile.classificationKey)),
        sessions: s.sessions.filter(session => !keySet.has(session.classificationKey)),
        windowStats: s.windowStats.filter(stat => !keySet.has(stat.classificationKey)),
        currentProcessKeys: s.currentProcessKeys.filter(key => !keySet.has(key)),
        processTagAssignments: s.processTagAssignments.filter(assignment => !keySet.has(assignment.classificationKey)),
        currentFocusedWindow,
      };
    });
  }, []);

  const addProcessTag = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return null;
    }

    const tag: ProcessTag = {
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setState(s => ({
      ...s,
      processTags: [tag, ...s.processTags],
    }));
    return tag;
  }, []);

  const updateProcessTag = useCallback((tagId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setState(s => ({
      ...s,
      processTags: s.processTags.map(tag =>
        tag.id === tagId
          ? { ...tag, name: trimmed, updatedAt: new Date().toISOString() }
          : tag,
      ),
    }));
  }, []);

  const deleteProcessTag = useCallback((tagId: string) => {
    setState(s => ({
      ...s,
      processTags: s.processTags.filter(tag => tag.id !== tagId),
      processTagAssignments: s.processTagAssignments.filter(assignment => assignment.tagId !== tagId),
      processTagStats: s.processTagStats.filter(stat => stat.tagId !== tagId),
    }));
  }, []);

  const setProcessTagForProfile = useCallback((classificationKey: string, tagId?: string) => {
    const now = new Date().toISOString();
    setState(s => {
      const remaining = s.processTagAssignments.filter(item => item.classificationKey !== classificationKey);
      if (!tagId) {
        return {
          ...s,
          processTagAssignments: remaining,
        };
      }

      return {
        ...s,
        processTagAssignments: [
          ...remaining,
          {
            classificationKey,
            tagId,
            assignedAt: now,
            updatedAt: now,
          },
        ],
      };
    });
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
      setStopwatchRecords,
      setCountdownTasks,
      updatePreferences,
      clearAllData,
      addSoundFile,
      updateSoundFile,
      deleteSoundFile,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      deleteArchiveGroup,
      deleteMonitoringRecords,
      addProcessTag,
      updateProcessTag,
      deleteProcessTag,
      setProcessTagForProfile,
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
      setStopwatchRecords,
      setCountdownTasks,
      updatePreferences,
      clearAllData,
      addSoundFile,
      updateSoundFile,
      deleteSoundFile,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      deleteArchiveGroup,
      deleteMonitoringRecords,
      addProcessTag,
      updateProcessTag,
      deleteProcessTag,
      setProcessTagForProfile,
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
