export type Category = '学习' | '娱乐' | '社交' | '休息' | '其他';
export type ObjectType = 'AppWindow' | 'BrowserTab' | 'Desktop';
export type DistractionMode = '连续' | '累计';
export type TaskType = '一次性' | '重复';
export type RepeatMode = '每日' | '每周' | '每月' | '自定义';
export type FocusQueueItemType = 'Subject' | 'AdHocWindowGroup';

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

export interface WindowGroupItem {
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
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

export interface PomodoroSettings {
  focusMinutes: number;
  breakMinutes: number;
  focusPageId?: string;
  distractionThresholdMinutes: number;
  distractionMode: DistractionMode;
  notifyEnabled: boolean;
  soundEnabled: boolean;
  cycleCount: number;
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
  subjects: FocusSubject[];
  queue: FocusQueueItem[];
  pomodoroSettings: PomodoroSettings;
  todos: TodoTask[];
  archives: TodoArchiveRecord[];
  powerEvents: PowerEventRecord[];
  currentFocusedWindow: WindowClassificationProfile | null;
  displayMode: '显示性质' | '显示窗口';
}
