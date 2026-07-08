import { describe, expect, it } from 'vitest';
import { normalizeTodoTask, shouldTriggerReminder } from './todo';
import type { TodoTask } from '@/types';

function createTodo(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: 'todo-test',
    title: '测试待办',
    taskType: '一次性',
    reminderEnabled: true,
    scheduledAction: 'reminder',
    reminderHour: 9,
    reminderMinute: 30,
    reminderSecond: 0,
    currentInsight: '',
    isArchived: false,
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('todo scheduled action', () => {
  it('旧数据缺少动作类型时默认按定时提醒处理', () => {
    const legacy = {
      ...createTodo(),
      scheduledAction: undefined,
    } as unknown as TodoTask;

    expect(normalizeTodoTask(legacy).scheduledAction).toBe('reminder');
  });

  it('保留定时关机动作', () => {
    expect(normalizeTodoTask(createTodo({ scheduledAction: 'shutdown' })).scheduledAction).toBe('shutdown');
  });

  it('定时关机与提醒使用相同的到点规则', () => {
    const task = createTodo({ scheduledAction: 'shutdown' });

    expect(shouldTriggerReminder(task, new Date(2026, 6, 9, 9, 30, 0))).toBe(true);
    expect(shouldTriggerReminder(task, new Date(2026, 6, 9, 9, 30, 5))).toBe(true);
    expect(shouldTriggerReminder(task, new Date(2026, 6, 9, 9, 30, 10))).toBe(false);
  });
});
