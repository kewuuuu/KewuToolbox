import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppPreferences,
  AppRuntimeState,
  AppUiState,
  AppUserState,
  Category,
  CountdownTask,
  FocusQueueItem,
  FocusSubject,
  InputActivityCounters,
  InputActivityTimelineRecord,
  InputActivityWindowStat,
  MonitoringSortKey,
  ObjectType,
  ProcessTag,
  ProcessBlacklistRule,
  ProcessWhitelistRule,
  PomodoroSettings,
  SoundBalanceCache,
  SoundFileItem,
  SoundVolumeMode,
  StopwatchLap,
  StopwatchRecord,
  TodoArchiveRecord,
  TodoScheduledAction,
  TodoTask,
  WindowClassificationProfile,
} from '@/types';
import { createInitialState } from '@/data/initialState';
import { createDefaultSoundFiles } from '@/data/defaultSoundFiles';
import { buildReminderStamp, normalizeTodoTask, shouldTriggerReminder, validateTodoTask } from '@/lib/todo';
import { matchesAnyWindowGroup } from '@/lib/windowGroupMatcher';
import { playSoundById, resolveSoundPlaybackForEvent } from '@/lib/sound';
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
  updateUiState: (u: Partial<AppUiState>) => void;
  updateRuntimeState: (r: Partial<AppRuntimeState>) => void;
  updatePreferences: (p: Partial<AppPreferences>) => void;
  mergeRecordsByWhitelist: () => Promise<number>;
  clearAllData: () => Promise<void>;
  clearDiagnosticLogs: () => Promise<void>;
  addSoundFile: (name: string, filePath: string, defaultVolumeMultiplier?: number) => SoundFileItem | null;
  updateSoundFile: (file: SoundFileItem) => void;
  deleteSoundFile: (id: string) => void;
  addTodo: (t: TodoTask) => void;
  updateTodo: (t: TodoTask) => void;
  completeTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  updateArchiveInsight: (recordId: string, taskId: string, insight: string) => void;
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

const FALLBACK_FOCUS_MINUTES = 25;

function clampFocusMinutes(input: number, fallback = FALLBACK_FOCUS_MINUTES) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(240, Math.floor(parsed)));
}

function getFocusSecondsForQueueIndex(queue: FocusQueueItem[], queueIndex: number) {
  const item = queue[queueIndex];
  const focusMinutes = clampFocusMinutes(item?.durationMinutes ?? FALLBACK_FOCUS_MINUTES);
  return focusMinutes * 60;
}

function patchArchiveSnapshotInsight(snapshotJson: string, insight: string) {
  try {
    const snapshot = JSON.parse(snapshotJson || '{}');
    if (snapshot && typeof snapshot === 'object') {
      return JSON.stringify({ ...snapshot, currentInsight: insight });
    }
  } catch {
    // Keep malformed legacy snapshots untouched.
  }
  return snapshotJson || '{}';
}

function normalizeUiState(input: Partial<AppUiState> | undefined, fallback: AppUiState): AppUiState {
  const pickString = (value: unknown, fallbackValue: string) =>
    typeof value === 'string' ? value : fallbackValue;
  const pickStringOrNull = (value: unknown, fallbackValue: string | null) =>
    typeof value === 'string' ? value : value === null ? null : fallbackValue;
  const pickBoolean = (value: unknown, fallbackValue: boolean) =>
    typeof value === 'boolean' ? value : fallbackValue;
  const pickFinite = (value: unknown, fallbackValue: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  };
  const pickNumberArray = (value: unknown, fallbackValue: number[]) =>
    Array.isArray(value)
      ? value
          .map(item => Number(item))
          .filter(item => Number.isFinite(item))
          .map(item => Math.floor(item))
      : fallbackValue;
  const pickWindowGroupItems = (
    value: unknown,
    fallbackValue: AppUiState['focusSubjects']['selectedWindows'],
  ) =>
    Array.isArray(value)
      ? value
          .filter(item => item && typeof item === 'object')
          .map(item => item as AppUiState['focusSubjects']['selectedWindows'][number])
          .filter(item => typeof item.classificationKey === 'string' && typeof item.displayName === 'string')
      : fallbackValue;

  const normalizeSort = (
    value: AppUiState['monitoring']['historySort'] | undefined,
    fallbackSort: AppUiState['monitoring']['historySort'],
  ): AppUiState['monitoring']['historySort'] => {
    const sortKeySet = new Set<MonitoringSortKey>([
      'displayName',
      'objectType',
      'processName',
      'category',
      'tag',
      'totalVisible',
      'focusTime',
      'lastFocus',
      'longestContinuousFocus',
    ]);
    const legacyKey = value ? (value as { key?: unknown }).key : undefined;
    const rawKey =
      typeof legacyKey === 'string'
        ? legacyKey === 'lastSeen'
          ? 'lastFocus'
          : legacyKey
        : undefined;
    const key: MonitoringSortKey =
      rawKey && sortKeySet.has(rawKey as MonitoringSortKey)
        ? rawKey as MonitoringSortKey
        : fallbackSort.key;
    const direction =
      value?.direction === 'asc' || value?.direction === 'desc'
        ? value.direction
        : fallbackSort.direction;
    return { key, direction };
  };

  const normalizeMonitoringTab = (value: unknown, fallbackValue: AppUiState['monitoring']['activeTab']) => {
    if (
      value === 'history' ||
      value === 'current' ||
      value === 'tags' ||
      value === 'events' ||
      value === 'debug'
    ) {
      return value;
    }
    return fallbackValue;
  };

  const normalizeTodoFilter = (value: unknown, fallbackValue: AppUiState['todos']['filter']) =>
    value === 'all' || value === '一次性' || value === '重复' ? value : fallbackValue;
  const normalizeTaskType = (value: unknown, fallbackValue: AppUiState['todos']['taskType']) =>
    value === '一次性' || value === '重复' ? value : fallbackValue;
  const normalizeRepeatMode = (value: unknown, fallbackValue: AppUiState['todos']['repeatMode']) =>
    value === '每日' || value === '每周' || value === '每月' || value === '自定义'
      ? value
      : fallbackValue;
  const normalizeTodoScheduledAction = (
    value: unknown,
    fallbackValue: TodoScheduledAction,
  ): TodoScheduledAction => (value === 'shutdown' || value === 'reminder' ? value : fallbackValue);
  const normalizeHourlyMode = (value: unknown, fallbackValue: AppUiState['analytics']['hourlyMode']) =>
    value === 'total' || value === 'category' ? value : fallbackValue;
  const normalizeAnalyticsTab = (value: unknown, fallbackValue: AppUiState['analytics']['activeTab']) =>
    value === 'input' || value === 'focus' ? value : fallbackValue;
  const normalizeAnalyticsDisplayMode = (
    value: unknown,
    fallbackValue: AppUiState['analytics']['distributionDisplayMode'],
  ) => (value === 'window' || value === 'category' ? value : fallbackValue);
  const normalizeInputActivityMetric = (
    value: unknown,
    fallbackValue: AppUiState['inputActivity']['selectedMetric'],
  ) =>
    value === 'keyPresses' || value === 'totalClicks' || value === 'scrollTicks' || value === 'mouseMovePixels'
      ? value
      : fallbackValue;
  const normalizeInputActivityHistoryDays = (
    value: unknown,
    fallbackValue: AppUiState['inputActivity']['historyDays'],
  ) => (Number(value) === 30 ? 30 : Number(value) === 7 ? 7 : fallbackValue);
  const normalizeInputActivityKeyboardMode = (
    value: unknown,
    fallbackValue: AppUiState['inputActivity']['keyboardMode'],
  ) => (value === 'rank' || value === 'heatmap' ? value : fallbackValue);
  const normalizeInputActivityHistoryChartType = (
    value: unknown,
    fallbackValue: AppUiState['inputActivity']['historyChartType'],
  ) => (value === 'bar' || value === 'line' ? value : fallbackValue);

  return {
    calculatorExpression:
      typeof input?.calculatorExpression === 'string'
        ? input.calculatorExpression
        : fallback.calculatorExpression,
    monitoring: {
      activeTab: normalizeMonitoringTab(input?.monitoring?.activeTab, fallback.monitoring.activeTab),
      historySort: normalizeSort(input?.monitoring?.historySort, fallback.monitoring.historySort),
      currentSort: normalizeSort(input?.monitoring?.currentSort, fallback.monitoring.currentSort),
    },
    clock: {
      newCountdownTitle:
        typeof input?.clock?.newCountdownTitle === 'string'
          ? input.clock.newCountdownTitle
          : fallback.clock.newCountdownTitle,
      newCountdownSeconds:
        typeof input?.clock?.newCountdownSeconds === 'string'
          ? input.clock.newCountdownSeconds
          : fallback.clock.newCountdownSeconds,
    },
    settings: {
      manualPath: pickString(input?.settings?.manualPath, fallback.settings.manualPath),
      manualName: pickString(input?.settings?.manualName, fallback.settings.manualName),
      whitelistNameInput: pickString(input?.settings?.whitelistNameInput, fallback.settings.whitelistNameInput),
      whitelistNamePatternInput: pickString(
        input?.settings?.whitelistNamePatternInput,
        fallback.settings.whitelistNamePatternInput,
      ),
      whitelistTypePatternInput: pickString(
        input?.settings?.whitelistTypePatternInput,
        fallback.settings.whitelistTypePatternInput,
      ),
      whitelistProcessPatternInput: pickString(
        input?.settings?.whitelistProcessPatternInput,
        fallback.settings.whitelistProcessPatternInput,
      ),
      blacklistNameInput: pickString(input?.settings?.blacklistNameInput, fallback.settings.blacklistNameInput),
      blacklistTypeInput: pickString(input?.settings?.blacklistTypeInput, fallback.settings.blacklistTypeInput),
      blacklistProcessInput: pickString(
        input?.settings?.blacklistProcessInput,
        fallback.settings.blacklistProcessInput,
      ),
      dataFilePathInput: pickString(input?.settings?.dataFilePathInput, fallback.settings.dataFilePathInput),
      thresholdInput: pickString(input?.settings?.thresholdInput, fallback.settings.thresholdInput),
      analyticsWindowItemLimitInput: pickString(
        input?.settings?.analyticsWindowItemLimitInput,
        fallback.settings.analyticsWindowItemLimitInput,
      ),
    },
    todos: {
      searchQuery: pickString(input?.todos?.searchQuery, fallback.todos.searchQuery),
      showForm: pickBoolean(input?.todos?.showForm, fallback.todos.showForm),
      filter: normalizeTodoFilter(input?.todos?.filter, fallback.todos.filter),
      title: pickString(input?.todos?.title, fallback.todos.title),
      taskType: normalizeTaskType(input?.todos?.taskType, fallback.todos.taskType),
      repeatMode: normalizeRepeatMode(input?.todos?.repeatMode, fallback.todos.repeatMode),
      weeklyDays: pickNumberArray(input?.todos?.weeklyDays, fallback.todos.weeklyDays),
      monthlyDays: pickNumberArray(input?.todos?.monthlyDays, fallback.todos.monthlyDays),
      customPattern: pickString(input?.todos?.customPattern, fallback.todos.customPattern),
      reminderEnabled: pickBoolean(input?.todos?.reminderEnabled, fallback.todos.reminderEnabled),
      scheduledAction: normalizeTodoScheduledAction(
        input?.todos?.scheduledAction,
        fallback.todos.scheduledAction,
      ),
      rYear: pickString(input?.todos?.rYear, fallback.todos.rYear),
      rMonth: pickString(input?.todos?.rMonth, fallback.todos.rMonth),
      rDay: pickString(input?.todos?.rDay, fallback.todos.rDay),
      rHour: pickString(input?.todos?.rHour, fallback.todos.rHour),
      rMinute: pickString(input?.todos?.rMinute, fallback.todos.rMinute),
      rSecond: pickString(input?.todos?.rSecond, fallback.todos.rSecond),
    },
    focusSubjects: {
      modalOpen: pickBoolean(input?.focusSubjects?.modalOpen, fallback.focusSubjects.modalOpen),
      editingSubjectId: pickStringOrNull(
        input?.focusSubjects?.editingSubjectId,
        fallback.focusSubjects.editingSubjectId,
      ),
      title: pickString(input?.focusSubjects?.title, fallback.focusSubjects.title),
      defaultMinutes: Math.max(
        1,
        Math.floor(pickFinite(input?.focusSubjects?.defaultMinutes, fallback.focusSubjects.defaultMinutes)),
      ),
      selectedWindows: pickWindowGroupItems(
        input?.focusSubjects?.selectedWindows,
        fallback.focusSubjects.selectedWindows,
      ),
      manualNamePattern: pickString(
        input?.focusSubjects?.manualNamePattern,
        fallback.focusSubjects.manualNamePattern,
      ),
      manualTypePattern: pickString(
        input?.focusSubjects?.manualTypePattern,
        fallback.focusSubjects.manualTypePattern,
      ),
      manualProcessPattern: pickString(
        input?.focusSubjects?.manualProcessPattern,
        fallback.focusSubjects.manualProcessPattern,
      ),
    },
    analytics: {
      selectedDate: pickString(input?.analytics?.selectedDate, fallback.analytics.selectedDate),
      rangeStartDate: pickString(input?.analytics?.rangeStartDate, fallback.analytics.rangeStartDate),
      rangeEndDate: pickString(input?.analytics?.rangeEndDate, fallback.analytics.rangeEndDate),
      activeTab: normalizeAnalyticsTab(input?.analytics?.activeTab, fallback.analytics.activeTab),
      heatmapCategory: pickString(input?.analytics?.heatmapCategory, fallback.analytics.heatmapCategory),
      hourlyMode: normalizeHourlyMode(input?.analytics?.hourlyMode, fallback.analytics.hourlyMode),
      distributionDisplayMode: normalizeAnalyticsDisplayMode(
        input?.analytics?.distributionDisplayMode,
        fallback.analytics.distributionDisplayMode,
      ),
      rankDisplayMode: normalizeAnalyticsDisplayMode(
        input?.analytics?.rankDisplayMode,
        fallback.analytics.rankDisplayMode,
      ),
      hourlyDisplayMode: normalizeAnalyticsDisplayMode(
        input?.analytics?.hourlyDisplayMode,
        fallback.analytics.hourlyDisplayMode,
      ),
      trendDisplayMode: normalizeAnalyticsDisplayMode(
        input?.analytics?.trendDisplayMode,
        fallback.analytics.trendDisplayMode,
      ),
      timelineDisplayMode: normalizeAnalyticsDisplayMode(
        input?.analytics?.timelineDisplayMode,
        fallback.analytics.timelineDisplayMode,
      ),
    },
    inputActivity: {
      selectedDate: pickString(input?.inputActivity?.selectedDate, fallback.inputActivity.selectedDate),
      selectedMetric: normalizeInputActivityMetric(
        input?.inputActivity?.selectedMetric,
        fallback.inputActivity.selectedMetric,
      ),
      historyDays: normalizeInputActivityHistoryDays(
        input?.inputActivity?.historyDays,
        fallback.inputActivity.historyDays,
      ),
      keyboardMode: normalizeInputActivityKeyboardMode(
        input?.inputActivity?.keyboardMode,
        fallback.inputActivity.keyboardMode,
      ),
      showAppDetails: pickBoolean(input?.inputActivity?.showAppDetails, fallback.inputActivity.showAppDetails),
      historyChartType: normalizeInputActivityHistoryChartType(
        input?.inputActivity?.historyChartType,
        fallback.inputActivity.historyChartType,
      ),
    },
    monitoringDraft: {
      creatingTag: pickBoolean(input?.monitoringDraft?.creatingTag, fallback.monitoringDraft.creatingTag),
      newTagName: pickString(input?.monitoringDraft?.newTagName, fallback.monitoringDraft.newTagName),
      editingTagId: pickStringOrNull(input?.monitoringDraft?.editingTagId, fallback.monitoringDraft.editingTagId),
      editingTagName: pickString(input?.monitoringDraft?.editingTagName, fallback.monitoringDraft.editingTagName),
    },
  };
}

function normalizeRuntimeState(
  input: Partial<AppRuntimeState> | undefined,
  fallback: AppRuntimeState,
  queue: FocusQueueItem[],
): AppRuntimeState {
  const pickFinite = (value: unknown, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return parsed;
  };

  const queueLength = queue.length;
  const maxQueueIndex = Math.max(0, queueLength - 1);
  const runtimeQueueIndex = Math.floor(
    Math.max(0, Math.min(maxQueueIndex, pickFinite(input?.pomodoro?.currentQueueIdx, fallback.pomodoro.currentQueueIdx))),
  );
  const fallbackFocusSeconds = getFocusSecondsForQueueIndex(queue, runtimeQueueIndex);

  const normalizeLap = (lap: StopwatchLap, fallbackCreatedAt: string): StopwatchLap => ({
    id: typeof lap.id === 'string' && lap.id.trim().length > 0 ? lap.id : `lap-${Date.now()}`,
    elapsedMs: Math.max(0, Math.floor(pickFinite(lap.elapsedMs, 0))),
    splitMs: Math.max(0, Math.floor(pickFinite(lap.splitMs, 0))),
    note: typeof lap.note === 'string' ? lap.note : '',
    createdAt: typeof lap.createdAt === 'string' ? lap.createdAt : fallbackCreatedAt,
  });

  const normalizedPomodoroIsRunning = Boolean(input?.pomodoro?.isRunning ?? fallback.pomodoro.isRunning);
  const normalizedPomodoroHasStarted = Boolean(
    input?.pomodoro?.hasStartedCurrentStage ?? fallback.pomodoro.hasStartedCurrentStage,
  );
  const normalizedPomodoroSecondsLeft = Math.max(
    0,
    Math.floor(pickFinite(input?.pomodoro?.secondsLeft, fallbackFocusSeconds)),
  );
  const effectivePomodoroSecondsLeft =
    !normalizedPomodoroIsRunning && !normalizedPomodoroHasStarted
      ? fallbackFocusSeconds
      : normalizedPomodoroSecondsLeft;

  return {
    pomodoro: {
      secondsLeft: effectivePomodoroSecondsLeft,
      isRunning: normalizedPomodoroIsRunning,
      hasStartedCurrentStage: normalizedPomodoroHasStarted,
      currentCycle: Math.max(1, Math.floor(pickFinite(input?.pomodoro?.currentCycle, fallback.pomodoro.currentCycle))),
      currentQueueIdx: runtimeQueueIndex,
      offTargetSeconds: Math.max(0, Math.floor(pickFinite(input?.pomodoro?.offTargetSeconds, fallback.pomodoro.offTargetSeconds))),
      timerEndsAtMs:
        Number.isFinite(Number(input?.pomodoro?.timerEndsAtMs))
          ? Number(input?.pomodoro?.timerEndsAtMs)
          : undefined,
      offTargetAccumulatedMs: Math.max(
        0,
        Math.floor(pickFinite(input?.pomodoro?.offTargetAccumulatedMs, fallback.pomodoro.offTargetAccumulatedMs)),
      ),
      distractionAlerted: Boolean(input?.pomodoro?.distractionAlerted ?? fallback.pomodoro.distractionAlerted),
      distractionLastTickAtMs:
        Number.isFinite(Number(input?.pomodoro?.distractionLastTickAtMs))
          ? Number(input?.pomodoro?.distractionLastTickAtMs)
          : undefined,
    },
    stopwatch: {
      isRunning: Boolean(input?.stopwatch?.isRunning ?? fallback.stopwatch.isRunning),
      elapsedMs: Math.max(0, Math.floor(pickFinite(input?.stopwatch?.elapsedMs, fallback.stopwatch.elapsedMs))),
      runStartedAtMs:
        Number.isFinite(Number(input?.stopwatch?.runStartedAtMs))
          ? Number(input?.stopwatch?.runStartedAtMs)
          : undefined,
      sessionStartedAt:
        typeof input?.stopwatch?.sessionStartedAt === 'string'
          ? input.stopwatch.sessionStartedAt
          : fallback.stopwatch.sessionStartedAt,
      laps: Array.isArray(input?.stopwatch?.laps)
        ? input.stopwatch.laps
            .filter(item => item && typeof item === 'object')
            .map(item => normalizeLap(item as StopwatchLap, new Date().toISOString()))
        : fallback.stopwatch.laps,
    },
  };
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

  const pickPositiveFinite = (value: number | undefined, fallbackValue: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallbackValue;
    }
    return parsed;
  };

  const pickSoundVolumeMode = (
    value: SoundVolumeMode | undefined,
    fallbackValue: SoundVolumeMode,
  ): SoundVolumeMode => (value === 'balanced' ? 'balanced' : value === 'unbalanced' ? 'unbalanced' : fallbackValue);

  const normalizeBalanceCache = (value: SoundBalanceCache | undefined): SoundBalanceCache | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const soundFileId = typeof value.soundFileId === 'string' ? value.soundFileId : '';
    const soundFileUpdatedAt = typeof value.soundFileUpdatedAt === 'string' ? value.soundFileUpdatedAt : '';
    const generatedAt = typeof value.generatedAt === 'string' ? value.generatedAt : '';
    const measuredAverageDb = Number(value.measuredAverageDb);
    const measuredPeakDb = Number(value.measuredPeakDb);
    const targetDb = Number(value.targetDb);
    const normalizedGain = Number(value.normalizedGain);
    if (!soundFileId || !soundFileUpdatedAt || !generatedAt) {
      return undefined;
    }
    if (!Number.isFinite(measuredAverageDb) || !Number.isFinite(measuredPeakDb) || !Number.isFinite(targetDb)) {
      return undefined;
    }
    if (!Number.isFinite(normalizedGain) || normalizedGain <= 0) {
      return undefined;
    }
    return {
      soundFileId,
      soundFileUpdatedAt,
      targetDb,
      measuredAverageDb,
      measuredPeakDb,
      normalizedGain,
      generatedAt,
    };
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
    distractionMode: (() => {
      const raw =
        typeof input?.distractionMode === 'string' && input.distractionMode.trim().length > 0
          ? input.distractionMode.trim()
          : fallback.distractionMode;
      if (raw === '杩炵画') {
        return '连续';
      }
      if (raw === '绱') {
        return '累计';
      }
      return raw;
    })(),
    notifyEnabled: input?.notifyEnabled ?? fallback.notifyEnabled,
    soundEnabled: input?.soundEnabled ?? fallback.soundEnabled,
    completionSoundFileId:
      typeof input?.completionSoundFileId === 'string' ? input.completionSoundFileId : fallback.completionSoundFileId,
    completionVolumeMode: pickSoundVolumeMode(input?.completionVolumeMode, fallback.completionVolumeMode),
    completionVolumeMultiplier: pickPositiveFinite(
      input?.completionVolumeMultiplier,
      fallback.completionVolumeMultiplier,
    ),
    completionBalancedTargetDb: pickFinite(
      input?.completionBalancedTargetDb,
      fallback.completionBalancedTargetDb,
    ),
    completionBalanceCache: normalizeBalanceCache(input?.completionBalanceCache),
    distractionSoundFileId:
      typeof input?.distractionSoundFileId === 'string'
        ? input.distractionSoundFileId
        : fallback.distractionSoundFileId,
    distractionVolumeMode: pickSoundVolumeMode(input?.distractionVolumeMode, fallback.distractionVolumeMode),
    distractionVolumeMultiplier: pickPositiveFinite(
      input?.distractionVolumeMultiplier,
      fallback.distractionVolumeMultiplier,
    ),
    distractionBalancedTargetDb: pickFinite(
      input?.distractionBalancedTargetDb,
      fallback.distractionBalancedTargetDb,
    ),
    distractionBalanceCache: normalizeBalanceCache(input?.distractionBalanceCache),
    countdownSoundFileId:
      typeof input?.countdownSoundFileId === 'string'
        ? input.countdownSoundFileId
        : fallback.countdownSoundFileId,
    countdownVolumeMode: pickSoundVolumeMode(input?.countdownVolumeMode, fallback.countdownVolumeMode),
    countdownVolumeMultiplier: pickPositiveFinite(
      input?.countdownVolumeMultiplier,
      fallback.countdownVolumeMultiplier,
    ),
    countdownBalancedTargetDb: pickFinite(
      input?.countdownBalancedTargetDb,
      fallback.countdownBalancedTargetDb,
    ),
    countdownBalanceCache: normalizeBalanceCache(input?.countdownBalanceCache),
  };
}

function normalizePreferences(
  input: Partial<AppPreferences> | undefined,
  fallback: AppPreferences,
): AppPreferences {
  const normalizePattern = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const normalizeWhitelistName = (value: unknown, fallbackName: string) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return fallbackName;
  };
  const normalizeProcessWhitelist = (raw: unknown, fallbackValue: ProcessWhitelistRule[]) => {
    if (!Array.isArray(raw)) {
      return fallbackValue;
    }
    return raw
      .filter(item => item && typeof item === 'object')
      .map((item): ProcessWhitelistRule | null => {
        const value = item as Partial<ProcessWhitelistRule> & { pattern?: string };
        const legacyPattern = normalizePattern(value.pattern);
        const namePattern = normalizePattern(value.namePattern) || legacyPattern;
        const typePattern = normalizePattern(value.typePattern);
        const processPattern = normalizePattern(value.processPattern);
        if (!namePattern && !typePattern && !processPattern) {
          return null;
        }
        const fallbackName = namePattern || typePattern || processPattern || '白名单规则';
        const now = new Date().toISOString();
        return {
          id:
            typeof value.id === 'string' && value.id.trim().length > 0
              ? value.id
              : `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: normalizeWhitelistName(value.name, fallbackName),
          namePattern: namePattern || undefined,
          typePattern: typePattern || undefined,
          processPattern: processPattern || undefined,
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
        } satisfies ProcessWhitelistRule;
      })
      .filter((item): item is ProcessWhitelistRule => item !== null);
  };
  const normalizeProcessBlacklist = (raw: unknown, fallbackValue: ProcessBlacklistRule[]) => {
    if (!Array.isArray(raw)) {
      return fallbackValue;
    }
    return raw
      .filter(item => item && typeof item === 'object')
      .map((item): ProcessBlacklistRule | null => {
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
  const analyticsLimit = Number(input?.analyticsWindowItemLimit);
  const analyticsWindowItemLimit = Number.isFinite(analyticsLimit)
    ? Math.max(1, Math.floor(analyticsLimit))
    : fallback.analyticsWindowItemLimit;
  const closeWindowBehavior =
    input?.closeWindowBehavior === 'close' || input?.closeWindowBehavior === 'tray' || input?.closeWindowBehavior === 'ask'
      ? input.closeWindowBehavior
      : fallback.closeWindowBehavior;

  return {
    recordWindowThresholdSeconds,
    analyticsWindowItemLimit,
    uiTheme: input?.uiTheme === 'light' || input?.uiTheme === 'dark' ? input.uiTheme : fallback.uiTheme,
    autoLaunchEnabled:
      typeof input?.autoLaunchEnabled === 'boolean' ? input.autoLaunchEnabled : fallback.autoLaunchEnabled,
    processWhitelist: normalizeProcessWhitelist(
      (input as { processWhitelist?: unknown; urlWhitelist?: unknown } | undefined)?.processWhitelist ??
        (input as { processWhitelist?: unknown; urlWhitelist?: unknown } | undefined)?.urlWhitelist,
      fallback.processWhitelist,
    ),
    processBlacklist: normalizeProcessBlacklist(input?.processBlacklist, fallback.processBlacklist),
    countdownCompletedTaskBehavior:
      input?.countdownCompletedTaskBehavior === 'delete' ? 'delete' : fallback.countdownCompletedTaskBehavior,
    closeWindowBehavior,
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

function normalizeObjectType(value: unknown): ObjectType {
  return value === 'BrowserTab' || value === 'Desktop' ? value : 'AppWindow';
}

function normalizeInputActivityCounters(raw: unknown): InputActivityCounters {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const pickInteger = (value: unknown) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);
  const normalizeKeyCounts = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((map, [key, count]) => {
      const keycode = Number(key);
      const normalizedCount = pickInteger(count);
      if (Number.isFinite(keycode) && keycode > 0 && normalizedCount > 0) {
        map[String(Math.floor(keycode))] = normalizedCount;
      }
      return map;
    }, {});
  };
  return {
    keyPresses: pickInteger(source.keyPresses),
    leftClicks: pickInteger(source.leftClicks),
    rightClicks: pickInteger(source.rightClicks),
    middleClicks: pickInteger(source.middleClicks),
    sideBackClicks: pickInteger(source.sideBackClicks),
    sideForwardClicks: pickInteger(source.sideForwardClicks),
    scrollTicks: pickInteger(source.scrollTicks),
    mouseMovePixels: pickInteger(source.mouseMovePixels),
    keyCounts: normalizeKeyCounts(source.keyCounts),
  };
}

function normalizeInputActivityStats(raw: unknown, fallback: AppState['inputActivityStats']): InputActivityWindowStat[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).classificationKey === 'string'),
    )
    .map(item => {
      const classificationKey = String(item.classificationKey);
      return {
        classificationKey,
        displayName: typeof item.displayName === 'string' ? item.displayName : classificationKey,
        objectType: normalizeObjectType(item.objectType),
        processName: typeof item.processName === 'string' ? item.processName : '',
        domain: typeof item.domain === 'string' ? item.domain : undefined,
        ...normalizeInputActivityCounters(item),
        firstAt: typeof item.firstAt === 'string' ? item.firstAt : '',
        lastAt: typeof item.lastAt === 'string' ? item.lastAt : '',
      };
    });
}

function normalizeInputActivityTimeline(raw: unknown, fallback: AppState['inputActivityTimeline']): InputActivityTimelineRecord[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).classificationKey === 'string'),
    )
    .map(item => {
      const classificationKey = String(item.classificationKey);
      return {
        id: typeof item.id === 'string' ? item.id : `input-activity-${Date.now()}`,
        classificationKey,
        displayName: typeof item.displayName === 'string' ? item.displayName : classificationKey,
        objectType: normalizeObjectType(item.objectType),
        processName: typeof item.processName === 'string' ? item.processName : '',
        domain: typeof item.domain === 'string' ? item.domain : undefined,
        bucketStartAt: typeof item.bucketStartAt === 'string' ? item.bucketStartAt : '',
        bucketEndAt: typeof item.bucketEndAt === 'string' ? item.bucketEndAt : '',
        ...normalizeInputActivityCounters(item),
      };
    });
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
  const normalizedQueue = Array.isArray(input.queue)
    ? input.queue.map((item, index) => ({ ...item, orderIndex: index }))
    : initial.queue;
  const normalizedSettings = normalizePomodoroSettings(input.pomodoroSettings, initial.pomodoroSettings);
  const normalizedPreferences = normalizePreferences(input.preferences, initial.preferences);
  const normalizedUiState = normalizeUiState(input.uiState, initial.uiState);
  const normalizedRuntimeState = normalizeRuntimeState(input.runtimeState, initial.runtimeState, normalizedQueue);

  return {
    ...initial,
    ...input,
    profiles,
    sessions: Array.isArray(input.sessions) ? input.sessions : initial.sessions,
    windowStats: Array.isArray(input.windowStats)
      ? input.windowStats.map(item => ({
          ...item,
          lastFocusAt:
            typeof item.lastFocusAt === 'string'
              ? item.lastFocusAt
              : typeof (item as { lastSeenAt?: unknown }).lastSeenAt === 'string'
                ? String((item as { lastSeenAt?: unknown }).lastSeenAt)
                : '',
          longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
            ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
            : 0,
        }))
      : initial.windowStats,
    processTimeline: Array.isArray(input.processTimeline)
      ? input.processTimeline.map(item => ({
          ...item,
          durationSeconds: Number.isFinite(Number(item.durationSeconds))
            ? Math.max(0, Math.floor(Number(item.durationSeconds)))
            : 0,
          isOpen: Boolean(item.isOpen),
        }))
      : initial.processTimeline,
    inputActivityStats: normalizeInputActivityStats(input.inputActivityStats, initial.inputActivityStats),
    inputActivityTimeline: normalizeInputActivityTimeline(input.inputActivityTimeline, initial.inputActivityTimeline),
    currentProcessKeys: Array.isArray(input.currentProcessKeys) ? input.currentProcessKeys : initial.currentProcessKeys,
    currentProcessRuntimeStats: Array.isArray(input.currentProcessRuntimeStats)
      ? input.currentProcessRuntimeStats.map(item => ({
          ...item,
          firstSeenAt: typeof item.firstSeenAt === 'string' ? item.firstSeenAt : '',
          totalVisibleSeconds: Number.isFinite(Number(item.totalVisibleSeconds))
            ? Math.max(0, Math.floor(Number(item.totalVisibleSeconds)))
            : 0,
          totalFocusSeconds: Number.isFinite(Number(item.totalFocusSeconds))
            ? Math.max(0, Math.floor(Number(item.totalFocusSeconds)))
            : 0,
          currentContinuousFocusSeconds: Number.isFinite(Number(item.currentContinuousFocusSeconds))
            ? Math.max(0, Math.floor(Number(item.currentContinuousFocusSeconds)))
            : 0,
          longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
            ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
            : 0,
          lastFocusAt: typeof item.lastFocusAt === 'string' ? item.lastFocusAt : '',
          recorded: Boolean(item.recorded),
          processTimelineId: typeof item.processTimelineId === 'string' ? item.processTimelineId : undefined,
          focusSegmentStartedAt:
            typeof item.focusSegmentStartedAt === 'string' ? item.focusSegmentStartedAt : undefined,
          focusSegmentRecordedSeconds: Number.isFinite(Number(item.focusSegmentRecordedSeconds))
            ? Math.max(0, Math.floor(Number(item.focusSegmentRecordedSeconds)))
            : 0,
        }))
      : initial.currentProcessRuntimeStats,
    processTags: Array.isArray(input.processTags) ? input.processTags : initial.processTags,
    processTagAssignments: Array.isArray(input.processTagAssignments) ? input.processTagAssignments : initial.processTagAssignments,
    processTagStats: Array.isArray(input.processTagStats)
      ? input.processTagStats.map(item => ({
          ...item,
          lastFocusAt:
            typeof item.lastFocusAt === 'string'
              ? item.lastFocusAt
              : typeof (item as { lastSeenAt?: unknown }).lastSeenAt === 'string'
                ? String((item as { lastSeenAt?: unknown }).lastSeenAt)
                : '',
          longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
            ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
            : 0,
        }))
      : initial.processTagStats,
    soundFiles: normalizedSoundFiles,
    preferences: normalizedPreferences,
    subjects: Array.isArray(input.subjects) ? input.subjects : initial.subjects,
    queue: normalizedQueue,
    stopwatchRecords: Array.isArray(input.stopwatchRecords) ? input.stopwatchRecords : initial.stopwatchRecords,
    countdownTasks: Array.isArray(input.countdownTasks) ? input.countdownTasks : initial.countdownTasks,
    todos: (Array.isArray(input.todos) ? input.todos : initial.todos).map(task => normalizeTodoTask(task)),
    archives: Array.isArray(input.archives) ? input.archives : initial.archives,
    powerEvents: Array.isArray(input.powerEvents) ? input.powerEvents : initial.powerEvents,
    pluginConnections: Array.isArray(input.pluginConnections) ? input.pluginConnections : initial.pluginConnections,
    diagnosticLogs: Array.isArray(input.diagnosticLogs)
      ? input.diagnosticLogs
          .filter(item => item && typeof item.message === 'string' && item.message.trim())
          .map(item => ({
            id: typeof item.id === 'string' && item.id.trim() ? item.id : `log-${Date.now()}`,
            level: item.level === 'warn' || item.level === 'error' ? item.level : 'info',
            message: item.message.trim(),
            detail: typeof item.detail === 'string' ? item.detail : '',
            occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : new Date().toISOString(),
          }))
      : initial.diagnosticLogs,
    dataDirectoryPath:
      typeof input.dataDirectoryPath === 'string' ? input.dataDirectoryPath : initial.dataDirectoryPath,
    logFilePath: typeof input.logFilePath === 'string' ? input.logFilePath : initial.logFilePath,
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
    isWindowHiddenToTray: Boolean(input.isWindowHiddenToTray),
    displayMode: typeof input.displayMode === 'string' ? input.displayMode : initial.displayMode,
    uiState: normalizedUiState,
    runtimeState: normalizedRuntimeState,
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
    uiState: state.uiState,
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
      lastFocusAt:
        typeof item.lastFocusAt === 'string'
          ? item.lastFocusAt
          : typeof (item as { lastSeenAt?: unknown }).lastSeenAt === 'string'
            ? String((item as { lastSeenAt?: unknown }).lastSeenAt)
            : '',
      longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
        ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
        : 0,
    })),
    processTimeline: Array.isArray(incoming.processTimeline) ? incoming.processTimeline : prev.processTimeline,
    inputActivityStats: Array.isArray(incoming.inputActivityStats) ? incoming.inputActivityStats : prev.inputActivityStats,
    inputActivityTimeline: Array.isArray(incoming.inputActivityTimeline)
      ? incoming.inputActivityTimeline
      : prev.inputActivityTimeline,
    currentProcessKeys: incoming.currentProcessKeys,
    currentProcessRuntimeStats: incoming.currentProcessRuntimeStats,
    processTagStats: incoming.processTagStats.map(item => ({
      ...item,
      lastFocusAt:
        typeof item.lastFocusAt === 'string'
          ? item.lastFocusAt
          : typeof (item as { lastSeenAt?: unknown }).lastSeenAt === 'string'
            ? String((item as { lastSeenAt?: unknown }).lastSeenAt)
            : '',
      longestContinuousFocusSeconds: Number.isFinite(Number(item.longestContinuousFocusSeconds))
        ? Math.max(0, Math.floor(Number(item.longestContinuousFocusSeconds)))
        : 0,
    })),
    powerEvents: incoming.powerEvents,
    pluginConnections: incoming.pluginConnections,
    diagnosticLogs: incoming.diagnosticLogs,
    dataDirectoryPath: incoming.dataDirectoryPath,
    logFilePath: incoming.logFilePath,
    currentFocusedWindow: focused,
    isWindowHiddenToTray: Boolean(incoming.isWindowHiddenToTray),
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
  const stateRef = useRef(state);
  const lastSavedUserStateRef = useRef<string>('');
  const soundStateRef = useRef({
    settings: state.pomodoroSettings,
    soundFiles: state.soundFiles,
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      const dueTodos = stateRef.current.todos.filter(
        todo =>
          shouldTriggerReminder(todo, now) &&
          todo.lastReminderStamp !== buildReminderStamp(todo, now),
      );
      if (dueTodos.length === 0) {
        return;
      }

      const dueStamps = new Map(
        dueTodos.map(todo => [todo.id, buildReminderStamp(todo, now)]),
      );
      setState(prev => ({
        ...prev,
        todos: prev.todos.map(todo =>
          dueStamps.has(todo.id)
            ? {
                ...todo,
                lastReminderStamp: dueStamps.get(todo.id),
                updatedAt: now.toISOString(),
              }
            : todo,
        ),
      }));

      const reminderTodos = dueTodos.filter(todo => todo.scheduledAction !== 'shutdown');
      const shutdownTodos = dueTodos.filter(todo => todo.scheduledAction === 'shutdown');

      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          reminderTodos.forEach(todo => {
            new Notification('待办提醒', { body: todo.title });
          });
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission();
        }
      }

      reminderTodos.forEach(todo => {
        toast.info('待办提醒', { description: todo.title });
      });

      if (reminderTodos.length > 0) {
        const { settings, soundFiles } = soundStateRef.current;
        const playback = resolveSoundPlaybackForEvent(settings, soundFiles, 'completion');
        void playSoundById(soundFiles, {
          enabled: settings.soundEnabled,
          soundFileId: playback.soundFileId,
          eventVolumeMultiplier: playback.eventVolumeMultiplier,
        });
      }

      const shutdownTodo = shutdownTodos[0];
      if (shutdownTodo) {
        if (!window.desktopApi?.shutdownSystem) {
          toast.error('定时关机失败', { description: '当前环境不支持系统关机' });
          return;
        }
        void window.desktopApi.shutdownSystem({
          taskId: shutdownTodo.id,
          title: shutdownTodo.title,
          stamp: dueStamps.get(shutdownTodo.id) || buildReminderStamp(shutdownTodo, now),
        }).then(result => {
          if (!result.ok) {
            toast.error('定时关机失败', { description: result.error || '无法执行系统关机' });
          }
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      let completionMessage: { title: string; body: string } | null = null;
      let distractionMessage: { title: string; body: string } | null = null;
      let shouldPlayCompletionSound = false;
      let shouldPlayDistractionSound = false;

      setState(prev => {
        const runtime = prev.runtimeState.pomodoro;
        if (!runtime.isRunning) {
          return prev;
        }

        const queue = prev.queue;
        const queueLength = queue.length;
        const currentQueueIdx = Math.max(0, Math.min(queueLength - 1, runtime.currentQueueIdx));
        const currentItem = queue[currentQueueIdx];
        const currentFocusSeconds = getFocusSecondsForQueueIndex(queue, currentQueueIdx);

        if (queueLength === 0 || !currentItem) {
          return {
            ...prev,
            runtimeState: {
              ...prev.runtimeState,
              pomodoro: {
                ...runtime,
                isRunning: false,
                hasStartedCurrentStage: false,
                currentCycle: 1,
                currentQueueIdx: 0,
                secondsLeft: FALLBACK_FOCUS_MINUTES * 60,
                timerEndsAtMs: undefined,
                offTargetSeconds: 0,
                offTargetAccumulatedMs: 0,
                distractionAlerted: false,
                distractionLastTickAtMs: undefined,
              },
            },
          };
        }

        const lastTickAtMs = Number.isFinite(runtime.distractionLastTickAtMs)
          ? Number(runtime.distractionLastTickAtMs)
          : nowMs;
        const deltaMs = Math.max(0, nowMs - lastTickAtMs);
        const hasTargetWindows = currentItem.windowGroup.length > 0;
        const focusedClassificationKey = prev.currentFocusedWindow?.classificationKey;
        const hasIdentifiedFocus = typeof focusedClassificationKey === 'string' && focusedClassificationKey.length > 0;
        const isFocusedInTarget =
          hasIdentifiedFocus && matchesAnyWindowGroup(currentItem.windowGroup, prev.currentFocusedWindow);
        const shouldTreatUnknownFocusAsOffTarget = hasTargetWindows && !hasIdentifiedFocus;
        const isDefinitelyOffTarget =
          hasTargetWindows &&
          !isFocusedInTarget &&
          (hasIdentifiedFocus || shouldTreatUnknownFocusAsOffTarget);

        const effectiveTimerEndMs =
          Number.isFinite(runtime.timerEndsAtMs) && (runtime.timerEndsAtMs ?? 0) > 0
            ? Number(runtime.timerEndsAtMs)
            : nowMs + Math.max(0, runtime.secondsLeft) * 1000;
        const adjustedTimerEndMs =
          isDefinitelyOffTarget && deltaMs > 0
            ? effectiveTimerEndMs + deltaMs
            : effectiveTimerEndMs;
        let nextRuntime = {
          ...runtime,
          hasStartedCurrentStage: true,
          timerEndsAtMs: adjustedTimerEndMs,
          currentQueueIdx,
          secondsLeft: Math.max(0, runtime.secondsLeft),
        };

        const remainingMs = adjustedTimerEndMs - nowMs;
        if (remainingMs <= 0) {
          shouldPlayCompletionSound = true;
          const isInfiniteCycle = prev.pomodoroSettings.cycleCount <= 0;
          const reachedCycleLimit = !isInfiniteCycle && nextRuntime.currentCycle >= prev.pomodoroSettings.cycleCount;

          if (reachedCycleLimit) {
            const nextQueueIndex = nextRuntime.currentQueueIdx + 1;
            if (nextQueueIndex < queueLength) {
              nextRuntime = {
                ...nextRuntime,
                isRunning: false,
                hasStartedCurrentStage: false,
                currentQueueIdx: nextQueueIndex,
                currentCycle: 1,
                secondsLeft: getFocusSecondsForQueueIndex(queue, nextQueueIndex),
                timerEndsAtMs: undefined,
              };
              completionMessage = {
                title: '专注到点',
                body: `${currentItem.title} 已完成，已切换到下一个计划`,
              };
            } else {
              nextRuntime = {
                ...nextRuntime,
                isRunning: false,
                hasStartedCurrentStage: false,
                currentQueueIdx: 0,
                currentCycle: 1,
                secondsLeft: getFocusSecondsForQueueIndex(queue, 0),
                timerEndsAtMs: undefined,
              };
              completionMessage = {
                title: '专注到点',
                body: '队列计划已全部完成',
              };
            }
          } else {
            nextRuntime = {
              ...nextRuntime,
              isRunning: false,
              hasStartedCurrentStage: false,
              currentCycle: nextRuntime.currentCycle + 1,
              secondsLeft: currentFocusSeconds,
              timerEndsAtMs: undefined,
            };
            completionMessage = {
              title: '专注到点',
              body: `${currentItem.title} 本轮已完成`,
            };
          }

          nextRuntime = {
            ...nextRuntime,
            offTargetSeconds: 0,
            offTargetAccumulatedMs: 0,
            distractionAlerted: false,
            distractionLastTickAtMs: undefined,
          };

          return {
            ...prev,
            runtimeState: {
              ...prev.runtimeState,
              pomodoro: nextRuntime,
            },
          };
        }

        const nextSeconds = Math.ceil(remainingMs / 1000);
        let offTargetAccumulatedMs = Math.max(0, runtime.offTargetAccumulatedMs);
        let offTargetSeconds = Math.max(0, runtime.offTargetSeconds);
        let distractionAlerted = Boolean(runtime.distractionAlerted);

        if (!hasTargetWindows) {
          offTargetAccumulatedMs = 0;
          offTargetSeconds = 0;
          distractionAlerted = false;
        } else if (deltaMs > 0 && (hasIdentifiedFocus || shouldTreatUnknownFocusAsOffTarget)) {
          if (isFocusedInTarget) {
            if (prev.pomodoroSettings.distractionMode === '连续' || prev.pomodoroSettings.distractionMode === '杩炵画') {
              offTargetAccumulatedMs = 0;
              offTargetSeconds = 0;
              distractionAlerted = false;
            }
          } else {
            offTargetAccumulatedMs += deltaMs;
            offTargetSeconds = Math.floor(offTargetAccumulatedMs / 1000);
            const thresholdSeconds = Math.max(
              1,
              Math.floor(Number(prev.pomodoroSettings.distractionThresholdMinutes) || 1),
            ) * 60;
            if (prev.pomodoroSettings.notifyEnabled && offTargetSeconds >= thresholdSeconds && !distractionAlerted) {
              distractionAlerted = true;
              shouldPlayDistractionSound = true;
              distractionMessage = {
                title: '偏离提醒',
                body: `${currentItem.title} 已偏离目标窗口`,
              };
            }
          }
        }

        const changed =
          nextSeconds !== runtime.secondsLeft ||
          currentQueueIdx !== runtime.currentQueueIdx ||
          offTargetSeconds !== runtime.offTargetSeconds ||
          offTargetAccumulatedMs !== runtime.offTargetAccumulatedMs ||
          distractionAlerted !== runtime.distractionAlerted ||
          adjustedTimerEndMs !== runtime.timerEndsAtMs ||
          nowMs !== runtime.distractionLastTickAtMs;

        if (!changed) {
          return prev;
        }

        return {
          ...prev,
          runtimeState: {
            ...prev.runtimeState,
            pomodoro: {
              ...nextRuntime,
              secondsLeft: nextSeconds,
              offTargetSeconds,
              offTargetAccumulatedMs,
              distractionAlerted,
              distractionLastTickAtMs: nowMs,
            },
          },
        };
      });

      const notify = async (message: { title: string; body: string }) => {
        if (window.desktopApi?.notify) {
          try {
            await window.desktopApi.notify({ title: message.title, body: message.body });
            return;
          } catch {
            // Fallback to browser Notification API.
          }
        }
        if (!('Notification' in window)) {
          return;
        }
        const push = () => {
          try {
            new Notification(message.title, { body: message.body });
          } catch {
            // Ignore notification failures.
          }
        };
        if (Notification.permission === 'granted') {
          push();
          return;
        }
        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            push();
          }
        }
      };

      if (completionMessage) {
        toast.success(completionMessage.title, { description: completionMessage.body });
        void notify(completionMessage);
        if (shouldPlayCompletionSound) {
          const { settings, soundFiles } = soundStateRef.current;
          const playback = resolveSoundPlaybackForEvent(settings, soundFiles, 'completion');
          void playSoundById(soundFiles, {
            enabled: settings.soundEnabled,
            soundFileId: playback.soundFileId,
            eventVolumeMultiplier: playback.eventVolumeMultiplier,
          });
        }
      }

      if (distractionMessage) {
        toast.warning(distractionMessage.title, { description: distractionMessage.body });
        void notify(distractionMessage);
        if (shouldPlayDistractionSound) {
          const { settings, soundFiles } = soundStateRef.current;
          const playback = resolveSoundPlaybackForEvent(settings, soundFiles, 'distraction');
          void playSoundById(soundFiles, {
            enabled: settings.soundEnabled,
            soundFileId: playback.soundFileId,
            eventVolumeMultiplier: playback.eventVolumeMultiplier,
          });
        }
      }
    }, 250);

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
      runtimeState: normalizeRuntimeState(
        {
          ...s.runtimeState,
          pomodoro: {
            ...s.runtimeState.pomodoro,
            secondsLeft: s.runtimeState.pomodoro.isRunning
              ? s.runtimeState.pomodoro.secondsLeft
              : getFocusSecondsForQueueIndex(queue, s.runtimeState.pomodoro.currentQueueIdx),
          },
        },
        s.runtimeState,
        queue,
      ),
    }));
  }, []);

  const addToQueue = useCallback((item: FocusQueueItem) => {
    setState(s => ({
      ...s,
      queue: [...s.queue, { ...item, orderIndex: s.queue.length }],
      runtimeState: normalizeRuntimeState(
        s.runtimeState,
        s.runtimeState,
        [...s.queue, { ...item, orderIndex: s.queue.length }],
      ),
    }));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setState(s => {
      const nextQueue = s.queue
        .filter(item => item.id !== id)
        .map((item, index) => ({ ...item, orderIndex: index }));
      return {
        ...s,
        queue: nextQueue,
        runtimeState: normalizeRuntimeState(
          {
            ...s.runtimeState,
            pomodoro: {
              ...s.runtimeState.pomodoro,
              isRunning: nextQueue.length === 0 ? false : s.runtimeState.pomodoro.isRunning,
              timerEndsAtMs: nextQueue.length === 0 ? undefined : s.runtimeState.pomodoro.timerEndsAtMs,
              secondsLeft:
                nextQueue.length === 0
                  ? FALLBACK_FOCUS_MINUTES * 60
                  : s.runtimeState.pomodoro.isRunning
                    ? s.runtimeState.pomodoro.secondsLeft
                    : getFocusSecondsForQueueIndex(nextQueue, s.runtimeState.pomodoro.currentQueueIdx),
            },
          },
          s.runtimeState,
          nextQueue,
        ),
      };
    });
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

  const updateUiState = useCallback((partial: Partial<AppUiState>) => {
    setState(s => ({
      ...s,
      uiState: normalizeUiState({ ...s.uiState, ...partial }, s.uiState),
    }));
  }, []);

  const updateRuntimeState = useCallback((partial: Partial<AppRuntimeState>) => {
    setState(s => ({
      ...s,
      runtimeState: normalizeRuntimeState(
        { ...s.runtimeState, ...partial },
        s.runtimeState,
        s.queue,
      ),
    }));
  }, []);

  const updatePreferences = useCallback((partial: Partial<AppPreferences>) => {
    setState(s => ({
      ...s,
      preferences: normalizePreferences({ ...s.preferences, ...partial }, s.preferences),
    }));
  }, []);

  const mergeRecordsByWhitelist = useCallback(async () => {
    if (!isElectronRuntime() || !window.desktopApi?.mergeRecordsByWhitelist) {
      return 0;
    }
    const userState = extractUserState(state);
    const snapshot = JSON.stringify(userState);
    await window.desktopApi.saveUserState(userState);
    lastSavedUserStateRef.current = snapshot;
    const result = await window.desktopApi.mergeRecordsByWhitelist();
    if (!result?.ok || !result.state) {
      return 0;
    }
    const normalized = normalizeState(result.state);
    setState(normalized);
    lastSavedUserStateRef.current = JSON.stringify(extractUserState(normalized));
    return Number.isFinite(Number(result.changedCount)) ? Math.max(0, Math.floor(Number(result.changedCount))) : 0;
  }, [state]);

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

  const clearDiagnosticLogs = useCallback(async () => {
    if (isElectronRuntime() && window.desktopApi?.clearDiagnosticLogs) {
      await window.desktopApi.clearDiagnosticLogs();
      return;
    }
    setState(s => ({ ...s, diagnosticLogs: [] }));
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

  const updateArchiveInsight = useCallback((recordId: string, taskId: string, insight: string) => {
    setState(s => {
      const hasArchiveRecord = s.archives.some(record => record.id === recordId);
      const now = new Date().toISOString();

      if (hasArchiveRecord) {
        return {
          ...s,
          archives: s.archives.map(record =>
            record.id === recordId
              ? {
                  ...record,
                  insightSnapshot: insight,
                  taskSnapshotJson: patchArchiveSnapshotInsight(record.taskSnapshotJson, insight),
                }
              : record,
          ),
        };
      }

      return {
        ...s,
        todos: s.todos.map(todo =>
          todo.id === taskId && todo.isArchived
            ? { ...todo, currentInsight: insight, updatedAt: now }
            : todo,
        ),
      };
    });
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

    if (isElectronRuntime() && window.desktopApi?.deleteMonitoringRecords) {
      void window.desktopApi.deleteMonitoringRecords({ classificationKeys: [...keySet] });
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
        processTimeline: s.processTimeline.filter(item => !keySet.has(item.classificationKey)),
        inputActivityStats: s.inputActivityStats.filter(item => !keySet.has(item.classificationKey)),
        inputActivityTimeline: s.inputActivityTimeline.filter(item => !keySet.has(item.classificationKey)),
        currentProcessKeys: s.currentProcessKeys.filter(key => !keySet.has(key)),
        currentProcessRuntimeStats: s.currentProcessRuntimeStats.filter(item => !keySet.has(item.classificationKey)),
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
      updateUiState,
      updateRuntimeState,
      updatePreferences,
      mergeRecordsByWhitelist,
      clearAllData,
      clearDiagnosticLogs,
      addSoundFile,
      updateSoundFile,
      deleteSoundFile,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      updateArchiveInsight,
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
      updateUiState,
      updateRuntimeState,
      updatePreferences,
      mergeRecordsByWhitelist,
      clearAllData,
      clearDiagnosticLogs,
      addSoundFile,
      updateSoundFile,
      deleteSoundFile,
      addTodo,
      updateTodo,
      completeTodo,
      deleteTodo,
      updateArchiveInsight,
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
