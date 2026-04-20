import { AppState } from '@/types';
import {
  BUILTIN_COMPLETION_SOUND_ID,
  BUILTIN_WARNING_SOUND_ID,
  createDefaultSoundFiles,
} from '@/data/defaultSoundFiles';

const FALLBACK_FOCUS_MINUTES = 25;
const FALLBACK_COUNTDOWN_SECONDS = 5 * 60;

function createDefaultProcessBlacklistRules(now = new Date().toISOString()) {
  return [
    {
      id: 'bl-default-explorer-app-window',
      typePattern: 'AppWindow',
      processPattern: 'explorer.exe',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createInitialState(): AppState {
  return {
    profiles: [],
    sessions: [],
    windowStats: [],
    currentProcessKeys: [],
    processTags: [],
    processTagAssignments: [],
    processTagStats: [],
    soundFiles: createDefaultSoundFiles(),
    preferences: {
      recordWindowThresholdSeconds: 60,
      uiTheme: 'dark',
      autoLaunchEnabled: false,
      urlWhitelist: [],
      processBlacklist: createDefaultProcessBlacklistRules(),
      countdownCompletedTaskBehavior: 'keep',
      closeWindowBehavior: 'ask',
    },
    subjects: [],
    queue: [],
    pomodoroSettings: {
      focusMinutes: 25,
      breakMinutes: 5,
      distractionThresholdMinutes: 1,
      distractionMode: '连续',
      notifyEnabled: true,
      soundEnabled: true,
      completionSoundFileId: BUILTIN_COMPLETION_SOUND_ID,
      completionVolumeMode: 'unbalanced',
      completionVolumeMultiplier: 1,
      completionBalancedTargetDb: -18,
      distractionSoundFileId: BUILTIN_WARNING_SOUND_ID,
      distractionVolumeMode: 'unbalanced',
      distractionVolumeMultiplier: 1,
      distractionBalancedTargetDb: -18,
      countdownSoundFileId: BUILTIN_COMPLETION_SOUND_ID,
      countdownVolumeMode: 'unbalanced',
      countdownVolumeMultiplier: 1,
      countdownBalancedTargetDb: -18,
      cycleCount: 0,
    },
    stopwatchRecords: [],
    countdownTasks: [],
    todos: [],
    archives: [],
    powerEvents: [],
    currentFocusedWindow: null,
    isWindowHiddenToTray: false,
    displayMode: '显示性质',
    uiState: {
      calculatorExpression: '',
      monitoring: {
        activeTab: 'history',
        historySort: {
          key: 'lastFocus',
          direction: 'desc',
        },
        currentSort: {
          key: 'lastFocus',
          direction: 'desc',
        },
      },
      clock: {
        newCountdownTitle: '',
        newCountdownSeconds: String(FALLBACK_COUNTDOWN_SECONDS),
      },
    },
    runtimeState: {
      pomodoro: {
        secondsLeft: FALLBACK_FOCUS_MINUTES * 60,
        isRunning: false,
        hasStartedCurrentStage: false,
        currentCycle: 1,
        currentQueueIdx: 0,
        offTargetSeconds: 0,
        offTargetAccumulatedMs: 0,
        distractionAlerted: false,
      },
      stopwatch: {
        isRunning: false,
        elapsedMs: 0,
        laps: [],
      },
    },
  };
}
