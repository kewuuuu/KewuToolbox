import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Mouse,
  MousePointerClick,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppState } from '@/store/AppContext';
import { CATEGORIES, getCategoryColor } from '@/lib/categories';
import {
  ALL_HEATMAP_CATEGORIES,
  buildDistribution,
  buildHeatmap,
  buildHourlyActivity,
  buildTimelineItems,
  CompiledFocusSegment,
  compileFocusSegments,
  compileMergedFocusSegments,
  DisplayMode,
  formatDuration,
  getLocalDateKey,
  HeatmapCategory,
  TimeRange,
} from '@/lib/analyticsReadModel';
import { Category, InputActivityMetric, InputActivityTimelineRecord, ObjectType } from '@/types';

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  color: 'hsl(var(--foreground))',
  fontSize: '12px',
};

const RANK_AXIS_WIDTH = 132;
const RANK_LABEL_MAX_UNITS = 24;

const INPUT_METRICS: Array<{ key: InputActivityMetric; label: string; shortLabel: string }> = [
  { key: 'keyPresses', label: '按键次数', shortLabel: '按键' },
  { key: 'totalClicks', label: '鼠标点击', shortLabel: '点击' },
  { key: 'scrollTicks', label: '滚轮滚动', shortLabel: '滚动' },
  { key: 'mouseMovePixels', label: '鼠标移动', shortLabel: '移动' },
];

type AnalyticsTab = 'focus' | 'input';
type KeyCountMap = Record<string, number>;
type CalendarPanelMode = 'day' | 'month' | 'year';

const CHINESE_MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const CHINESE_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

interface WindowInputAggregate {
  classificationKey: string;
  displayName: string;
  objectType: ObjectType;
  processName: string;
  keyPresses: number;
  leftClicks: number;
  rightClicks: number;
  middleClicks: number;
  sideBackClicks: number;
  sideForwardClicks: number;
  totalClicks: number;
  scrollTicks: number;
  mouseMovePixels: number;
  keyCounts: KeyCountMap;
  focusSeconds: number;
  lastAt: string;
}

interface KeyDefinition {
  label: string;
  code?: string;
  span?: number;
}

const KEYBOARD_ROWS: KeyDefinition[][] = [
  [
    { label: 'Esc', code: '1' },
    { label: 'F1', code: '59' },
    { label: 'F2', code: '60' },
    { label: 'F3', code: '61' },
    { label: 'F4', code: '62' },
    { label: 'F5', code: '63' },
    { label: 'F6', code: '64' },
    { label: 'F7', code: '65' },
    { label: 'F8', code: '66' },
    { label: 'F9', code: '67' },
    { label: 'F10', code: '68' },
    { label: 'F11', code: '87' },
    { label: 'F12', code: '88' },
  ],
  [
    { label: '`', code: '41' },
    { label: '1', code: '2' },
    { label: '2', code: '3' },
    { label: '3', code: '4' },
    { label: '4', code: '5' },
    { label: '5', code: '6' },
    { label: '6', code: '7' },
    { label: '7', code: '8' },
    { label: '8', code: '9' },
    { label: '9', code: '10' },
    { label: '0', code: '11' },
    { label: '-', code: '12' },
    { label: '=', code: '13' },
    { label: 'Backspace', code: '14', span: 2 },
  ],
  [
    { label: 'Tab', code: '15', span: 1.5 },
    { label: 'Q', code: '16' },
    { label: 'W', code: '17' },
    { label: 'E', code: '18' },
    { label: 'R', code: '19' },
    { label: 'T', code: '20' },
    { label: 'Y', code: '21' },
    { label: 'U', code: '22' },
    { label: 'I', code: '23' },
    { label: 'O', code: '24' },
    { label: 'P', code: '25' },
    { label: '[', code: '26' },
    { label: ']', code: '27' },
    { label: '\\', code: '43', span: 1.5 },
  ],
  [
    { label: 'Caps', code: '58', span: 1.8 },
    { label: 'A', code: '30' },
    { label: 'S', code: '31' },
    { label: 'D', code: '32' },
    { label: 'F', code: '33' },
    { label: 'G', code: '34' },
    { label: 'H', code: '35' },
    { label: 'J', code: '36' },
    { label: 'K', code: '37' },
    { label: 'L', code: '38' },
    { label: ';', code: '39' },
    { label: '\'', code: '40' },
    { label: 'Enter', code: '28', span: 2.2 },
  ],
  [
    { label: 'Shift', code: '42', span: 2.4 },
    { label: 'Z', code: '44' },
    { label: 'X', code: '45' },
    { label: 'C', code: '46' },
    { label: 'V', code: '47' },
    { label: 'B', code: '48' },
    { label: 'N', code: '49' },
    { label: 'M', code: '50' },
    { label: ',', code: '51' },
    { label: '.', code: '52' },
    { label: '/', code: '53' },
    { label: 'Shift', code: '54', span: 2.4 },
  ],
  [
    { label: 'Ctrl', code: '29', span: 1.4 },
    { label: 'Alt', code: '56', span: 1.4 },
    { label: 'Space', code: '57', span: 6 },
    { label: 'Alt', code: '3640', span: 1.4 },
    { label: 'Ctrl', code: '3613', span: 1.4 },
    { label: 'Left', code: '57419' },
    { label: 'Up', code: '57416' },
    { label: 'Down', code: '57424' },
    { label: 'Right', code: '57421' },
  ],
];

const KEY_LABEL_BY_CODE = KEYBOARD_ROWS.flat().reduce<Record<string, string>>((map, key) => {
  if (key.code && !map[key.code]) {
    map[key.code] = key.label;
  }
  return map;
}, {});

function getTextVisualUnits(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (char.charCodeAt(0) <= 0x7f ? 1 : 2), 0);
}

function truncateTextByVisualUnits(value: string, maxUnits: number) {
  const text = value.trim();
  if (getTextVisualUnits(text) <= maxUnits) {
    return text;
  }
  const targetUnits = Math.max(1, maxUnits - 3);
  let output = '';
  let units = 0;
  for (const char of Array.from(text)) {
    const charUnits = char.charCodeAt(0) <= 0x7f ? 1 : 2;
    if (units + charUnits > targetUnits) {
      break;
    }
    output += char;
    units += charUnits;
  }
  return `${output || text.slice(0, 1)}...`;
}

function getRankLabelFontSize(value: string) {
  const units = getTextVisualUnits(value);
  if (units <= 14) return 12;
  if (units <= 22) return 11;
  if (units <= 30) return 10;
  return 9;
}

function renderRankYAxisTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const rawName = String(payload?.value ?? '');
  const displayName = truncateTextByVisualUnits(rawName, RANK_LABEL_MAX_UNITS);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{rawName}</title>
      <text x={-8} y={0} dy={4} textAnchor="end" fill="hsl(var(--foreground))" fontSize={getRankLabelFontSize(rawName)}>
        {displayName}
      </text>
    </g>
  );
}

function toLocalDateInput(date: Date) {
  return getLocalDateKey(date);
}

function parseDateInput(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return toLocalDateInput(date);
}

function startOfLocalDay(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).getTime();
}

function makeRange(startDate: string, endDate: string): TimeRange {
  const startMs = startOfLocalDay(startDate);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return {
    startMs,
    endMs: end.getTime(),
  };
}

function eachDateKeyInRange(startDate: string, endDate: string) {
  const output: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const endMs = startOfLocalDay(endDate);
  while (cursor.getTime() <= endMs) {
    output.push(toLocalDateInput(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return output;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function buildMonthCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const leadingEmptyCount = (firstDay.getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let index = 0; index < leadingEmptyCount; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function clampDateRange(startDate: string, endDate: string) {
  const today = toLocalDateInput(new Date());
  const safeStart = parseDateInput(startDate) ?? today;
  const safeEnd = parseDateInput(endDate) ?? safeStart;
  return startOfLocalDay(safeStart) <= startOfLocalDay(safeEnd)
    ? { startDate: safeStart, endDate: safeEnd }
    : { startDate: safeEnd, endDate: safeStart };
}

function getWindowSeriesColor(index: number) {
  return `hsl(${(index * 43 + 198) % 360}, 72%, 56%)`;
}

function getSeriesColor(index: number) {
  return `hsl(${(index * 53 + 205) % 360}, 72%, 56%)`;
}

function getDisplayModeColor(name: string, mode: DisplayMode, index: number) {
  return mode === 'category' ? getCategoryColor(name as Category) : getWindowSeriesColor(index);
}

function formatInteger(value: number) {
  return Math.round(value || 0).toLocaleString('zh-CN');
}

function getTotalClicks(item: {
  leftClicks: number;
  rightClicks: number;
  middleClicks: number;
  sideBackClicks: number;
  sideForwardClicks: number;
}) {
  return (
    Number(item.leftClicks || 0) +
    Number(item.rightClicks || 0) +
    Number(item.middleClicks || 0) +
    Number(item.sideBackClicks || 0) +
    Number(item.sideForwardClicks || 0)
  );
}

function getMetricValue(item: Pick<WindowInputAggregate, InputActivityMetric>, metric: InputActivityMetric) {
  return Number(item[metric] || 0);
}

function formatMetricValue(metric: InputActivityMetric, value: number) {
  if (metric === 'mouseMovePixels') {
    return `${formatInteger(value)} px`;
  }
  return formatInteger(value);
}

function mergeKeyCounts(target: KeyCountMap, incoming: KeyCountMap) {
  const next = { ...target };
  for (const [key, value] of Object.entries(incoming || {})) {
    next[key] = (next[key] || 0) + (Number(value) || 0);
  }
  return next;
}

function formatLastAt(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return '-';
  }
  return new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function compactTypeLabel(value: ObjectType) {
  if (value === 'BrowserTab') return '网页';
  if (value === 'Desktop') return '桌面';
  return '窗口';
}

function isInputRecordInRange(record: InputActivityTimelineRecord, range: TimeRange) {
  const startMs = new Date(record.bucketStartAt).getTime();
  const endMs = new Date(record.bucketEndAt).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < range.endMs && endMs > range.startMs;
}

function buildHourlyWindowActivity(segments: CompiledFocusSegment[], range: TimeRange, series: ChartSeries[]) {
  const startHour = new Date(range.startMs);
  startHour.setMinutes(0, 0, 0);
  const endHour = new Date(range.endMs);
  endHour.setMinutes(0, 0, 0);
  if (endHour.getTime() < range.endMs) {
    endHour.setHours(endHour.getHours() + 1);
  }

  const seriesKeyMap = new Map(series.map(item => [item.name, item.key]));
  const buckets: Array<{ hour: string; timestamp: number; totalMinutes: number; [key: string]: string | number }> = [];
  for (let cursor = startHour.getTime(); cursor < endHour.getTime(); cursor += 3600000) {
    const row = {
      hour: new Date(cursor).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }),
      timestamp: cursor,
      totalMinutes: 0,
    };
    for (const item of series) {
      Object.assign(row, { [item.key]: 0 });
    }
    buckets.push(row);
  }

  for (const segment of segments) {
    for (const bucket of buckets) {
      const bucketStart = Number(bucket.timestamp);
      const bucketEnd = bucketStart + 3600000;
      const overlapStart = Math.max(segment.startMs, bucketStart);
      const overlapEnd = Math.min(segment.endMs, bucketEnd);
      if (overlapEnd <= overlapStart) continue;
      const spanMs = Math.max(1, segment.endMs - segment.startMs);
      const minutes = (segment.durationSeconds * ((overlapEnd - overlapStart) / spanMs)) / 60;
      bucket.totalMinutes = Number(bucket.totalMinutes) + minutes;
      const seriesKey = seriesKeyMap.get(segment.displayName);
      if (seriesKey) {
        bucket[seriesKey] = Number(bucket[seriesKey] || 0) + minutes;
      }
    }
  }

  return buckets.map(bucket => {
    const row = { ...bucket, totalMinutes: Math.round(Number(bucket.totalMinutes)) };
    for (const item of series) {
      row[item.key] = Math.round(Number(row[item.key] || 0));
    }
    return row;
  });
}

function buildMultiSeriesTrendForRange(
  segments: CompiledFocusSegment[],
  mode: DisplayMode,
  startDate: string,
  endDate: string,
  windowLimit: number,
) {
  const dates = eachDateKeyInRange(startDate, endDate);
  const totals = new Map<string, number>();
  const seriesTotals = new Map<string, number>();
  const perDate = new Map<string, Map<string, number>>();

  for (const date of dates) {
    totals.set(date, 0);
    perDate.set(date, new Map());
  }

  for (const segment of segments) {
    for (const date of dates) {
      const dayRange = makeRange(date, date);
      const overlapStart = Math.max(segment.startMs, dayRange.startMs);
      const overlapEnd = Math.min(segment.endMs, dayRange.endMs);
      if (overlapEnd <= overlapStart) continue;
      const spanMs = Math.max(1, segment.endMs - segment.startMs);
      const seconds = segment.durationSeconds * ((overlapEnd - overlapStart) / spanMs);
      const key = mode === 'category' ? segment.category : segment.displayName;
      totals.set(date, (totals.get(date) || 0) + seconds);
      const rowMap = perDate.get(date)!;
      rowMap.set(key, (rowMap.get(key) || 0) + seconds);
      seriesTotals.set(key, (seriesTotals.get(key) || 0) + seconds);
    }
  }

  const series =
    mode === 'category'
      ? CATEGORIES.map(category => ({ key: category, name: category, totalSeconds: seriesTotals.get(category) || 0 }))
      : [...seriesTotals.entries()]
          .map(([name, totalSeconds]) => ({ key: name, name, totalSeconds }))
          .sort((a, b) => b.totalSeconds - a.totalSeconds)
          .slice(0, windowLimit);

  const data = dates.map(date => {
    const row: Record<string, string | number> = {
      date: date.slice(5),
      totalMinutes: Math.round((totals.get(date) || 0) / 60),
    };
    const rowMap = perDate.get(date)!;
    for (const item of series) {
      row[item.key] = Math.round((rowMap.get(item.name) || 0) / 60);
    }
    return row;
  });

  return { data, series };
}

function buildWindowInputAggregates(records: InputActivityTimelineRecord[], focusSecondsByKey: Map<string, number>) {
  const aggregateMap = new Map<string, WindowInputAggregate>();

  for (const record of records) {
    const existing = aggregateMap.get(record.classificationKey);
    if (!existing) {
      aggregateMap.set(record.classificationKey, {
        classificationKey: record.classificationKey,
        displayName: record.displayName,
        objectType: record.objectType,
        processName: record.processName,
        keyPresses: record.keyPresses,
        leftClicks: record.leftClicks,
        rightClicks: record.rightClicks,
        middleClicks: record.middleClicks,
        sideBackClicks: record.sideBackClicks,
        sideForwardClicks: record.sideForwardClicks,
        totalClicks: getTotalClicks(record),
        scrollTicks: record.scrollTicks,
        mouseMovePixels: record.mouseMovePixels,
        keyCounts: record.keyCounts || {},
        focusSeconds: focusSecondsByKey.get(record.classificationKey) || 0,
        lastAt: record.bucketStartAt,
      });
      continue;
    }

    existing.displayName = record.displayName;
    existing.objectType = record.objectType;
    existing.processName = record.processName;
    existing.keyPresses += record.keyPresses;
    existing.leftClicks += record.leftClicks;
    existing.rightClicks += record.rightClicks;
    existing.middleClicks += record.middleClicks;
    existing.sideBackClicks += record.sideBackClicks;
    existing.sideForwardClicks += record.sideForwardClicks;
    existing.totalClicks += getTotalClicks(record);
    existing.scrollTicks += record.scrollTicks;
    existing.mouseMovePixels += record.mouseMovePixels;
    existing.keyCounts = mergeKeyCounts(existing.keyCounts, record.keyCounts || {});
    existing.focusSeconds = focusSecondsByKey.get(record.classificationKey) || existing.focusSeconds;
    if (new Date(record.bucketStartAt).getTime() > new Date(existing.lastAt).getTime()) {
      existing.lastAt = record.bucketStartAt;
    }
  }

  return [...aggregateMap.values()];
}

function buildKeyRows(keyCounts: KeyCountMap) {
  return Object.entries(keyCounts || {})
    .map(([code, count]) => ({
      code,
      label: KEY_LABEL_BY_CODE[code] || `#${code}`,
      count: Number(count) || 0,
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN-u-co-pinyin'));
}

function buildInputTrend(records: InputActivityTimelineRecord[], startDate: string, endDate: string, metric: InputActivityMetric) {
  const rows = eachDateKeyInRange(startDate, endDate).map(date => ({
    date,
    label: date.slice(5),
    value: 0,
  }));
  const rowMap = new Map(rows.map(row => [row.date, row]));
  const range = makeRange(startDate, endDate);

  for (const record of records) {
    if (!isInputRecordInRange(record, range)) continue;
    const row = rowMap.get(toLocalDateInput(new Date(record.bucketStartAt)));
    if (row) {
      row.value += metric === 'totalClicks' ? getTotalClicks(record) : Number(record[metric] || 0);
    }
  }

  return rows;
}

function MetricRow({
  label,
  value,
  formattedValue,
  max,
  sub,
  color,
}: {
  label: string;
  value: number;
  formattedValue?: string;
  max: number;
  sub?: string;
  color: string;
}) {
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex-1 truncate text-foreground" title={label}>
          {label}
        </span>
        {sub && <span className="text-muted-foreground shrink-0">{sub}</span>}
        <span className="font-semibold text-foreground tabular-nums shrink-0">{formattedValue || formatInteger(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function KeyboardKey({ keyDef, count, max }: { keyDef: KeyDefinition; count: number; max: number }) {
  const ratio = max > 0 ? count / max : 0;
  const alpha = count > 0 ? Math.min(0.95, 0.16 + ratio * 0.72) : 0.06;
  return (
    <div
      title={`${keyDef.label}: ${formatInteger(count)}`}
      className="h-9 min-w-9 rounded-lg border border-border/70 flex flex-col items-center justify-center px-1 text-[10px] leading-none text-foreground shadow-sm"
      style={{
        flex: keyDef.span || 1,
        backgroundColor: `hsl(var(--primary) / ${alpha})`,
      }}
    >
      <span className="max-w-full truncate">{keyDef.label}</span>
      {count > 0 && <span className="mt-1 text-[9px] text-foreground/80 tabular-nums">{formatInteger(count)}</span>}
    </div>
  );
}

function DisplayModeToggle({ value, onChange }: { value: DisplayMode; onChange: (value: DisplayMode) => void }) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden bg-secondary/50">
      {[
        { label: '按性质', value: 'category' as const },
        { label: '按窗口', value: 'window' as const },
      ].map(item => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`h-8 px-3 text-[11px] ${
            value === item.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function DatePanel({
  title,
  value,
  rangeStartDate,
  rangeEndDate,
  onSelect,
  dataDateSet,
}: {
  title: string;
  value: string;
  rangeStartDate: string;
  rangeEndDate: string;
  onSelect: (dateKey: string) => void;
  dataDateSet: Set<string>;
}) {
  const [viewDate, setViewDate] = useState(() => new Date(`${value}T00:00:00`));
  const [mode, setMode] = useState<CalendarPanelMode>('day');
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthCells = useMemo(() => buildMonthCells(year, month), [month, year]);
  const yearBlockStart = Math.floor(year / 12) * 12;
  const yearOptions = Array.from({ length: 12 }, (_, index) => yearBlockStart + index);
  const today = toLocalDateInput(new Date());

  useEffect(() => {
    setViewDate(new Date(`${value}T00:00:00`));
  }, [value]);

  const shiftPanel = (direction: -1 | 1) => {
    if (mode === 'day') {
      setViewDate(current => addMonths(current, direction));
      return;
    }
    if (mode === 'month') {
      setViewDate(current => new Date(current.getFullYear() + direction, current.getMonth(), 1));
      return;
    }
    setViewDate(current => new Date(current.getFullYear() + direction * 12, current.getMonth(), 1));
  };

  const selectMonth = (nextMonth: number) => {
    setViewDate(current => new Date(current.getFullYear(), nextMonth, 1));
    setMode('day');
  };

  const selectYear = (nextYear: number) => {
    setViewDate(current => new Date(nextYear, current.getMonth(), 1));
    setMode('month');
  };

  return (
    <div className="rounded-2xl border border-border bg-card/80 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-16">
          <div className="text-xs font-semibold text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">{value}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftPanel(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => setMode('year')}
            className={cx(
              'h-7 rounded-lg px-2 text-xs font-semibold transition-colors hover:bg-accent',
              mode === 'year' && 'bg-primary text-primary-foreground hover:bg-primary',
            )}
          >
            {year}年
          </button>
          <button
            type="button"
            onClick={() => setMode('month')}
            className={cx(
              'h-7 rounded-lg px-2 text-xs font-semibold transition-colors hover:bg-accent',
              mode === 'month' && 'bg-primary text-primary-foreground hover:bg-primary',
            )}
          >
            {CHINESE_MONTHS[month]}
          </button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftPanel(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {mode === 'day' && (
        <>
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-muted-foreground">
            {CHINESE_WEEKDAYS.map(day => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-9" />;
              }

              const dateKey = toLocalDateInput(date);
              const hasData = dataDateSet.has(dateKey);
              const isStart = dateKey === rangeStartDate;
              const isEnd = dateKey === rangeEndDate;
              const isSelected = dateKey === value || isStart || isEnd;
              const isInRange =
                startOfLocalDay(dateKey) > startOfLocalDay(rangeStartDate) &&
                startOfLocalDay(dateKey) < startOfLocalDay(rangeEndDate);

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => onSelect(dateKey)}
                  title={`${dateKey}${hasData ? '，有数据' : '，无数据'}`}
                  className={cx(
                    'relative h-9 rounded-xl border text-xs transition-all',
                    'hover:-translate-y-0.5 hover:border-primary/70 hover:bg-primary/10 hover:text-foreground',
                    hasData
                      ? 'border-primary/30 bg-primary/10 font-bold text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]'
                      : 'border-transparent text-muted-foreground/45',
                    isInRange && 'bg-primary/15 text-foreground',
                    dateKey === today && !isSelected && 'outline outline-1 outline-primary/60',
                    isSelected && 'border-primary bg-primary text-primary-foreground shadow-sm',
                  )}
                >
                  <span>{date.getDate()}</span>
                  {hasData && (
                    <span
                      className={cx(
                        'absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full',
                        isSelected ? 'bg-primary-foreground' : 'bg-primary',
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {mode === 'month' && (
        <div className="grid grid-cols-3 gap-2">
          {CHINESE_MONTHS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => selectMonth(index)}
              className={cx(
                'h-10 rounded-xl border border-border text-xs font-medium transition-colors hover:border-primary/60 hover:bg-primary/10',
                index === month && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === 'year' && (
        <div className="grid grid-cols-3 gap-2">
          {yearOptions.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => selectYear(item)}
              className={cx(
                'h-10 rounded-xl border border-border text-xs font-medium transition-colors hover:border-primary/60 hover:bg-primary/10',
                item === year && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {item}年
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          有数据
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30 bg-muted/50" />
          无数据
        </span>
      </div>
    </div>
  );
}

function RangeSelector({
  startDate,
  endDate,
  onChange,
  earliestDate,
  dataDateSet,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  earliestDate: string;
  dataDateSet: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);

  useEffect(() => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
  }, [endDate, startDate]);

  const today = toLocalDateInput(new Date());

  const commit = (nextStart: string, nextEnd: string) => {
    const next = clampDateRange(nextStart, nextEnd);
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
    onChange(next);
  };

  const commitDraft = () => {
    const parsedStart = parseDateInput(draftStart);
    const parsedEnd = parseDateInput(draftEnd);
    if (!parsedStart || !parsedEnd) {
      setDraftStart(startDate);
      setDraftEnd(endDate);
      toast.error('日期格式应为 YYYY-MM-DD');
      return;
    }
    commit(parsedStart, parsedEnd);
  };

  const commitStartDate = (nextStartDate: string) => {
    const nextEndDate = startOfLocalDay(nextStartDate) > startOfLocalDay(endDate) ? nextStartDate : endDate;
    commit(nextStartDate, nextEndDate);
  };

  const commitEndDate = (nextEndDate: string) => {
    const nextStartDate = startOfLocalDay(nextEndDate) < startOfLocalDay(startDate) ? nextEndDate : startDate;
    commit(nextStartDate, nextEndDate);
  };

  const quickRanges = [
    { label: '今日', get: () => ({ startDate: today, endDate: today }) },
    { label: '历史所有', get: () => ({ startDate: earliestDate, endDate: today }) },
    {
      label: '最近一周',
      get: () => {
        const start = new Date(`${today}T00:00:00`);
        start.setDate(start.getDate() - 6);
        return { startDate: toLocalDateInput(start), endDate: today };
      },
    },
    {
      label: '最近一月',
      get: () => {
        const start = new Date(`${today}T00:00:00`);
        start.setDate(start.getDate() - 29);
        return { startDate: toLocalDateInput(start), endDate: today };
      },
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
          <CalendarDays className="w-4 h-4 text-primary ml-1" />
          <Input
            value={draftStart}
            onChange={event => setDraftStart(event.target.value)}
            onBlur={commitDraft}
            onFocus={() => setOpen(true)}
            className="h-8 w-32 text-xs"
            placeholder="YYYY-MM-DD"
          />
          <span className="text-xs text-muted-foreground">至</span>
          <Input
            value={draftEnd}
            onChange={event => setDraftEnd(event.target.value)}
            onBlur={commitDraft}
            onFocus={() => setOpen(true)}
            className="h-8 w-32 text-xs"
            placeholder="YYYY-MM-DD"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(780px,calc(100vw-2rem))] p-3">
        <div className="flex flex-wrap gap-2 pb-3">
          {quickRanges.map(item => (
            <Button
              key={item.label}
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => {
                const next = item.get();
                commit(next.startDate, next.endDate);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <DatePanel
            title="开始日期"
            value={startDate}
            rangeStartDate={startDate}
            rangeEndDate={endDate}
            onSelect={commitStartDate}
            dataDateSet={dataDateSet}
          />
          <DatePanel
            title="结束日期"
            value={endDate}
            rangeStartDate={startDate}
            rangeEndDate={endDate}
            onSelect={commitEndDate}
            dataDateSet={dataDateSet}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function AnalyticsPage() {
  const { state, updateUiState } = useAppState();
  const analyticsUi = state.uiState.analytics;
  const inputUi = state.uiState.inputActivity;
  const today = getLocalDateKey();
  const startDate = parseDateInput(analyticsUi.rangeStartDate) ?? parseDateInput(analyticsUi.selectedDate) ?? today;
  const endDate = parseDateInput(analyticsUi.rangeEndDate) ?? parseDateInput(analyticsUi.selectedDate) ?? today;
  const range = useMemo(() => makeRange(startDate, endDate), [endDate, startDate]);
  const mergeGapSeconds = state.preferences.recordWindowThresholdSeconds;
  const windowItemLimit = Math.max(1, Math.floor(Number(state.preferences.analyticsWindowItemLimit) || 10));
  const activeTab: AnalyticsTab = analyticsUi.activeTab === 'input' ? 'input' : 'focus';

  const dataDateSet = useMemo(() => {
    const set = new Set<string>();
    for (const session of state.sessions) {
      const start = new Date(session.startAt).getTime();
      const end = new Date(session.endAt).getTime();
      if (Number.isFinite(start)) set.add(toLocalDateInput(new Date(start)));
      if (Number.isFinite(end)) set.add(toLocalDateInput(new Date(end)));
    }
    for (const record of state.inputActivityTimeline) {
      const start = new Date(record.bucketStartAt).getTime();
      if (Number.isFinite(start)) set.add(toLocalDateInput(new Date(start)));
    }
    return set;
  }, [state.inputActivityTimeline, state.sessions]);

  const earliestDate = useMemo(() => {
    const dates = [...dataDateSet].sort();
    return dates[0] ?? today;
  }, [dataDateSet, today]);

  const updateAnalyticsUi = (partial: Partial<typeof analyticsUi>) =>
    updateUiState({
      analytics: {
        ...analyticsUi,
        ...partial,
      },
    });
  const updateInputUi = (partial: Partial<typeof inputUi>) =>
    updateUiState({
      inputActivity: {
        ...inputUi,
        ...partial,
      },
    });

  const setChartMode = (
    key:
      | 'distributionDisplayMode'
      | 'rankDisplayMode'
      | 'hourlyDisplayMode'
      | 'trendDisplayMode'
      | 'timelineDisplayMode',
    mode: DisplayMode,
  ) => updateAnalyticsUi({ [key]: mode } as Partial<typeof analyticsUi>);

  const daySegments = useMemo(
    () => compileMergedFocusSegments(state.sessions, state.profiles, range, mergeGapSeconds),
    [mergeGapSeconds, range, state.profiles, state.sessions],
  );
  const rawFocusSegments = useMemo(
    () => compileFocusSegments(state.sessions, state.profiles, range),
    [range, state.profiles, state.sessions],
  );
  const focusSecondsByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const segment of daySegments) {
      map.set(segment.classificationKey, (map.get(segment.classificationKey) || 0) + segment.durationSeconds);
    }
    return map;
  }, [daySegments]);

  const distributionMode: DisplayMode = analyticsUi.distributionDisplayMode === 'window' ? 'window' : 'category';
  const rankMode: DisplayMode = analyticsUi.rankDisplayMode === 'window' ? 'window' : 'category';
  const hourlyDisplayMode: DisplayMode = analyticsUi.hourlyDisplayMode === 'window' ? 'window' : 'category';
  const trendDisplayMode: DisplayMode = analyticsUi.trendDisplayMode === 'window' ? 'window' : 'category';
  const timelineDisplayMode: DisplayMode = analyticsUi.timelineDisplayMode === 'window' ? 'window' : 'category';
  const heatmapCategory: HeatmapCategory =
    analyticsUi.heatmapCategory === ALL_HEATMAP_CATEGORIES || CATEGORIES.includes(analyticsUi.heatmapCategory)
      ? analyticsUi.heatmapCategory
      : CATEGORIES[0];
  const hourlyMode = analyticsUi.hourlyMode;

  const buildChartDistribution = useCallback((mode: DisplayMode) => {
    const raw = buildDistribution(daySegments, mode);
    if (mode === 'window') return raw.slice(0, windowItemLimit);
    const map = new Map(raw.map(item => [item.name, item]));
    const categoryItems = CATEGORIES.map(category => map.get(category) ?? { name: category, seconds: 0, minutes: 0 });
    const extraItems = raw.filter(item => !CATEGORIES.includes(item.name));
    return [...categoryItems, ...extraItems].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin'));
  }, [daySegments, windowItemLimit]);

  const distribution = useMemo(() => buildChartDistribution(distributionMode), [buildChartDistribution, distributionMode]);
  const rankData = useMemo(
    () => buildChartDistribution(rankMode).map(item => ({ ...item, minutes: Math.round(item.seconds / 60) })),
    [buildChartDistribution, rankMode],
  );
  const rankChartHeight = Math.max(260, rankData.length * 34);
  const distributionTotalSeconds = distribution.reduce((sum, item) => sum + item.seconds, 0);
  const pieColors = distribution.map((item, index) => getDisplayModeColor(item.name, distributionMode, index));

  const hourlyDistribution = useMemo(() => buildChartDistribution(hourlyDisplayMode), [buildChartDistribution, hourlyDisplayMode]);
  const hourlySeries = useMemo<ChartSeries[]>(
    () =>
      hourlyDisplayMode === 'category'
        ? CATEGORIES.map(category => ({ key: category, name: category, color: getCategoryColor(category) }))
        : hourlyDistribution.map((item, index) => ({ key: `series-${index}`, name: item.name, color: getWindowSeriesColor(index) })),
    [hourlyDisplayMode, hourlyDistribution],
  );
  const hourlyData = useMemo(
    () =>
      hourlyDisplayMode === 'category'
        ? buildHourlyActivity(daySegments, range, CATEGORIES)
        : buildHourlyWindowActivity(daySegments, range, hourlySeries),
    [daySegments, hourlyDisplayMode, hourlySeries, range],
  );
  const trend = useMemo(
    () => buildMultiSeriesTrendForRange(daySegments, trendDisplayMode, startDate, endDate, windowItemLimit),
    [daySegments, endDate, startDate, trendDisplayMode, windowItemLimit],
  );
  const trendSeries = trend.series.map((item, index) => ({
    key: item.key,
    name: item.name,
    color: getDisplayModeColor(item.name, trendDisplayMode, index),
  }));
  const heatmapData = useMemo(
    () => buildHeatmap(state.sessions, state.profiles, heatmapCategory, 90, new Date(`${endDate}T00:00:00`), { mergeGapSeconds }),
    [endDate, heatmapCategory, mergeGapSeconds, state.profiles, state.sessions],
  );
  const maxHeatmapMinutes = Math.max(...heatmapData.map(item => item.minutes), 1);

  const timelineItems = useMemo(() => {
    const segments = compileFocusSegments(state.sessions, state.profiles, range).filter(segment =>
      timelineDisplayMode === 'category' ? true : true,
    );
    const limit = timelineDisplayMode === 'window' ? windowItemLimit : 80;
    return buildTimelineItems(segments, state.powerEvents, range, { mergeFocusGapSeconds: mergeGapSeconds })
      .slice(-limit)
      .sort((a, b) => b.startMs - a.startMs || b.endMs - a.endMs);
  }, [mergeGapSeconds, range, state.powerEvents, state.profiles, state.sessions, timelineDisplayMode, windowItemLimit]);

  const topItem = rankData.find(item => item.seconds > 0);
  const longestContinuousFocusSeconds = daySegments.reduce((max, segment) => Math.max(max, segment.durationSeconds), 0);
  const objectCount = new Set(daySegments.map(segment => segment.classificationKey)).size;
  const currentFocused = state.currentFocusedWindow;

  const inputMetric = inputUi.selectedMetric || 'keyPresses';
  const selectedMetricConfig = INPUT_METRICS.find(item => item.key === inputMetric) ?? INPUT_METRICS[0];
  const inputRecords = useMemo(
    () => state.inputActivityTimeline.filter(record => isInputRecordInRange(record, range)),
    [range, state.inputActivityTimeline],
  );
  const inputAggregates = useMemo(
    () => buildWindowInputAggregates(inputRecords, focusSecondsByKey),
    [focusSecondsByKey, inputRecords],
  );
  const inputTotals = useMemo(
    () =>
      inputAggregates.reduce(
        (sum, item) => ({
          keyPresses: sum.keyPresses + item.keyPresses,
          leftClicks: sum.leftClicks + item.leftClicks,
          rightClicks: sum.rightClicks + item.rightClicks,
          middleClicks: sum.middleClicks + item.middleClicks,
          sideBackClicks: sum.sideBackClicks + item.sideBackClicks,
          sideForwardClicks: sum.sideForwardClicks + item.sideForwardClicks,
          totalClicks: sum.totalClicks + item.totalClicks,
          scrollTicks: sum.scrollTicks + item.scrollTicks,
          mouseMovePixels: sum.mouseMovePixels + item.mouseMovePixels,
          keyCounts: mergeKeyCounts(sum.keyCounts, item.keyCounts),
        }),
        {
          keyPresses: 0,
          leftClicks: 0,
          rightClicks: 0,
          middleClicks: 0,
          sideBackClicks: 0,
          sideForwardClicks: 0,
          totalClicks: 0,
          scrollTicks: 0,
          mouseMovePixels: 0,
          keyCounts: {} as KeyCountMap,
        },
      ),
    [inputAggregates],
  );
  const inputRows = useMemo(
    () =>
      [...inputAggregates].sort((a, b) => {
        const diff = getMetricValue(b, inputMetric) - getMetricValue(a, inputMetric);
        return diff || a.displayName.localeCompare(b.displayName, 'zh-CN-u-co-pinyin');
      }),
    [inputAggregates, inputMetric],
  );
  const inputTrend = useMemo(
    () => buildInputTrend(state.inputActivityTimeline, startDate, endDate, inputMetric),
    [endDate, inputMetric, startDate, state.inputActivityTimeline],
  );
  const keyRows = useMemo(() => buildKeyRows(inputTotals.keyCounts), [inputTotals.keyCounts]);
  const maxKeyCount = Math.max(1, ...keyRows.map(item => item.count));
  const topInputValue = Math.max(1, ...inputRows.map(item => getMetricValue(item, inputMetric)));
  const inputPieRows = inputRows
    .filter(item => getMetricValue(item, inputMetric) > 0)
    .slice(0, windowItemLimit)
    .map(item => ({ name: item.displayName, value: getMetricValue(item, inputMetric) }));

  const setRange = (next: { startDate: string; endDate: string }) => {
    updateAnalyticsUi({
      rangeStartDate: next.startDate,
      rangeEndDate: next.endDate,
      selectedDate: next.endDate,
    });
  };

  return (
    <DashboardLayout pageTitle="数据统计">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <RangeSelector
            startDate={startDate}
            endDate={endDate}
            onChange={setRange}
            earliestDate={earliestDate}
            dataDateSet={dataDateSet}
          />
          {currentFocused && (
            <div className="ml-auto min-w-0 h-10 px-3 rounded-xl border border-border bg-card flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-muted-foreground">当前焦点</span>
              <span className="max-w-[360px] truncate text-foreground" title={currentFocused.displayName}>
                {currentFocused.displayName}
              </span>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={value => updateAnalyticsUi({ activeTab: value as AnalyticsTab })} className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="focus">焦点数据</TabsTrigger>
            <TabsTrigger value="input">键鼠数据</TabsTrigger>
          </TabsList>

          <TabsContent value="focus" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card className="p-4 bg-card border-border">
                <p className="text-xs text-muted-foreground">最常聚焦</p>
                <p className="text-lg font-semibold text-foreground mt-1 truncate">{topItem?.name ?? '暂无数据'}</p>
                {topItem && <p className="text-xs text-muted-foreground mt-1">{formatDuration(topItem.seconds)}</p>}
              </Card>
              <Card className="p-4 bg-card border-border">
                <p className="text-xs text-muted-foreground">最常聚焦总时长</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{formatDuration(topItem?.seconds ?? 0)}</p>
              </Card>
              <Card className="p-4 bg-card border-border">
                <p className="text-xs text-muted-foreground">最长无间断聚焦</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{formatDuration(longestContinuousFocusSeconds)}</p>
              </Card>
              <Card className="p-4 bg-card border-border">
                <p className="text-xs text-muted-foreground">涉及对象数量</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{objectCount}</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card className="p-4 bg-card border-border">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">占比统计</h3>
                  <DisplayModeToggle value={distributionMode} onChange={mode => setChartMode('distributionDisplayMode', mode)} />
                </div>
                {distributionTotalSeconds > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-center">
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart>
                        <Pie data={distribution} dataKey="seconds" cx="50%" cy="50%" innerRadius={55} outerRadius={92} paddingAngle={2}>
                          {distribution.map((item, index) => (
                            <Cell key={item.name} fill={pieColors[index]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatDuration(value), '时长']} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 min-w-0 max-h-64 overflow-auto pr-1">
                      {distribution.map((item, index) => {
                        const percent = Math.round((item.seconds / distributionTotalSeconds) * 100);
                        return (
                          <div key={item.name} className="flex items-center gap-2 text-xs">
                            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: pieColors[index] }} />
                            <span className="text-foreground flex-1 truncate" title={item.name}>{item.name}</span>
                            <span className="text-muted-foreground">{formatDuration(item.seconds)}</span>
                            <span className="text-muted-foreground w-9 text-right">{percent}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-12">该时间段暂无焦点记录</p>
                )}
              </Card>

              <Card className="p-4 bg-card border-border">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">焦点时长排行</h3>
                  <DisplayModeToggle value={rankMode} onChange={mode => setChartMode('rankDisplayMode', mode)} />
                </div>
                {rankData.length > 0 ? (
                  <div className="max-h-[520px] overflow-auto pr-1">
                    <ResponsiveContainer width="100%" height={rankChartHeight}>
                      <BarChart data={rankData} layout="vertical" margin={{ left: 6, right: 12, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis dataKey="name" type="category" width={RANK_AXIS_WIDTH} tickLine={false} axisLine={false} interval={0} tick={renderRankYAxisTick} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} 分钟`, '时长']} />
                        <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-12">暂无排行数据</p>
                )}
              </Card>

              <Card className="p-4 bg-card border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">小时活动</h3>
                  <div className="flex items-center gap-2">
                    <DisplayModeToggle value={hourlyDisplayMode} onChange={mode => setChartMode('hourlyDisplayMode', mode)} />
                    <div className="flex rounded-lg border border-border overflow-hidden">
                      {[
                        { label: '堆叠', value: 'category' as const },
                        { label: '总量', value: 'total' as const },
                      ].map(item => (
                        <button
                          key={item.value}
                          onClick={() => updateAnalyticsUi({ hourlyMode: item.value })}
                          className={`h-8 px-3 text-[11px] ${hourlyMode === item.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [`${Math.round(value)} 分钟`, name === 'totalMinutes' ? '总量' : name]} />
                    {hourlyMode === 'total' ? (
                      <Bar dataKey="totalMinutes" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                    ) : (
                      hourlySeries.map(series => <Bar key={series.key} dataKey={series.key} name={series.name} stackId="category" fill={series.color} radius={[4, 4, 0, 0]} />)
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-4 bg-card border-border">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">日期趋势</h3>
                    <p className="text-xs text-muted-foreground mt-1">按当前时间段逐日统计</p>
                  </div>
                  <DisplayModeToggle value={trendDisplayMode} onChange={mode => setChartMode('trendDisplayMode', mode)} />
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [`${Math.round(Number(value))} 分钟`, name]} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="totalMinutes" name="总聚焦时长" stroke="hsl(var(--primary))" strokeWidth={2.4} dot={false} />
                    {trendSeries.map(series => (
                      <Line key={series.key} type="monotone" dataKey={series.key} name={series.name} stroke={series.color} strokeWidth={1.6} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-4 bg-card border-border xl:col-span-2">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">时间线</h3>
                    <p className="text-xs text-muted-foreground mt-1">按真实发生时间排序，最新在前</p>
                  </div>
                  <DisplayModeToggle value={timelineDisplayMode} onChange={mode => setChartMode('timelineDisplayMode', mode)} />
                </div>
                <div className="space-y-1 max-h-72 overflow-auto pr-1">
                  {timelineItems.length > 0 ? (
                    timelineItems.map(item => {
                      const color = item.type === 'focus' ? getCategoryColor(item.category ?? '其他') : item.markerColor ?? '#22c55e';
                      return (
                        <div key={`${item.type}-${item.id}-${item.startMs}`} className="flex items-center gap-3 text-xs py-2 border-l-2 pl-3 rounded-r-lg hover:bg-secondary/40" style={{ borderColor: color }}>
                          <span className="text-muted-foreground w-24 shrink-0">
                            {new Date(item.startMs).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                          <span className="text-foreground flex-1 truncate">{item.label}</span>
                          <span className="text-muted-foreground truncate max-w-xs">{item.detail}</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-8">该时间段暂无记录</p>
                  )}
                </div>
              </Card>

              <Card className="p-4 bg-card border-border xl:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">日历热力图</h3>
                    <p className="text-xs text-muted-foreground mt-1">以当前结束日期向前显示 90 天</p>
                  </div>
                  <Select value={heatmapCategory} onValueChange={value => updateAnalyticsUi({ heatmapCategory: value })}>
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_HEATMAP_CATEGORIES}>{ALL_HEATMAP_CATEGORIES}</SelectItem>
                      {CATEGORIES.map(category => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}>
                  {heatmapData.map(item => {
                    const intensity = maxHeatmapMinutes > 0 ? item.minutes / maxHeatmapMinutes : 0;
                    const color = heatmapCategory === ALL_HEATMAP_CATEGORIES ? '#38bdf8' : getCategoryColor(heatmapCategory);
                    const alpha = Math.round(intensity * 190 + 25).toString(16).padStart(2, '0');
                    return (
                      <div key={item.date} title={`${item.date}: ${item.minutes} 分钟`} className="aspect-square rounded-[4px] border border-border/30 cursor-pointer hover:ring-1 hover:ring-primary/60 transition-all" style={{ backgroundColor: item.minutes > 0 ? `${color}${alpha}` : 'hsl(var(--secondary))' }} />
                    );
                  })}
                </div>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="input" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: '按键次数', value: inputTotals.keyPresses, icon: Keyboard, suffix: '' },
                { label: '鼠标点击', value: inputTotals.totalClicks, icon: MousePointerClick, suffix: '' },
                { label: '鼠标移动', value: inputTotals.mouseMovePixels, icon: ArrowLeftRight, suffix: ' px' },
                { label: '滚轮滚动', value: inputTotals.scrollTicks, icon: RotateCcw, suffix: '' },
              ].map(item => (
                <Card key={item.label} className="p-4 border-border bg-card">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <item.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="text-2xl font-semibold text-foreground tabular-nums">{formatInteger(item.value)}{item.suffix}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
              <Card className="p-4 border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">鼠标点击明细</h3>
                  <Mouse className="w-4 h-4 text-primary" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {[
                    { label: '左键', value: inputTotals.leftClicks },
                    { label: '中键', value: inputTotals.middleClicks },
                    { label: '右键', value: inputTotals.rightClicks },
                    { label: '后退', value: inputTotals.sideBackClicks },
                    { label: '前进', value: inputTotals.sideForwardClicks },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl bg-secondary/60 px-4 py-3">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{formatInteger(item.value)}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-4 border-border bg-card">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">按键分布</h3>
                  <Button
                    size="sm"
                    variant={inputUi.keyboardMode === 'rank' ? 'default' : 'outline'}
                    className="h-8 text-xs"
                    onClick={() => updateInputUi({ keyboardMode: inputUi.keyboardMode === 'rank' ? 'heatmap' : 'rank' })}
                  >
                    {inputUi.keyboardMode === 'rank' ? '键盘热力图' : '按键排行'}
                  </Button>
                </div>
                {inputUi.keyboardMode === 'rank' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 max-h-[300px] overflow-auto pr-1">
                    {keyRows.length > 0 ? (
                      keyRows.slice(0, 24).map((item, index) => (
                        <MetricRow key={item.code} label={item.label} value={item.count} max={maxKeyCount} color={getSeriesColor(index)} />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground py-8 text-center sm:col-span-2">该时间段暂无按键记录</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5 overflow-auto pb-1">
                    <div className="min-w-[760px] space-y-1.5">
                      {KEYBOARD_ROWS.map((row, rowIndex) => (
                        <div key={rowIndex} className="flex gap-1.5">
                          {row.map((keyDef, keyIndex) => (
                            <KeyboardKey key={`${rowIndex}-${keyIndex}-${keyDef.label}`} keyDef={keyDef} count={keyDef.code ? Number(inputTotals.keyCounts[keyDef.code] || 0) : 0} max={maxKeyCount} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              <Card className="p-4 border-border bg-card xl:col-span-2">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-foreground mr-auto">窗口明细</h3>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {INPUT_METRICS.map(metric => (
                      <button
                        key={metric.key}
                        type="button"
                        onClick={() => updateInputUi({ selectedMetric: metric.key })}
                        className={`h-8 px-3 text-xs ${inputMetric === metric.key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
                      >
                        {metric.shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
                  <div className="space-y-3 max-h-[390px] overflow-auto pr-1">
                    {inputRows.filter(item => getMetricValue(item, inputMetric) > 0).length > 0 ? (
                      inputRows
                        .filter(item => getMetricValue(item, inputMetric) > 0)
                        .map((item, index) => (
                          <MetricRow
                            key={item.classificationKey}
                            label={item.displayName}
                            sub={`${compactTypeLabel(item.objectType)} · 聚焦 ${formatDuration(item.focusSeconds)}`}
                            value={getMetricValue(item, inputMetric)}
                            formattedValue={formatMetricValue(inputMetric, getMetricValue(item, inputMetric))}
                            max={topInputValue}
                            color={getSeriesColor(index)}
                          />
                        ))
                    ) : (
                      <p className="text-xs text-muted-foreground py-10 text-center">该时间段暂无键鼠记录</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 min-h-[240px]">
                    <h4 className="text-xs font-semibold text-foreground mb-2">窗口占比</h4>
                    {inputPieRows.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={165}>
                          <PieChart>
                            <Pie data={inputPieRows} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={68} paddingAngle={2}>
                              {inputPieRows.map((item, index) => (
                                <Cell key={item.name} fill={getSeriesColor(index)} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatMetricValue(inputMetric, value), selectedMetricConfig.label]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-1 max-h-32 overflow-auto">
                          {inputPieRows.map((item, index) => (
                            <div key={item.name} className="flex items-center gap-2 text-[11px]">
                              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getSeriesColor(index) }} />
                              <span className="truncate flex-1 text-muted-foreground" title={item.name}>{item.name}</span>
                              <span className="text-foreground tabular-nums">{formatMetricValue(inputMetric, item.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="h-full min-h-[180px] flex items-center justify-center text-xs text-muted-foreground">暂无占比数据</div>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="p-4 border-border bg-card xl:col-span-2">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-foreground mr-auto">日期趋势</h3>
                  <BarChart3 className="w-4 h-4 text-primary" />
                </div>
                <ResponsiveContainer width="100%" height={245}>
                  <LineChart data={inputTrend} margin={{ left: 6, right: 14, top: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.65} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [formatMetricValue(inputMetric, value), selectedMetricConfig.label]}
                      labelFormatter={label => `日期 ${label}`}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
