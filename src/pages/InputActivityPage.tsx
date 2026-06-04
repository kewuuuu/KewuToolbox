import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  ChartNoAxesColumn,
  Keyboard,
  Mouse,
  MousePointerClick,
  RotateCcw,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppState } from '@/store/AppContext';
import {
  compileMergedFocusSegments,
  formatDuration,
  getDayRange,
  getLocalDateKey,
  TimeRange,
} from '@/lib/analyticsReadModel';
import { InputActivityMetric, InputActivityTimelineRecord, ObjectType } from '@/types';

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  color: 'hsl(var(--foreground))',
  fontSize: '12px',
};

const METRICS: Array<{
  key: InputActivityMetric;
  label: string;
  shortLabel: string;
}> = [
  { key: 'totalClicks', label: '鼠标点击', shortLabel: '点击' },
  { key: 'keyPresses', label: '按键次数', shortLabel: '按键' },
  { key: 'mouseMovePixels', label: '鼠标移动', shortLabel: '移动' },
  { key: 'scrollTicks', label: '滚轮滚动', shortLabel: '滚动' },
];

type KeyCountMap = Record<string, number>;

interface KeyDefinition {
  label: string;
  code?: string;
  span?: number;
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
    { label: 'Prt', code: '3639' },
    { label: 'Ins', code: '3666' },
    { label: 'Del', code: '3667' },
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
    { label: '←', code: '57419' },
    { label: '↑', code: '57416' },
    { label: '↓', code: '57424' },
    { label: '→', code: '57421' },
  ],
];

const NUMPAD_ROWS: KeyDefinition[][] = [
  [
    { label: 'Num', code: '69' },
    { label: '/', code: '3637' },
    { label: '*', code: '55' },
    { label: '-', code: '74' },
  ],
  [
    { label: '7', code: '71' },
    { label: '8', code: '72' },
    { label: '9', code: '73' },
    { label: '+', code: '78' },
  ],
  [
    { label: '4', code: '75' },
    { label: '5', code: '76' },
    { label: '6', code: '77' },
    { label: 'Enter', code: '3612' },
  ],
  [
    { label: '1', code: '79' },
    { label: '2', code: '80' },
    { label: '3', code: '81' },
    { label: '.', code: '83' },
  ],
  [{ label: '0', code: '82', span: 2 }],
];

const KEY_LABEL_BY_CODE = [...KEYBOARD_ROWS, ...NUMPAD_ROWS]
  .flat()
  .reduce<Record<string, string>>((map, key) => {
    if (key.code && !map[key.code]) {
      map[key.code] = key.label;
    }
    return map;
  }, {});

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

function mergeKeyCounts(target: KeyCountMap, incoming: KeyCountMap) {
  const next = { ...target };
  for (const [key, value] of Object.entries(incoming || {})) {
    next[key] = (next[key] || 0) + (Number(value) || 0);
  }
  return next;
}

function getMetricValue(item: Pick<WindowInputAggregate, InputActivityMetric>, metric: InputActivityMetric) {
  return Number(item[metric] || 0);
}

function formatInteger(value: number) {
  return Math.round(value || 0).toLocaleString('zh-CN');
}

function formatMetricValue(metric: InputActivityMetric, value: number) {
  if (metric === 'mouseMovePixels') {
    return `${formatInteger(value)} px`;
  }
  return formatInteger(value);
}

function getSeriesColor(index: number) {
  return `hsl(${(index * 53 + 205) % 360}, 72%, 56%)`;
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

function isRecordInRange(record: InputActivityTimelineRecord, range: TimeRange) {
  const startMs = new Date(record.bucketStartAt).getTime();
  return Number.isFinite(startMs) && startMs >= range.startMs && startMs < range.endMs;
}

function buildWindowAggregates(
  records: InputActivityTimelineRecord[],
  focusSecondsByKey: Map<string, number>,
) {
  const aggregateMap = new Map<string, WindowInputAggregate>();

  for (const record of records) {
    const existing = aggregateMap.get(record.classificationKey);
    const lastAt = record.bucketStartAt;

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
        lastAt,
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

    if (new Date(lastAt).getTime() > new Date(existing.lastAt).getTime()) {
      existing.lastAt = lastAt;
    }
  }

  return [...aggregateMap.values()];
}

function buildDailyTrend(
  records: InputActivityTimelineRecord[],
  selectedDate: string,
  days: 7 | 30,
  metric: InputActivityMetric,
) {
  const selectedStart = new Date(`${selectedDate}T00:00:00`);
  const safeSelectedStartMs = Number.isFinite(selectedStart.getTime())
    ? selectedStart.getTime()
    : new Date(`${getLocalDateKey()}T00:00:00`).getTime();
  const firstStartMs = safeSelectedStartMs - (days - 1) * 24 * 3600000;
  const rows: Array<{ date: string; label: string; value: number }> = [];

  for (let index = 0; index < days; index += 1) {
    const day = new Date(firstStartMs + index * 24 * 3600000);
    rows.push({
      date: getLocalDateKey(day),
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      value: 0,
    });
  }

  const rowMap = new Map(rows.map(row => [row.date, row]));
  for (const record of records) {
    const startMs = new Date(record.bucketStartAt).getTime();
    if (!Number.isFinite(startMs) || startMs < firstStartMs || startMs >= safeSelectedStartMs + 24 * 3600000) {
      continue;
    }
    const row = rowMap.get(getLocalDateKey(new Date(startMs)));
    if (row) {
      row.value += metric === 'totalClicks' ? getTotalClicks(record) : Number(record[metric] || 0);
    }
  }

  return rows;
}

function compactTypeLabel(value: ObjectType) {
  if (value === 'BrowserTab') return '网页';
  if (value === 'Desktop') return '桌面';
  return '窗口';
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

function getKeyCount(keyCounts: KeyCountMap, key: KeyDefinition) {
  return key.code ? Number(keyCounts[key.code] || 0) : 0;
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

function KeyboardKey({
  keyDef,
  count,
  max,
}: {
  keyDef: KeyDefinition;
  count: number;
  max: number;
}) {
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

export default function InputActivityPage() {
  const { state, updateUiState } = useAppState();
  const inputUi = state.uiState.inputActivity;
  const selectedDate = inputUi.selectedDate || getLocalDateKey();
  const selectedMetric = inputUi.selectedMetric || 'totalClicks';
  const historyDays = inputUi.historyDays || 7;
  const keyboardMode = inputUi.keyboardMode || 'heatmap';
  const showAppDetails = Boolean(inputUi.showAppDetails);
  const historyChartType = inputUi.historyChartType || 'line';
  const selectedMetricConfig = METRICS.find(item => item.key === selectedMetric) ?? METRICS[0];
  const selectedRange = useMemo(() => getDayRange(selectedDate), [selectedDate]);
  const windowLimit = Math.max(1, Math.floor(Number(state.preferences.analyticsWindowItemLimit) || 10));

  const focusSecondsByKey = useMemo(() => {
    const map = new Map<string, number>();
    const segments = compileMergedFocusSegments(
      state.sessions,
      state.profiles,
      selectedRange,
      state.preferences.recordWindowThresholdSeconds,
    );
    for (const segment of segments) {
      map.set(segment.classificationKey, (map.get(segment.classificationKey) || 0) + segment.durationSeconds);
    }
    return map;
  }, [selectedRange, state.preferences.recordWindowThresholdSeconds, state.profiles, state.sessions]);

  const dayRecords = useMemo(
    () => state.inputActivityTimeline.filter(record => isRecordInRange(record, selectedRange)),
    [selectedRange, state.inputActivityTimeline],
  );

  const aggregates = useMemo(
    () => buildWindowAggregates(dayRecords, focusSecondsByKey),
    [dayRecords, focusSecondsByKey],
  );

  const totals = useMemo(
    () =>
      aggregates.reduce(
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
    [aggregates],
  );

  const sortedBySelectedMetric = useMemo(
    () =>
      [...aggregates].sort((a, b) => {
        const valueDiff = getMetricValue(b, selectedMetric) - getMetricValue(a, selectedMetric);
        if (valueDiff !== 0) return valueDiff;
        return a.displayName.localeCompare(b.displayName, 'zh-CN-u-co-pinyin');
      }),
    [aggregates, selectedMetric],
  );

  const activeApps = useMemo(
    () =>
      [...aggregates]
        .sort((a, b) => {
          const scoreA = a.keyPresses + a.totalClicks + a.scrollTicks + Math.round(a.mouseMovePixels / 100);
          const scoreB = b.keyPresses + b.totalClicks + b.scrollTicks + Math.round(b.mouseMovePixels / 100);
          return scoreB - scoreA;
        })
        .filter(item => item.keyPresses + item.totalClicks + item.scrollTicks + item.mouseMovePixels > 0)
        .slice(0, windowLimit),
    [aggregates, windowLimit],
  );

  const trendRows = useMemo(
    () => buildDailyTrend(state.inputActivityTimeline, selectedDate, historyDays, selectedMetric),
    [historyDays, selectedDate, selectedMetric, state.inputActivityTimeline],
  );

  const keyRows = useMemo(() => buildKeyRows(totals.keyCounts), [totals.keyCounts]);
  const maxKeyCount = Math.max(1, ...keyRows.map(item => item.count));
  const pieRows = sortedBySelectedMetric
    .filter(item => getMetricValue(item, selectedMetric) > 0)
    .slice(0, windowLimit)
    .map(item => ({ name: item.displayName, value: getMetricValue(item, selectedMetric) }));
  const topValue = Math.max(1, ...sortedBySelectedMetric.map(item => getMetricValue(item, selectedMetric)));
  const trendTotal = trendRows.reduce((sum, item) => sum + item.value, 0);
  const currentFocused = state.currentFocusedWindow;

  const updateInputUi = (partial: Partial<typeof inputUi>) => {
    updateUiState({
      inputActivity: {
        ...inputUi,
        ...partial,
      },
    });
  };

  const clickDetails = [
    { label: '左键', value: totals.leftClicks },
    { label: '中键', value: totals.middleClicks },
    { label: '右键', value: totals.rightClicks },
    { label: '后退', value: totals.sideBackClicks },
    { label: '前进', value: totals.sideForwardClicks },
  ];

  return (
    <DashboardLayout pageTitle="键鼠统计">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={event => updateInputUi({ selectedDate: event.target.value })}
            className="h-9 px-3 text-xs rounded-xl border border-border bg-card text-foreground"
          />
          {currentFocused && (
            <div className="ml-auto min-w-0 h-9 px-3 rounded-xl border border-border bg-card flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-muted-foreground">当前焦点</span>
              <span className="max-w-[340px] truncate text-foreground" title={currentFocused.displayName}>
                {currentFocused.displayName}
              </span>
            </div>
          )}
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">今日统计</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Card className="p-4 border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Keyboard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">按键次数</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{formatInteger(totals.keyPresses)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <MousePointerClick className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">鼠标点击</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{formatInteger(totals.totalClicks)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <ArrowLeftRight className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">鼠标移动</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{formatInteger(totals.mouseMovePixels)} px</p>
                </div>
              </div>
            </Card>
            <Card className="p-4 border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <RotateCcw className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">滚轮滚动</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{formatInteger(totals.scrollTicks)}</p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">鼠标点击明细</h3>
              <Mouse className="w-4 h-4 text-primary" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {clickDetails.map(item => (
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
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[
                  { key: 'heatmap', label: '热力图' },
                  { key: 'rank', label: '排行' },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => updateInputUi({ keyboardMode: item.key as 'heatmap' | 'rank' })}
                    className={`h-8 px-3 text-xs ${
                      keyboardMode === item.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {keyboardMode === 'heatmap' ? (
              <div className="space-y-3 overflow-auto pb-1">
                <div className="min-w-[760px] space-y-1.5">
                  {KEYBOARD_ROWS.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-1.5">
                      {row.map((keyDef, keyIndex) => (
                        <KeyboardKey
                          key={`${rowIndex}-${keyIndex}-${keyDef.label}`}
                          keyDef={keyDef}
                          count={getKeyCount(totals.keyCounts, keyDef)}
                          max={maxKeyCount}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1.5 max-w-sm">
                  {NUMPAD_ROWS.flat().map((keyDef, index) => (
                    <KeyboardKey
                      key={`${keyDef.label}-${index}`}
                      keyDef={keyDef}
                      count={getKeyCount(totals.keyCounts, keyDef)}
                      max={maxKeyCount}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 max-h-[300px] overflow-auto pr-1">
                {keyRows.length > 0 ? (
                  keyRows.slice(0, 24).map((item, index) => (
                    <MetricRow
                      key={item.code}
                      label={item.label}
                      value={item.count}
                      max={maxKeyCount}
                      color={getSeriesColor(index)}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center sm:col-span-2">当天暂无按键记录</p>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4 border-border bg-card xl:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground">活跃应用</h3>
              <Button
                variant={showAppDetails ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={() => updateInputUi({ showAppDetails: !showAppDetails })}
              >
                {showAppDetails ? '收起详情' : '应用统计详情'}
              </Button>
            </div>
            <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
              {activeApps.length > 0 ? (
                activeApps.map((item, index) => (
                  <div key={item.classificationKey} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary/40">
                    <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground" title={item.displayName}>
                          {item.displayName}
                        </p>
                        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                          {compactTypeLabel(item.objectType)}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        聚焦 {formatDuration(item.focusSeconds)} · 最后输入 {formatLastAt(item.lastAt)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground text-right tabular-nums">
                      <span>按键 {formatInteger(item.keyPresses)}</span>
                      <span>点击 {formatInteger(item.totalClicks)}</span>
                      <span>滚动 {formatInteger(item.scrollTicks)}</span>
                      <span>移动 {formatInteger(item.mouseMovePixels)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground py-10 text-center">当天暂无活跃应用记录</p>
              )}
            </div>

            {showAppDetails && (
              <div className="mt-4 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left font-medium py-2 pr-3">应用</th>
                      <th className="text-left font-medium py-2 px-3">类型</th>
                      <th className="text-right font-medium py-2 px-3">聚焦</th>
                      <th className="text-right font-medium py-2 px-3">按键</th>
                      <th className="text-right font-medium py-2 px-3">点击</th>
                      <th className="text-right font-medium py-2 px-3">滚动</th>
                      <th className="text-right font-medium py-2 px-3">移动</th>
                      <th className="text-right font-medium py-2 pl-3">最后输入</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeApps.map(item => (
                      <tr key={`detail-${item.classificationKey}`} className="border-b border-border/60 hover:bg-secondary/30">
                        <td className="py-2 pr-3">
                          <div className="max-w-[360px] truncate text-foreground" title={item.displayName}>
                            {item.displayName}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[360px]">{item.processName}</div>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{compactTypeLabel(item.objectType)}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{formatDuration(item.focusSeconds)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatInteger(item.keyPresses)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatInteger(item.totalClicks)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatInteger(item.scrollTicks)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatInteger(item.mouseMovePixels)}</td>
                        <td className="py-2 pl-3 text-right text-muted-foreground">{formatLastAt(item.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground mr-auto">历史记录</h3>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[7, 30].map(days => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => updateInputUi({ historyDays: days as 7 | 30 })}
                    className={`h-8 px-3 text-xs ${
                      historyDays === days ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {days}天
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[
                  { key: 'line', label: '折线' },
                  { key: 'bar', label: '柱状' },
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => updateInputUi({ historyChartType: item.key as 'line' | 'bar' })}
                    className={`h-8 px-3 text-xs ${
                      historyChartType === item.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {METRICS.map(metric => (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => updateInputUi({ selectedMetric: metric.key })}
                    className={`h-8 px-3 text-xs ${
                      selectedMetric === metric.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {metric.shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={245}>
              {historyChartType === 'line' ? (
                <LineChart data={trendRows} margin={{ left: 6, right: 14, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.65} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [formatMetricValue(selectedMetric, value), selectedMetricConfig.label]}
                    labelFormatter={label => `日期 ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              ) : (
                <BarChart data={trendRows} margin={{ left: 6, right: 14, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.65} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [formatMetricValue(selectedMetric, value), selectedMetricConfig.label]}
                    labelFormatter={label => `日期 ${label}`}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">总计：{formatMetricValue(selectedMetric, trendTotal)}</p>
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground mr-auto">窗口明细</h3>
              <ChartNoAxesColumn className="w-4 h-4 text-primary" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
              <div className="space-y-3 max-h-[390px] overflow-auto pr-1">
                {sortedBySelectedMetric.filter(item => getMetricValue(item, selectedMetric) > 0).length > 0 ? (
                  sortedBySelectedMetric
                    .filter(item => getMetricValue(item, selectedMetric) > 0)
                    .map((item, index) => (
                      <MetricRow
                        key={item.classificationKey}
                        label={item.displayName}
                        sub={`${compactTypeLabel(item.objectType)} · 聚焦 ${formatDuration(item.focusSeconds)}`}
                        value={getMetricValue(item, selectedMetric)}
                        formattedValue={formatMetricValue(selectedMetric, getMetricValue(item, selectedMetric))}
                        max={topValue}
                        color={getSeriesColor(index)}
                      />
                    ))
                ) : (
                  <p className="text-xs text-muted-foreground py-10 text-center">当天暂无键鼠记录</p>
                )}
              </div>
              <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 min-h-[240px]">
                <h4 className="text-xs font-semibold text-foreground mb-2">窗口占比</h4>
                {pieRows.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={165}>
                      <PieChart>
                        <Pie data={pieRows} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={68} paddingAngle={2}>
                          {pieRows.map((item, index) => (
                            <Cell key={item.name} fill={getSeriesColor(index)} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(value: number) => [formatMetricValue(selectedMetric, value), selectedMetricConfig.label]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 max-h-32 overflow-auto">
                      {pieRows.map((item, index) => (
                        <div key={item.name} className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getSeriesColor(index) }} />
                          <span className="truncate flex-1 text-muted-foreground" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-foreground tabular-nums">{formatMetricValue(selectedMetric, item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-full min-h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                    暂无占比数据
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
