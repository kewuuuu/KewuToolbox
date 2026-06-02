import {
  AppState,
  Category,
  FocusSession,
  ObjectType,
  PowerEventRecord,
  ProcessTag,
  ProcessTagAssignment,
  ProcessTimelineRecord,
  WindowClassificationProfile,
  WindowRuntimeStat,
} from '@/types';

export type DisplayMode = 'category' | 'window';
export const ALL_HEATMAP_CATEGORIES = '全部性质';
export type HeatmapCategory = Category | typeof ALL_HEATMAP_CATEGORIES;

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface CompiledFocusSegment {
  id: string;
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  domain?: string;
  category: Category;
  startMs: number;
  endMs: number;
  durationSeconds: number;
}

export interface CompiledPresenceSegment {
  id: string;
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  category: Category;
  startMs: number;
  endMs: number;
  durationSeconds: number;
  isOpen: boolean;
}

export interface DistributionDatum {
  name: string;
  seconds: number;
  minutes: number;
  color?: string;
}

export interface HourlyDatum {
  hour: string;
  timestamp: number;
  totalMinutes: number;
  [category: string]: number | string;
}

export interface HeatmapDatum {
  date: string;
  seconds: number;
  minutes: number;
}

export interface DailyTrendDatum {
  date: string;
  minutes: number;
}

export interface DailyTrendSeries {
  key: string;
  name: string;
  totalSeconds: number;
}

export interface MultiSeriesDailyTrendDatum {
  date: string;
  totalMinutes: number;
  [seriesKey: string]: string | number;
}

export interface MultiSeriesDailyTrendResult {
  data: MultiSeriesDailyTrendDatum[];
  series: DailyTrendSeries[];
}

export interface TimelineItem {
  id: string;
  type: 'focus' | 'power';
  label: string;
  detail: string;
  category?: Category;
  startMs: number;
  endMs: number;
  durationSeconds: number;
  markerColor?: string;
}

export interface MonitoringDerivedRow {
  classificationKey: string;
  profileId: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  totalVisible: number;
  focusTime: number;
  lastFocus: string;
  longestContinuousFocus: number;
  category: Category;
  tagId?: string;
}

export interface MonitoringDerivedTagStat {
  tagId: string;
  totalVisibleSeconds: number;
  focusSeconds: number;
  lastFocusAt: string;
  longestContinuousFocusSeconds: number;
}

interface MergeOptions {
  mergeGapSeconds?: number;
}

interface MultiSeriesTrendOptions extends MergeOptions {
  categories?: Category[];
  windowLimit?: number;
}

const DEFAULT_CATEGORY = '其他';

function safeTime(value: string | undefined, fallback = Number.NaN) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function secondsBetween(startMs: number, endMs: number) {
  return Math.max(0, (endMs - startMs) / 1000);
}

function overlaps(startMs: number, endMs: number, range: TimeRange) {
  return startMs < range.endMs && endMs > range.startMs;
}

function normalizeDurationSeconds(durationSeconds: unknown, fallbackSeconds: number) {
  const parsed = Number(durationSeconds);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, fallbackSeconds);
  }
  return Math.max(0, parsed);
}

function prorateDurationSeconds(
  originalStartMs: number,
  originalEndMs: number,
  originalDurationSeconds: number,
  clippedStartMs: number,
  clippedEndMs: number,
) {
  const originalSpanSeconds = secondsBetween(originalStartMs, originalEndMs);
  const clippedSpanSeconds = secondsBetween(clippedStartMs, clippedEndMs);
  if (clippedSpanSeconds <= 0) {
    return 0;
  }
  if (originalSpanSeconds <= 0) {
    return originalDurationSeconds;
  }
  if (originalDurationSeconds > originalSpanSeconds) {
    return clippedSpanSeconds;
  }
  return originalDurationSeconds * (clippedSpanSeconds / originalSpanSeconds);
}

function buildProfileMap(profiles: WindowClassificationProfile[]) {
  return new Map(profiles.map(profile => [profile.classificationKey, profile]));
}

function resolveCategory(
  classificationKey: string,
  fallbackCategory: Category | undefined,
  profileMap: Map<string, WindowClassificationProfile>,
) {
  return profileMap.get(classificationKey)?.category ?? fallbackCategory ?? DEFAULT_CATEGORY;
}

function resolveProfileId(
  classificationKey: string,
  profileMap: Map<string, WindowClassificationProfile>,
) {
  return profileMap.get(classificationKey)?.id ?? classificationKey;
}

function displayKey(segment: Pick<CompiledFocusSegment, 'displayName' | 'category'>, mode: DisplayMode) {
  return mode === 'category' ? segment.category : segment.displayName;
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDayRange(dateKey: string): TimeRange {
  const start = new Date(`${dateKey}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}小时${m}分`;
  }
  if (m > 0) {
    return `${m}分${s}秒`;
  }
  return `${s}秒`;
}

export function compileFocusSegments(
  sessions: FocusSession[],
  profiles: WindowClassificationProfile[],
  range?: TimeRange,
): CompiledFocusSegment[] {
  const profileMap = buildProfileMap(profiles);
  const effectiveRange = range ?? { startMs: Number.NEGATIVE_INFINITY, endMs: Number.POSITIVE_INFINITY };
  const output: CompiledFocusSegment[] = [];

  for (const session of sessions) {
    const startMs = safeTime(session.startAt);
    const endMs = safeTime(session.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }
    if (!overlaps(startMs, endMs, effectiveRange)) {
      continue;
    }

    const clippedStartMs = clamp(startMs, effectiveRange.startMs, effectiveRange.endMs);
    const clippedEndMs = clamp(endMs, effectiveRange.startMs, effectiveRange.endMs);
    const fallbackDurationSeconds = secondsBetween(startMs, endMs);
    const originalDurationSeconds = normalizeDurationSeconds(session.durationSeconds, fallbackDurationSeconds);
    const durationSeconds = prorateDurationSeconds(
      startMs,
      endMs,
      originalDurationSeconds,
      clippedStartMs,
      clippedEndMs,
    );
    if (durationSeconds <= 0) {
      continue;
    }

    const profile = profileMap.get(session.classificationKey);
    output.push({
      id: session.id,
      classificationKey: session.classificationKey,
      displayName: profile?.displayName ?? session.displayName,
      objectType: profile?.objectType ?? session.objectType,
      processName: profile?.processName ?? session.processName,
      domain: profile?.domain ?? session.domain,
      category: resolveCategory(session.classificationKey, session.categoryAtThatTime, profileMap),
      startMs: clippedStartMs,
      endMs: clippedEndMs,
      durationSeconds,
    });
  }

  return output.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function compilePresenceSegments(
  records: ProcessTimelineRecord[],
  profiles: WindowClassificationProfile[],
  range?: TimeRange,
): CompiledPresenceSegment[] {
  const profileMap = buildProfileMap(profiles);
  const effectiveRange = range ?? { startMs: Number.NEGATIVE_INFINITY, endMs: Number.POSITIVE_INFINITY };
  const output: CompiledPresenceSegment[] = [];

  for (const record of records) {
    const startMs = safeTime(record.startAt);
    const endMs = safeTime(record.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }
    if (!overlaps(startMs, endMs, effectiveRange)) {
      continue;
    }

    const clippedStartMs = clamp(startMs, effectiveRange.startMs, effectiveRange.endMs);
    const clippedEndMs = clamp(endMs, effectiveRange.startMs, effectiveRange.endMs);
    const fallbackDurationSeconds = secondsBetween(startMs, endMs);
    const originalDurationSeconds = normalizeDurationSeconds(record.durationSeconds, fallbackDurationSeconds);
    const durationSeconds = prorateDurationSeconds(
      startMs,
      endMs,
      originalDurationSeconds,
      clippedStartMs,
      clippedEndMs,
    );
    if (durationSeconds <= 0) {
      continue;
    }

    const profile = profileMap.get(record.classificationKey);
    output.push({
      id: record.id,
      classificationKey: record.classificationKey,
      displayName: profile?.displayName ?? record.displayName,
      objectType: profile?.objectType ?? record.objectType,
      processName: profile?.processName ?? record.processName,
      category: resolveCategory(record.classificationKey, record.categoryAtThatTime, profileMap),
      startMs: clippedStartMs,
      endMs: clippedEndMs,
      durationSeconds,
      isOpen: record.isOpen,
    });
  }

  return output.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function buildDistribution(
  segments: CompiledFocusSegment[],
  mode: DisplayMode,
): DistributionDatum[] {
  const totals = new Map<string, number>();
  for (const segment of segments) {
    const key = displayKey(segment, mode);
    totals.set(key, (totals.get(key) || 0) + segment.durationSeconds);
  }

  return [...totals.entries()]
    .map(([name, seconds]) => ({
      name,
      seconds,
      minutes: Math.round(seconds / 60),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin'));
}

export function buildHourlyActivity(
  segments: CompiledFocusSegment[],
  range: TimeRange,
  categories: Category[],
): HourlyDatum[] {
  const startHour = new Date(range.startMs);
  startHour.setMinutes(0, 0, 0);
  const endHour = new Date(range.endMs);
  endHour.setMinutes(0, 0, 0);
  if (endHour.getTime() < range.endMs) {
    endHour.setHours(endHour.getHours() + 1);
  }

  const buckets: HourlyDatum[] = [];
  for (let cursor = startHour.getTime(); cursor < endHour.getTime(); cursor += 3600000) {
    const row: HourlyDatum = {
      hour: new Date(cursor).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      timestamp: cursor,
      totalMinutes: 0,
    };
    for (const category of categories) {
      row[category] = 0;
    }
    buckets.push(row);
  }

  for (const segment of segments) {
    for (const bucket of buckets) {
      const bucketStart = Number(bucket.timestamp);
      const bucketEnd = bucketStart + 3600000;
      if (!overlaps(segment.startMs, segment.endMs, { startMs: bucketStart, endMs: bucketEnd })) {
        continue;
      }
      const clippedStart = Math.max(segment.startMs, bucketStart);
      const clippedEnd = Math.min(segment.endMs, bucketEnd);
      const bucketSeconds = prorateDurationSeconds(
        segment.startMs,
        segment.endMs,
        segment.durationSeconds,
        clippedStart,
        clippedEnd,
      );
      const minutes = bucketSeconds / 60;
      bucket.totalMinutes = Number(bucket.totalMinutes) + minutes;
      bucket[segment.category] = Number(bucket[segment.category] || 0) + minutes;
    }
  }

  return buckets.map(bucket => {
    const rounded: HourlyDatum = { ...bucket, totalMinutes: Math.round(Number(bucket.totalMinutes)) };
    for (const category of categories) {
      rounded[category] = Math.round(Number(bucket[category] || 0));
    }
    return rounded;
  });
}

export function mergeAdjacentFocusSegments(
  segments: CompiledFocusSegment[],
  maxGapSeconds = 0,
): CompiledFocusSegment[] {
  const maxGapMs = Math.max(0, Number(maxGapSeconds) || 0) * 1000;
  const merged: CompiledFocusSegment[] = [];

  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const previous = merged[merged.length - 1];
    const gapMs = previous ? Math.max(0, segment.startMs - previous.endMs) : Number.POSITIVE_INFINITY;
    const canMerge =
      previous &&
      previous.classificationKey === segment.classificationKey &&
      gapMs <= maxGapMs;

    if (!canMerge) {
      merged.push({ ...segment });
      continue;
    }

    const gapSeconds = gapMs / 1000;
    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.durationSeconds += gapSeconds + segment.durationSeconds;
    previous.id = `${previous.id}+${segment.id}`;
  }

  return merged;
}

export function mergeAdjacentPresenceSegments(
  segments: CompiledPresenceSegment[],
  maxGapSeconds = 0,
): CompiledPresenceSegment[] {
  const maxGapMs = Math.max(0, Number(maxGapSeconds) || 0) * 1000;
  const merged: CompiledPresenceSegment[] = [];

  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const previous = merged[merged.length - 1];
    const gapMs = previous ? Math.max(0, segment.startMs - previous.endMs) : Number.POSITIVE_INFINITY;
    const canMerge =
      previous &&
      previous.classificationKey === segment.classificationKey &&
      gapMs <= maxGapMs;

    if (!canMerge) {
      merged.push({ ...segment });
      continue;
    }

    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.durationSeconds += gapMs / 1000 + segment.durationSeconds;
    previous.isOpen = previous.isOpen || segment.isOpen;
  }

  return merged;
}

export function compileMergedFocusSegments(
  sessions: FocusSession[],
  profiles: WindowClassificationProfile[],
  range: TimeRange | undefined,
  maxGapSeconds = 0,
): CompiledFocusSegment[] {
  if (!range) {
    return mergeAdjacentFocusSegments(compileFocusSegments(sessions, profiles), maxGapSeconds);
  }

  const gapMs = Math.max(0, Number(maxGapSeconds) || 0) * 1000;
  const expandedRange = {
    startMs: range.startMs - gapMs,
    endMs: range.endMs + gapMs,
  };
  return mergeAdjacentFocusSegments(
    compileFocusSegments(sessions, profiles, expandedRange),
    maxGapSeconds,
  )
    .filter(segment => overlaps(segment.startMs, segment.endMs, range))
    .map(segment => {
      const clippedStartMs = clamp(segment.startMs, range.startMs, range.endMs);
      const clippedEndMs = clamp(segment.endMs, range.startMs, range.endMs);
      return {
        ...segment,
        startMs: clippedStartMs,
        endMs: clippedEndMs,
        durationSeconds: prorateDurationSeconds(
          segment.startMs,
          segment.endMs,
          segment.durationSeconds,
          clippedStartMs,
          clippedEndMs,
        ),
      };
    })
    .filter(segment => segment.durationSeconds > 0);
}

export function buildHeatmap(
  sessions: FocusSession[],
  profiles: WindowClassificationProfile[],
  category: HeatmapCategory,
  days = 90,
  now = new Date(),
  options: MergeOptions = {},
): HeatmapDatum[] {
  const output: HeatmapDatum[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const dateKey = getLocalDateKey(date);
    const range = getDayRange(dateKey);
    const segments = compileMergedFocusSegments(
      sessions,
      profiles,
      range,
      options.mergeGapSeconds ?? 0,
    )
      .filter(segment => category === ALL_HEATMAP_CATEGORIES || segment.category === category);
    const seconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    output.push({
      date: dateKey,
      seconds,
      minutes: Math.round(seconds / 60),
    });
  }
  return output;
}

export function buildDailyTrend(
  sessions: FocusSession[],
  profiles: WindowClassificationProfile[],
  days = 14,
  now = new Date(),
  options: MergeOptions = {},
): DailyTrendDatum[] {
  const output: DailyTrendDatum[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const dateKey = getLocalDateKey(date);
    const range = getDayRange(dateKey);
    const seconds = compileMergedFocusSegments(
      sessions,
      profiles,
      range,
      options.mergeGapSeconds ?? 0,
    )
      .reduce((sum, segment) => sum + segment.durationSeconds, 0);
    output.push({
      date: dateKey.slice(5),
      minutes: Math.round(seconds / 60),
    });
  }
  return output;
}

export function buildMultiSeriesDailyTrend(
  sessions: FocusSession[],
  profiles: WindowClassificationProfile[],
  mode: DisplayMode,
  days = 14,
  now = new Date(),
  options: MultiSeriesTrendOptions = {},
): MultiSeriesDailyTrendResult {
  const dayBuckets: Array<{
    dateKey: string;
    dateLabel: string;
    segments: CompiledFocusSegment[];
  }> = [];
  const totals = new Map<string, number>();
  const mergeGapSeconds = options.mergeGapSeconds ?? 0;

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const dateKey = getLocalDateKey(date);
    const range = getDayRange(dateKey);
    const segments = compileMergedFocusSegments(sessions, profiles, range, mergeGapSeconds);
    dayBuckets.push({
      dateKey,
      dateLabel: dateKey.slice(5),
      segments,
    });

    for (const segment of segments) {
      const key = displayKey(segment, mode);
      totals.set(key, (totals.get(key) || 0) + segment.durationSeconds);
    }
  }

  const seriesNames =
    mode === 'category'
      ? [
          ...(options.categories || []),
          ...[...totals.keys()].filter(name => !(options.categories || []).includes(name)),
        ]
      : [...totals.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN-u-co-pinyin'))
          .slice(0, Math.max(1, Math.floor(Number(options.windowLimit) || 10)))
          .map(([name]) => name);

  const series: DailyTrendSeries[] = seriesNames.map((name, index) => ({
    key: `series-${index}`,
    name,
    totalSeconds: totals.get(name) || 0,
  }));
  const seriesKeyMap = new Map(series.map(item => [item.name, item.key]));

  const data = dayBuckets.map(bucket => {
    const row: MultiSeriesDailyTrendDatum = {
      date: bucket.dateLabel,
      totalMinutes: 0,
    };
    for (const item of series) {
      row[item.key] = 0;
    }

    for (const segment of bucket.segments) {
      row.totalMinutes = Number(row.totalMinutes) + segment.durationSeconds / 60;
      const seriesKey = seriesKeyMap.get(displayKey(segment, mode));
      if (seriesKey) {
        row[seriesKey] = Number(row[seriesKey] || 0) + segment.durationSeconds / 60;
      }
    }

    row.totalMinutes = Math.round(Number(row.totalMinutes));
    for (const item of series) {
      row[item.key] = Math.round(Number(row[item.key] || 0));
    }
    return row;
  });

  return { data, series };
}

export function buildTimelineItems(
  segments: CompiledFocusSegment[],
  powerEvents: PowerEventRecord[],
  range: TimeRange,
  options: { mergeFocusGapSeconds?: number } = {},
): TimelineItem[] {
  const focusSegments = mergeAdjacentFocusSegments(segments, options.mergeFocusGapSeconds ?? 0);
  const focusItems = focusSegments.map(segment => ({
    id: segment.id,
    type: 'focus' as const,
    label: segment.displayName,
    detail: `${segment.objectType} / ${formatDuration(segment.durationSeconds)}`,
    category: segment.category,
    startMs: segment.startMs,
    endMs: segment.endMs,
    durationSeconds: segment.durationSeconds,
  }));

  const powerItems = powerEvents
    .map(event => {
      const occurredMs = safeTime(event.occurredAt);
      return {
        event,
        occurredMs,
      };
    })
    .filter(item => Number.isFinite(item.occurredMs) && item.occurredMs >= range.startMs && item.occurredMs <= range.endMs)
    .map(({ event, occurredMs }) => ({
      id: event.id,
      type: 'power' as const,
      label: event.eventType,
      detail: event.detail,
      startMs: occurredMs,
      endMs: occurredMs,
      durationSeconds: 0,
      markerColor: event.markerColor,
    }));

  return [...focusItems, ...powerItems].sort((a, b) => a.startMs - b.startMs);
}

function addRuntimeFallbackRows(
  rows: Map<string, MonitoringDerivedRow>,
  state: AppState,
  profileMap: Map<string, WindowClassificationProfile>,
) {
  const runtimeMap = new Map(state.currentProcessRuntimeStats.map(item => [item.classificationKey, item]));
  for (const classificationKey of state.currentProcessKeys) {
    if (rows.has(classificationKey)) {
      continue;
    }
    const profile = profileMap.get(classificationKey);
    const runtime = runtimeMap.get(classificationKey);
    if (!profile && !runtime) {
      continue;
    }
    rows.set(classificationKey, {
      classificationKey,
      profileId: resolveProfileId(classificationKey, profileMap),
      displayName: profile?.displayName ?? classificationKey,
      objectType: profile?.objectType ?? 'AppWindow',
      processName: profile?.processName ?? 'unknown',
      totalVisible: runtime?.totalVisibleSeconds ?? 0,
      focusTime: runtime?.totalFocusSeconds ?? 0,
      lastFocus: runtime?.lastFocusAt ?? '',
      longestContinuousFocus: runtime?.longestContinuousFocusSeconds ?? 0,
      category: profile?.category ?? DEFAULT_CATEGORY,
    });
  }
}

function mergeLegacyWindowStats(
  rows: Map<string, MonitoringDerivedRow>,
  stats: WindowRuntimeStat[],
  profileMap: Map<string, WindowClassificationProfile>,
) {
  for (const stat of stats) {
    if (rows.has(stat.classificationKey)) {
      continue;
    }
    const profile = profileMap.get(stat.classificationKey);
    rows.set(stat.classificationKey, {
      classificationKey: stat.classificationKey,
      profileId: resolveProfileId(stat.classificationKey, profileMap),
      displayName: profile?.displayName ?? stat.displayName,
      objectType: profile?.objectType ?? stat.objectType,
      processName: profile?.processName ?? stat.processName,
      totalVisible: stat.totalVisibleSeconds,
      focusTime: stat.focusSeconds,
      lastFocus: stat.lastFocusAt,
      longestContinuousFocus: stat.longestContinuousFocusSeconds,
      category: profile?.category ?? stat.category ?? DEFAULT_CATEGORY,
    });
  }
}

export function buildMonitoringRows(
  state: AppState,
  scope: 'history' | 'current',
  options: MergeOptions = {},
): MonitoringDerivedRow[] {
  const profileMap = buildProfileMap(state.profiles);
  const assignmentMap = new Map(state.processTagAssignments.map(item => [item.classificationKey, item]));
  const rows = new Map<string, MonitoringDerivedRow>();

  const mergeGapSeconds = options.mergeGapSeconds ?? 0;
  const presenceSegments = mergeAdjacentPresenceSegments(
    compilePresenceSegments(state.processTimeline || [], state.profiles),
    mergeGapSeconds,
  );
  for (const segment of presenceSegments) {
    const existing = rows.get(segment.classificationKey);
    if (existing) {
      existing.totalVisible += segment.durationSeconds;
      existing.displayName = segment.displayName;
      existing.objectType = segment.objectType;
      existing.processName = segment.processName;
      existing.category = segment.category;
    } else {
      rows.set(segment.classificationKey, {
        classificationKey: segment.classificationKey,
        profileId: resolveProfileId(segment.classificationKey, profileMap),
        displayName: segment.displayName,
        objectType: segment.objectType,
        processName: segment.processName,
        totalVisible: segment.durationSeconds,
        focusTime: 0,
        lastFocus: '',
        longestContinuousFocus: 0,
        category: segment.category,
      });
    }
  }

  const focusSegments = mergeAdjacentFocusSegments(
    compileFocusSegments(state.sessions || [], state.profiles),
    mergeGapSeconds,
  );
  for (const segment of focusSegments) {
    const existing = rows.get(segment.classificationKey);
    const lastFocusIso = new Date(segment.endMs).toISOString();
    if (existing) {
      existing.focusTime += segment.durationSeconds;
      existing.lastFocus =
        !existing.lastFocus || safeTime(existing.lastFocus) < segment.endMs ? lastFocusIso : existing.lastFocus;
      existing.longestContinuousFocus = Math.max(existing.longestContinuousFocus, segment.durationSeconds);
      existing.displayName = segment.displayName;
      existing.objectType = segment.objectType;
      existing.processName = segment.processName;
      existing.category = segment.category;
    } else {
      rows.set(segment.classificationKey, {
        classificationKey: segment.classificationKey,
        profileId: resolveProfileId(segment.classificationKey, profileMap),
        displayName: segment.displayName,
        objectType: segment.objectType,
        processName: segment.processName,
        totalVisible: 0,
        focusTime: segment.durationSeconds,
        lastFocus: lastFocusIso,
        longestContinuousFocus: segment.durationSeconds,
        category: segment.category,
      });
    }
  }

  addRuntimeFallbackRows(rows, state, profileMap);
  mergeLegacyWindowStats(rows, state.windowStats || [], profileMap);

  for (const row of rows.values()) {
    row.totalVisible = Math.max(row.totalVisible, row.focusTime);
    row.totalVisible = Math.round(row.totalVisible);
    row.focusTime = Math.round(row.focusTime);
    row.longestContinuousFocus = Math.round(row.longestContinuousFocus);
    const assignment = assignmentMap.get(row.classificationKey);
    if (assignment) {
      row.tagId = assignment.tagId;
    }
  }

  if (scope === 'current') {
    const currentKeys = new Set(state.currentProcessKeys);
    return [...rows.values()].filter(row => currentKeys.has(row.classificationKey));
  }

  return [...rows.values()];
}

function isAfterAssignment(
  segment: Pick<CompiledFocusSegment | CompiledPresenceSegment, 'startMs' | 'endMs'>,
  assignment: ProcessTagAssignment,
) {
  const assignedAtMs = safeTime(assignment.assignedAt);
  if (!Number.isFinite(assignedAtMs) || assignedAtMs <= 0) {
    return true;
  }
  return segment.endMs > assignedAtMs;
}

function clippedDurationAfterAssignment(
  segment: Pick<CompiledFocusSegment | CompiledPresenceSegment, 'startMs' | 'endMs' | 'durationSeconds'>,
  assignment: ProcessTagAssignment,
) {
  if (!isAfterAssignment(segment, assignment)) {
    return 0;
  }
  const assignedAtMs = safeTime(assignment.assignedAt);
  if (!Number.isFinite(assignedAtMs) || assignedAtMs <= segment.startMs) {
    return segment.durationSeconds;
  }
  return prorateDurationSeconds(
    segment.startMs,
    segment.endMs,
    segment.durationSeconds,
    assignedAtMs,
    segment.endMs,
  );
}

export function buildMonitoringTagStats(state: AppState, options: MergeOptions = {}): MonitoringDerivedTagStat[] {
  const tagMap = new Map<string, ProcessTag>(state.processTags.map(tag => [tag.id, tag]));
  const assignments = state.processTagAssignments.filter(item => tagMap.has(item.tagId));
  const assignmentMap = new Map(assignments.map(item => [item.classificationKey, item]));
  const statMap = new Map<string, MonitoringDerivedTagStat>();

  const ensureStat = (tagId: string) => {
    const existing = statMap.get(tagId);
    if (existing) {
      return existing;
    }
    const next = {
      tagId,
      totalVisibleSeconds: 0,
      focusSeconds: 0,
      lastFocusAt: '',
      longestContinuousFocusSeconds: 0,
    };
    statMap.set(tagId, next);
    return next;
  };

  const mergeGapSeconds = options.mergeGapSeconds ?? 0;

  for (const segment of mergeAdjacentPresenceSegments(
    compilePresenceSegments(state.processTimeline || [], state.profiles),
    mergeGapSeconds,
  )) {
    const assignment = assignmentMap.get(segment.classificationKey);
    if (!assignment) {
      continue;
    }
    ensureStat(assignment.tagId).totalVisibleSeconds += clippedDurationAfterAssignment(segment, assignment);
  }

  for (const segment of mergeAdjacentFocusSegments(
    compileFocusSegments(state.sessions || [], state.profiles),
    mergeGapSeconds,
  )) {
    const assignment = assignmentMap.get(segment.classificationKey);
    if (!assignment) {
      continue;
    }
    const stat = ensureStat(assignment.tagId);
    const focusSeconds = clippedDurationAfterAssignment(segment, assignment);
    stat.focusSeconds += focusSeconds;
    if (focusSeconds > 0) {
      const lastFocusIso = new Date(segment.endMs).toISOString();
      stat.lastFocusAt =
        !stat.lastFocusAt || safeTime(stat.lastFocusAt) < segment.endMs ? lastFocusIso : stat.lastFocusAt;
      stat.longestContinuousFocusSeconds = Math.max(stat.longestContinuousFocusSeconds, focusSeconds);
    }
  }

  return [...statMap.values()].map(stat => ({
    ...stat,
    totalVisibleSeconds: Math.round(Math.max(stat.totalVisibleSeconds, stat.focusSeconds)),
    focusSeconds: Math.round(stat.focusSeconds),
    longestContinuousFocusSeconds: Math.round(stat.longestContinuousFocusSeconds),
  }));
}
