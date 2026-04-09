import { RepeatMode, TaskType, TodoTask } from '@/types';

const TASK_TYPES: TaskType[] = ['一次性', '重复'];
const REPEAT_MODES: RepeatMode[] = ['每日', '每周', '每月', '自定义'];

interface PatternPhase {
  activeDays: number;
  skipDays: number;
  totalDays: number;
}

interface ParsedCustomPattern {
  phases: PatternPhase[];
  isInfinite: boolean;
}

export function normalizeTodoTask(input: TodoTask): TodoTask {
  const nowIso = new Date().toISOString();
  const taskType = normalizeTaskType(input.taskType);
  const repeatMode = taskType === '重复' ? normalizeRepeatMode(input.repeatMode) : undefined;
  const weeklyDays = repeatMode === '每周' ? normalizeDayList(input.weeklyDays, 1, 7) : undefined;
  const monthlyDays = repeatMode === '每月' ? normalizeDayList(input.monthlyDays, 1, 31) : undefined;
  const customPattern = repeatMode === '自定义' ? normalizePatternText(input.customPattern) : undefined;
  const reminderEnabled = !!input.reminderEnabled;
  const reminderYear = reminderEnabled ? clampOptionalInt(input.reminderYear, 1, 9999) : undefined;
  const reminderMonth = reminderEnabled ? clampOptionalInt(input.reminderMonth, 1, 12) : undefined;
  const reminderDay = reminderEnabled ? clampOptionalInt(input.reminderDay, 1, 31) : undefined;
  const reminderHour = reminderEnabled ? clampRequiredInt(input.reminderHour, 0, 23, 9) : undefined;
  const reminderMinute = reminderEnabled ? clampRequiredInt(input.reminderMinute, 0, 59, 0) : undefined;
  const reminderSecond = reminderEnabled ? clampRequiredInt(input.reminderSecond, 0, 59, 0) : undefined;

  return {
    ...input,
    title: (input.title ?? '').trim(),
    taskType,
    repeatMode,
    weeklyDays,
    monthlyDays,
    customPattern,
    reminderEnabled,
    reminderYear,
    reminderMonth,
    reminderDay,
    reminderHour,
    reminderMinute,
    reminderSecond,
    currentInsight: input.currentInsight ?? '',
    lastReminderStamp: input.lastReminderStamp,
    isArchived: !!input.isArchived,
    createdAt: input.createdAt || nowIso,
    updatedAt: input.updatedAt || nowIso,
    completedAt: input.completedAt,
  };
}

export function validateTodoTask(task: TodoTask): string | null {
  if (!task.title.trim()) {
    return '标题不能为空';
  }

  if (task.taskType !== '重复') {
    if (task.reminderEnabled && !isValidReminderDateCombination(task.reminderYear, task.reminderMonth, task.reminderDay)) {
      return '提醒日期组合不合法';
    }

    return null;
  }

  if (task.repeatMode === '每周' && (!task.weeklyDays || task.weeklyDays.length === 0)) {
    return '每周任务至少选择一天';
  }

  if (task.repeatMode === '每月' && (!task.monthlyDays || task.monthlyDays.length === 0)) {
    return '每月任务至少选择一天';
  }

  if (task.repeatMode === '自定义') {
    const parsed = parseCustomPattern(task.customPattern);
    if (!parsed) {
      return '自定义周期格式无效';
    }
  }

  if (task.reminderEnabled && !isValidReminderDateCombination(task.reminderYear, task.reminderMonth, task.reminderDay)) {
    return '提醒日期组合不合法';
  }

  return null;
}

export function shouldTriggerReminder(task: TodoTask, now: Date): boolean {
  if (task.isArchived || !task.reminderEnabled) {
    return false;
  }

  if (!isTodoScheduledForDate(task, now)) {
    return false;
  }

  if (task.reminderYear && task.reminderYear !== now.getFullYear()) {
    return false;
  }

  if (task.reminderMonth && task.reminderMonth !== now.getMonth() + 1) {
    return false;
  }

  if (task.reminderDay && task.reminderDay !== now.getDate()) {
    return false;
  }

  return (task.reminderHour ?? 0) === now.getHours() &&
    (task.reminderMinute ?? 0) === now.getMinutes() &&
    (task.reminderSecond ?? 0) === now.getSeconds();
}

export function buildReminderStamp(now: Date): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  const hh = `${now.getHours()}`.padStart(2, '0');
  const mm = `${now.getMinutes()}`.padStart(2, '0');
  const ss = `${now.getSeconds()}`.padStart(2, '0');
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

export function isTodoScheduledForDate(task: TodoTask, date: Date): boolean {
  if (task.taskType !== '重复') {
    return true;
  }

  if (task.repeatMode === '每日' || !task.repeatMode) {
    return true;
  }

  if (task.repeatMode === '每周') {
    const weekday = toWeekdayIndex(date.getDay());
    const selected = normalizeDayList(task.weeklyDays, 1, 7);
    return selected.includes(weekday);
  }

  if (task.repeatMode === '每月') {
    const selected = normalizeDayList(task.monthlyDays, 1, 31);
    return selected.includes(date.getDate());
  }

  const parsed = parseCustomPattern(task.customPattern);
  if (!parsed || parsed.phases.length === 0) {
    return false;
  }

  const startDate = new Date(task.createdAt);
  startDate.setHours(0, 0, 0, 0);
  const current = new Date(date);
  current.setHours(0, 0, 0, 0);
  const offsetDays = Math.floor((current.getTime() - startDate.getTime()) / 86400000);
  if (offsetDays < 0) {
    return false;
  }

  if (parsed.isInfinite) {
    const cycleLength = parsed.phases.reduce((sum, phase) => sum + phase.totalDays, 0);
    if (cycleLength <= 0) {
      return false;
    }

    let cursor = offsetDays % cycleLength;
    for (const phase of parsed.phases) {
      if (cursor < phase.totalDays) {
        return cursor < phase.activeDays;
      }

      cursor -= phase.totalDays;
    }

    return false;
  }

  let cursor = offsetDays;
  for (const phase of parsed.phases) {
    if (cursor < phase.totalDays) {
      return cursor < phase.activeDays;
    }

    cursor -= phase.totalDays;
  }

  return false;
}

function normalizeTaskType(value: string | undefined): TaskType {
  return TASK_TYPES.includes(value as TaskType) ? (value as TaskType) : '一次性';
}

function normalizeRepeatMode(value: string | undefined): RepeatMode {
  return REPEAT_MODES.includes(value as RepeatMode) ? (value as RepeatMode) : '每日';
}

function normalizeDayList(list: number[] | undefined, min: number, max: number): number[] {
  if (!Array.isArray(list)) {
    return [];
  }

  return [...new Set(list
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item >= min && item <= max))]
    .sort((a, b) => a - b);
}

function normalizePatternText(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .join(',');
}

function clampRequiredInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clampOptionalInt(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const rounded = Math.floor(parsed);
  return rounded < min || rounded > max ? undefined : rounded;
}

function parseCustomPattern(pattern: string | undefined): ParsedCustomPattern | null {
  if (!pattern?.trim()) {
    return null;
  }

  const raw = pattern.split(',').map(part => part.trim()).filter(Boolean);
  if (raw.length === 0) {
    return null;
  }

  const values = raw.map(part => Number(part));
  if (values.some(value => !Number.isInteger(value))) {
    return null;
  }

  const isInfinite = values.length > 0 && values[values.length - 1] === -1;
  const workValues = isInfinite ? values.slice(0, -1) : values;
  if (workValues.length === 0) {
    return null;
  }

  if (workValues.some(value => value < 0)) {
    return null;
  }

  const phases: PatternPhase[] = [];
  for (let i = 0; i < workValues.length; i += 2) {
    const active = workValues[i] ?? 0;
    const skip = workValues[i + 1] ?? 0;
    const total = active + skip;
    if (total > 0) {
      phases.push({
        activeDays: active,
        skipDays: skip,
        totalDays: total,
      });
    }
  }

  if (phases.length === 0) {
    return null;
  }

  return { phases, isInfinite };
}

function toWeekdayIndex(day: number): number {
  return day === 0 ? 7 : day;
}

function isValidReminderDateCombination(year?: number, month?: number, day?: number): boolean {
  if (!day) {
    return true;
  }

  if (!month) {
    return day >= 1 && day <= 31;
  }

  if (!year) {
    return [2024, 2025, 2026, 2027].some(testYear => day <= new Date(testYear, month, 0).getDate());
  }

  return day <= new Date(year, month, 0).getDate();
}
