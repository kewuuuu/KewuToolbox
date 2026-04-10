import { AppState } from '@/types';
import { BUILTIN_COMPLETION_SOUND_ID, BUILTIN_WARNING_SOUND_ID, createDefaultSoundFiles } from '@/data/defaultSoundFiles';

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
      completionVolumeMultiplier: 1,
      distractionSoundFileId: BUILTIN_WARNING_SOUND_ID,
      distractionVolumeMultiplier: 1,
      cycleCount: 0,
    },
    todos: [],
    archives: [],
    powerEvents: [],
    currentFocusedWindow: null,
    displayMode: '显示性质',
  };
}
