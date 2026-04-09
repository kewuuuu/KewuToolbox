import { AppState } from '@/types';

export function createInitialState(): AppState {
  return {
    profiles: [],
    sessions: [],
    windowStats: [],
    subjects: [],
    queue: [],
    pomodoroSettings: {
      focusMinutes: 25,
      breakMinutes: 5,
      distractionThresholdMinutes: 1,
      distractionMode: '连续',
      notifyEnabled: true,
      soundEnabled: true,
      cycleCount: 0,
    },
    todos: [],
    archives: [],
    powerEvents: [],
    currentFocusedWindow: null,
    displayMode: '显示性质',
  };
}
