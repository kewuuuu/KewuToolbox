export type Category = string;
export type ObjectType = 'AppWindow' | 'BrowserTab' | 'Desktop';
export type DistractionMode = string;
export type TaskType = string;
export type RepeatMode = string;
export type FocusQueueItemType = 'Subject' | 'AdHocWindowGroup';
export type UiTheme = 'dark' | 'light';
export type CountdownCompletedTaskBehavior = 'keep' | 'delete';
export type CloseWindowBehavior = 'ask' | 'close' | 'tray';
export type SoundVolumeMode = 'unbalanced' | 'balanced';
export type MonitoringSortKey =
  | 'displayName'
  | 'objectType'
  | 'processName'
  | 'category'
  | 'tag'
  | 'totalVisible'
  | 'focusTime'
  | 'lastFocus'
  | 'longestContinuousFocus';
export type MonitoringSortDirection = 'asc' | 'desc';
export type MonitoringTab = 'history' | 'current' | 'tags' | 'events' | 'debug';

export interface WindowClassificationProfile {
  id: string;
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  browserName?: string;
  normalizedTitle: string;
  domain?: string;
  category: Category;
  isBuiltIn: boolean;
  updatedAt: string;
}

export interface FocusSession {
  id: string;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  categoryAtThatTime: Category;
  processName: string;
  windowTitle: string;
  browserTabTitle?: string;
  domain?: string;
  isDesktop: boolean;
}

export interface WindowRuntimeStat {
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  domain?: string;
  category: Category;
  totalVisibleSeconds: number;
  focusSeconds: number;
  lastFocusAt: string;
  longestContinuousFocusSeconds: number;
}

export interface ProcessTag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessTagAssignment {
  classificationKey: string;
  tagId: string;
  assignedAt: string;
  updatedAt: string;
}

export interface ProcessTagRuntimeStat {
  tagId: string;
  totalVisibleSeconds: number;
  focusSeconds: number;
  lastFocusAt: string;
  longestContinuousFocusSeconds: number;
}

export interface WindowGroupItem {
  classificationKey: string;
  displayName: string;
  objectType?: ObjectType;
  processName?: string;
  matchMode?: 'exact' | 'pattern';
  namePattern?: string;
  typePattern?: string;
  processPattern?: string;
}

export interface FocusSubject {
  id: string;
  title: string;
  defaultMinutes: number;
  windowGroup: WindowGroupItem[];
  createdAt: string;
  updatedAt: string;
}

export interface FocusQueueItem {
  id: string;
  itemType: FocusQueueItemType;
  title: string;
  durationMinutes: number;
  windowGroup: WindowGroupItem[];
  sourceSubjectId?: string;
  orderIndex: number;
}

export interface SoundFileItem {
  id: string;
  name: string;
  filePath: string;
  defaultVolumeMultiplier: number;
  createdAt: string;
  updatedAt: string;
}

export interface SoundBalanceCache {
  soundFileId: string;
  soundFileUpdatedAt: string;
  targetDb: number;
  measuredAverageDb: number;
  measuredPeakDb: number;
  normalizedGain: number;
  generatedAt: string;
}

export interface UrlWhitelistRule {
  id: string;
  name: string;
  pattern: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessBlacklistRule {
  id: string;
  namePattern?: string;
  typePattern?: string;
  processPattern?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppPreferences {
  recordWindowThresholdSeconds: number;
  uiTheme: UiTheme;
  autoLaunchEnabled: boolean;
  urlWhitelist: UrlWhitelistRule[];
  processBlacklist: ProcessBlacklistRule[];
  countdownCompletedTaskBehavior: CountdownCompletedTaskBehavior;
  closeWindowBehavior: CloseWindowBehavior;
}

export interface PomodoroSettings {
  focusMinutes: number;
  breakMinutes: number;
  focusPageId?: string;
  distractionThresholdMinutes: number;
  distractionMode: DistractionMode;
  notifyEnabled: boolean;
  soundEnabled: boolean;
  completionSoundFileId: string;
  completionVolumeMode: SoundVolumeMode;
  completionVolumeMultiplier: number;
  completionBalancedTargetDb: number;
  completionBalanceCache?: SoundBalanceCache;
  distractionSoundFileId: string;
  distractionVolumeMode: SoundVolumeMode;
  distractionVolumeMultiplier: number;
  distractionBalancedTargetDb: number;
  distractionBalanceCache?: SoundBalanceCache;
  countdownSoundFileId: string;
  countdownVolumeMode: SoundVolumeMode;
  countdownVolumeMultiplier: number;
  countdownBalancedTargetDb: number;
  countdownBalanceCache?: SoundBalanceCache;
  cycleCount: number;
}

export interface MonitoringSortState {
  key: MonitoringSortKey;
  direction: MonitoringSortDirection;
}

export interface MonitoringUiState {
  activeTab: MonitoringTab;
  historySort: MonitoringSortState;
  currentSort: MonitoringSortState;
}

export interface ClockUiState {
  newCountdownTitle: string;
  newCountdownSeconds: string;
}

export interface AppUiState {
  calculatorExpression: string;
  monitoring: MonitoringUiState;
  clock: ClockUiState;
}

export interface PomodoroRuntimeState {
  secondsLeft: number;
  isRunning: boolean;
  hasStartedCurrentStage: boolean;
  currentCycle: number;
  currentQueueIdx: number;
  offTargetSeconds: number;
  timerEndsAtMs?: number;
  offTargetAccumulatedMs: number;
  distractionAlerted: boolean;
  distractionLastTickAtMs?: number;
}

export interface StopwatchRuntimeState {
  isRunning: boolean;
  elapsedMs: number;
  runStartedAtMs?: number;
  sessionStartedAt?: string;
  laps: StopwatchLap[];
}

export interface AppRuntimeState {
  pomodoro: PomodoroRuntimeState;
  stopwatch: StopwatchRuntimeState;
}

export interface StopwatchLap {
  id: string;
  elapsedMs: number;
  splitMs: number;
  note: string;
  createdAt: string;
}

export interface StopwatchRecord {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  totalElapsedMs: number;
  laps: StopwatchLap[];
  createdAt: string;
  updatedAt: string;
}

export interface CountdownTask {
  id: string;
  title: string;
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  completed: boolean;
  runStartedAt?: string;
  runInitialRemainingSeconds?: number;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoTask {
  id: string;
  title: string;
  taskType: TaskType;
  repeatMode?: RepeatMode;
  weeklyDays?: number[];
  monthlyDays?: number[];
  customPattern?: string;
  reminderEnabled: boolean;
  reminderYear?: number;
  reminderMonth?: number;
  reminderDay?: number;
  reminderHour?: number;
  reminderMinute?: number;
  reminderSecond?: number;
  currentInsight: string;
  lastReminderStamp?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TodoArchiveRecord {
  id: string;
  taskId: string;
  title: string;
  completedAt: string;
  insightSnapshot: string;
  taskSnapshotJson: string;
  occurrenceIndex: number;
}

export interface PowerEventRecord {
  id: string;
  eventType: string;
  occurredAt: string;
  detail: string;
  markerColor: string;
}

export interface AppState {
  profiles: WindowClassificationProfile[];
  sessions: FocusSession[];
  windowStats: WindowRuntimeStat[];
  currentProcessKeys: string[];
  processTags: ProcessTag[];
  processTagAssignments: ProcessTagAssignment[];
  processTagStats: ProcessTagRuntimeStat[];
  soundFiles: SoundFileItem[];
  preferences: AppPreferences;
  subjects: FocusSubject[];
  queue: FocusQueueItem[];
  pomodoroSettings: PomodoroSettings;
  stopwatchRecords: StopwatchRecord[];
  countdownTasks: CountdownTask[];
  todos: TodoTask[];
  archives: TodoArchiveRecord[];
  powerEvents: PowerEventRecord[];
  currentFocusedWindow: WindowClassificationProfile | null;
  isWindowHiddenToTray: boolean;
  displayMode: string;
  uiState: AppUiState;
  runtimeState: AppRuntimeState;
}

export type AppUserState = Pick<
  AppState,
  | 'profiles'
  | 'processTags'
  | 'processTagAssignments'
  | 'soundFiles'
  | 'preferences'
  | 'subjects'
  | 'queue'
  | 'pomodoroSettings'
  | 'stopwatchRecords'
  | 'countdownTasks'
  | 'todos'
  | 'archives'
  | 'displayMode'
  | 'uiState'
>;
