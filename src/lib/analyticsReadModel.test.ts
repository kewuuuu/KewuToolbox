import { describe, expect, it } from 'vitest';
import {
  ALL_HEATMAP_CATEGORIES,
  buildHeatmap,
  buildMultiSeriesDailyTrend,
  buildTimelineItems,
  buildMonitoringRows,
  buildMonitoringTagStats,
  compileFocusSegments,
  getDayRange,
} from './analyticsReadModel';
import { AppState, FocusSession, ProcessTimelineRecord, WindowClassificationProfile } from '@/types';
import { createInitialState } from '@/data/initialState';

const profile: WindowClassificationProfile = {
  id: 'profile-a',
  classificationKey: 'app-a',
  displayName: '项目 A',
  objectType: 'AppWindow',
  processName: 'code.exe',
  normalizedTitle: '项目 A - Visual Studio Code',
  category: '学习',
  isBuiltIn: false,
  updatedAt: '2026-01-01T00:00:00',
};

function session(partial: Partial<FocusSession>): FocusSession {
  return {
    id: partial.id ?? 'session-a',
    startAt: partial.startAt ?? '2026-01-01T00:00:00',
    endAt: partial.endAt ?? '2026-01-01T00:10:00',
    durationSeconds: partial.durationSeconds ?? 600,
    classificationKey: partial.classificationKey ?? 'app-a',
    displayName: partial.displayName ?? '项目 A',
    objectType: partial.objectType ?? 'AppWindow',
    categoryAtThatTime: partial.categoryAtThatTime ?? '学习',
    processName: partial.processName ?? 'code.exe',
    windowTitle: partial.windowTitle ?? '项目 A - Visual Studio Code',
    isDesktop: partial.isDesktop ?? false,
  };
}

function presence(partial: Partial<ProcessTimelineRecord>): ProcessTimelineRecord {
  return {
    id: partial.id ?? 'presence-a',
    classificationKey: partial.classificationKey ?? 'app-a',
    displayName: partial.displayName ?? '项目 A',
    objectType: partial.objectType ?? 'AppWindow',
    processName: partial.processName ?? 'code.exe',
    categoryAtThatTime: partial.categoryAtThatTime ?? '学习',
    startAt: partial.startAt ?? '2026-01-01T00:00:00',
    endAt: partial.endAt ?? '2026-01-01T00:10:00',
    durationSeconds: partial.durationSeconds ?? 600,
    isOpen: partial.isOpen ?? false,
  };
}

describe('analyticsReadModel', () => {
  it('按查询范围裁剪跨天焦点记录', () => {
    const segments = compileFocusSegments(
      [
        session({
          startAt: '2026-01-01T23:50:00',
          endAt: '2026-01-02T00:10:00',
          durationSeconds: 1200,
        }),
      ],
      [profile],
      {
        startMs: new Date('2026-01-02T00:00:00').getTime(),
        endMs: new Date('2026-01-03T00:00:00').getTime(),
      },
    );

    expect(segments).toHaveLength(1);
    expect(Math.round(segments[0].durationSeconds)).toBe(600);
    expect(segments[0].category).toBe('学习');
  });

  it('保留会话的有效焦点时长，不把显示跨度直接当作统计时长', () => {
    const segments = compileFocusSegments(
      [
        session({
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 300,
        }),
      ],
      [profile],
      {
        startMs: new Date('2026-01-01T00:00:00').getTime(),
        endMs: new Date('2026-01-01T01:00:00').getTime(),
      },
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].durationSeconds).toBe(300);
  });

  it('热力图不会只按 startAt 归属日期，而是按当天重叠时长统计', () => {
    const heatmap = buildHeatmap(
      [
        session({
          startAt: '2026-01-01T23:50:00',
          endAt: '2026-01-02T00:10:00',
          durationSeconds: 1200,
        }),
      ],
      [profile],
      '学习',
      1,
      new Date('2026-01-02T12:00:00'),
    );

    expect(heatmap[0].date).toBe('2026-01-02');
    expect(heatmap[0].minutes).toBe(10);
  });

  it('热力图全部性质模式统计当天所有分类', () => {
    const entertainmentProfile: WindowClassificationProfile = {
      ...profile,
      id: 'profile-b',
      classificationKey: 'app-b',
      displayName: '游戏 B',
      processName: 'game.exe',
      normalizedTitle: '游戏 B',
      category: '娱乐',
    };
    const heatmap = buildHeatmap(
      [
        session({
          id: 'study',
          startAt: '2026-01-02T00:00:00',
          endAt: '2026-01-02T00:10:00',
          durationSeconds: 600,
        }),
        session({
          id: 'game',
          classificationKey: 'app-b',
          displayName: '游戏 B',
          processName: 'game.exe',
          categoryAtThatTime: '娱乐',
          startAt: '2026-01-02T00:10:00',
          endAt: '2026-01-02T00:30:00',
          durationSeconds: 1200,
        }),
      ],
      [profile, entertainmentProfile],
      ALL_HEATMAP_CATEGORIES,
      1,
      new Date('2026-01-02T12:00:00'),
    );

    expect(heatmap[0].minutes).toBe(30);
  });

  it('趋势图性质模式会输出总量和全部性质序列', () => {
    const socialProfile: WindowClassificationProfile = {
      ...profile,
      id: 'profile-social',
      classificationKey: 'app-social',
      displayName: '聊天',
      processName: 'chat.exe',
      normalizedTitle: '聊天',
      category: '社交',
    };
    const trend = buildMultiSeriesDailyTrend(
      [
        session({
          id: 'study',
          startAt: '2026-01-02T00:00:00',
          endAt: '2026-01-02T00:10:00',
          durationSeconds: 600,
        }),
        session({
          id: 'social',
          classificationKey: 'app-social',
          displayName: '聊天',
          processName: 'chat.exe',
          categoryAtThatTime: '社交',
          startAt: '2026-01-02T00:10:00',
          endAt: '2026-01-02T00:30:00',
          durationSeconds: 1200,
        }),
      ],
      [profile, socialProfile],
      'category',
      1,
      new Date('2026-01-02T12:00:00'),
      { categories: ['学习', '娱乐', '社交', '休息', '其他'] },
    );

    expect(trend.data[0].totalMinutes).toBe(30);
    expect(trend.series.map(item => item.name)).toEqual(['学习', '娱乐', '社交', '休息', '其他']);
    expect(trend.data[0][trend.series[0].key]).toBe(10);
    expect(trend.data[0][trend.series[2].key]).toBe(20);
  });

  it('趋势图窗口模式只输出聚焦时长最高的前 n 个窗口序列', () => {
    const secondProfile: WindowClassificationProfile = {
      ...profile,
      id: 'profile-b',
      classificationKey: 'app-b',
      displayName: '项目 B',
      normalizedTitle: '项目 B',
    };
    const thirdProfile: WindowClassificationProfile = {
      ...profile,
      id: 'profile-c',
      classificationKey: 'app-c',
      displayName: '项目 C',
      normalizedTitle: '项目 C',
    };
    const trend = buildMultiSeriesDailyTrend(
      [
        session({
          id: 'a',
          displayName: '项目 A',
          durationSeconds: 1800,
          endAt: '2026-01-01T00:30:00',
        }),
        session({
          id: 'b',
          classificationKey: 'app-b',
          displayName: '项目 B',
          durationSeconds: 1200,
          endAt: '2026-01-01T00:20:00',
        }),
        session({
          id: 'c',
          classificationKey: 'app-c',
          displayName: '项目 C',
          durationSeconds: 600,
          endAt: '2026-01-01T00:10:00',
        }),
      ],
      [profile, secondProfile, thirdProfile],
      'window',
      1,
      new Date('2026-01-01T12:00:00'),
      { windowLimit: 2 },
    );

    expect(trend.data[0].totalMinutes).toBe(60);
    expect(trend.series.map(item => item.name)).toEqual(['项目 A', '项目 B']);
    expect(trend.data[0][trend.series[0].key]).toBe(30);
    expect(trend.data[0][trend.series[1].key]).toBe(20);
  });

  it('时间线会按阈值忽略相邻同一焦点对象之间的短空隙', () => {
    const segments = compileFocusSegments(
      [
        session({
          id: 'first',
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 600,
        }),
        session({
          id: 'second',
          startAt: '2026-01-01T00:12:00',
          endAt: '2026-01-01T00:15:00',
          durationSeconds: 180,
        }),
      ],
      [profile],
      {
        startMs: new Date('2026-01-01T00:00:00').getTime(),
        endMs: new Date('2026-01-01T01:00:00').getTime(),
      },
    );
    const items = buildTimelineItems(
      segments,
      [],
      {
        startMs: new Date('2026-01-01T00:00:00').getTime(),
        endMs: new Date('2026-01-01T01:00:00').getTime(),
      },
      { mergeFocusGapSeconds: 180 },
    );

    expect(items).toHaveLength(1);
    expect(items[0].durationSeconds).toBe(900);
    expect(items[0].detail).toBe('AppWindow / 15分0秒');
    expect(items[0].detail).not.toContain('合并');
  });

  it('进程统计会把阈值内同一对象的焦点空隙计入总焦点时长', () => {
    const base = createInitialState();
    const state: AppState = {
      ...base,
      profiles: [profile],
      preferences: {
        ...base.preferences,
        recordWindowThresholdSeconds: 180,
      },
      processTimeline: [
        presence({
          id: 'presence-first',
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 600,
        }),
        presence({
          id: 'presence-second',
          startAt: '2026-01-01T00:12:00',
          endAt: '2026-01-01T00:15:00',
          durationSeconds: 180,
        }),
      ],
      sessions: [
        session({
          id: 'focus-first',
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 600,
        }),
        session({
          id: 'focus-second',
          startAt: '2026-01-01T00:12:00',
          endAt: '2026-01-01T00:15:00',
          durationSeconds: 180,
        }),
      ],
    };

    const rows = buildMonitoringRows(state, 'history', { mergeGapSeconds: 180 });

    expect(rows).toHaveLength(1);
    expect(rows[0].totalVisible).toBe(900);
    expect(rows[0].focusTime).toBe(900);
    expect(rows[0].longestContinuousFocus).toBe(900);
  });

  it('标签统计只统计加入标签之后的时间', () => {
    const base = createInitialState();
    const state: AppState = {
      ...base,
      profiles: [profile],
      processTags: [
        {
          id: 'tag-study',
          name: '论文',
          createdAt: '2026-01-01T00:00:00',
          updatedAt: '2026-01-01T00:00:00',
        },
      ],
      processTagAssignments: [
        {
          classificationKey: 'app-a',
          tagId: 'tag-study',
          assignedAt: '2026-01-01T00:05:00',
          updatedAt: '2026-01-01T00:05:00',
        },
      ],
      processTimeline: [
        presence({
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 600,
        }),
      ],
      sessions: [
        session({
          startAt: '2026-01-01T00:00:00',
          endAt: '2026-01-01T00:10:00',
          durationSeconds: 600,
        }),
      ],
    };

    const stats = buildMonitoringTagStats(state);

    expect(stats).toHaveLength(1);
    expect(stats[0].totalVisibleSeconds).toBe(300);
    expect(stats[0].focusSeconds).toBe(300);
  });

  it('日期范围使用本地自然日边界', () => {
    const range = getDayRange('2026-01-02');
    expect(new Date(range.startMs).getHours()).toBe(0);
    expect(range.endMs - range.startMs).toBe(24 * 3600000);
  });
});
