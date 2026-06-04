import { useMemo } from 'react';
import {
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
  focusSeconds: number;
  lastAt: string;
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
  if (!Number.isFinite(startMs)) {
    return false;
  }
  return startMs >= range.startMs && startMs < range.endMs;
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
    const dayKey = getLocalDateKey(new Date(startMs));
    const row = rowMap.get(dayKey);
    if (!row) {
      continue;
    }
    row.value += metric === 'totalClicks' ? getTotalClicks(record) : Number(record[metric] || 0);
  }

  return rows;
}

function compactTypeLabel(value: ObjectType) {
  if (value === 'BrowserTab') {
    return '网页';
  }
  if (value === 'Desktop') {
    return '桌面';
  }
  return '窗口';
}

function ProgressRow({
  label,
  value,
  max,
  sub,
  color,
}: {
  label: string;
  value: string;
  max: number;
  sub?: string;
  color: string;
}) {
  const numeric = Number(value.replace(/[^\d.]/g, '')) || 0;
  const width = max > 0 ? Math.max(4, Math.min(100, (numeric / max) * 100)) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex-1 truncate text-foreground" title={label}>
          {label}
        </span>
        {sub && <span className="text-muted-foreground">{sub}</span>}
        <span className="font-semibold text-foreground tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function InputActivityPage() {
  const { state, updateUiState } = useAppState();
  const inputUi = state.uiState.inputActivity;
  const selectedDate = inputUi.selectedDate || getLocalDateKey();
  const selectedMetric = inputUi.selectedMetric || 'totalClicks';
  const historyDays = inputUi.historyDays || 7;
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
        },
      ),
    [aggregates],
  );

  const sortedBySelectedMetric = useMemo(
    () =>
      [...aggregates].sort((a, b) => {
        const valueDiff = getMetricValue(b, selectedMetric) - getMetricValue(a, selectedMetric);
        if (valueDiff !== 0) {
          return valueDiff;
        }
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

  const keyDistributionRows = useMemo(
    () =>
      [...aggregates]
        .sort((a, b) => b.keyPresses - a.keyPresses)
        .filter(item => item.keyPresses > 0)
        .slice(0, 12),
    [aggregates],
  );

  const trendRows = useMemo(
    () => buildDailyTrend(state.inputActivityTimeline, selectedDate, historyDays, selectedMetric),
    [historyDays, selectedDate, selectedMetric, state.inputActivityTimeline],
  );

  const pieRows = sortedBySelectedMetric
    .filter(item => getMetricValue(item, selectedMetric) > 0)
    .slice(0, windowLimit)
    .map(item => ({
      name: item.displayName,
      value: getMetricValue(item, selectedMetric),
    }));

  const topValue = Math.max(1, ...sortedBySelectedMetric.map(item => getMetricValue(item, selectedMetric)));
  const maxKeyPresses = Math.max(1, ...keyDistributionRows.map(item => item.keyPresses));
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
          <Badge variant="outline" className="h-9 px-3 rounded-xl bg-card">
            记录口径：只保存聚合数量，不保存具体按键文本和鼠标坐标
          </Badge>
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
                  <p className="text-2xl font-semibold text-foreground tabular-nums">
                    {formatInteger(totals.mouseMovePixels)} px
                  </p>
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
              <div>
                <h3 className="text-sm font-semibold text-foreground">鼠标点击明细</h3>
                <p className="text-xs text-muted-foreground mt-1">按鼠标按钮类型统计今日点击次数。</p>
              </div>
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
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">按键分布</h3>
                <p className="text-xs text-muted-foreground mt-1">当前版本按窗口统计按键次数，不记录具体按键文本。</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
                键盘热力图
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {keyDistributionRows.length > 0 ? (
                keyDistributionRows.map((item, index) => (
                  <ProgressRow
                    key={item.classificationKey}
                    label={item.displayName}
                    value={formatInteger(item.keyPresses)}
                    max={maxKeyPresses}
                    color={getSeriesColor(index)}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center sm:col-span-2">当天暂无按键记录</p>
              )}
            </div>
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">活跃应用</h3>
                <p className="text-xs text-muted-foreground mt-1">综合按键、点击、滚动和移动量，显示今日最活跃窗口。</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
                应用统计详情
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
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="mr-auto">
                <h3 className="text-sm font-semibold text-foreground">历史记录</h3>
                <p className="text-xs text-muted-foreground mt-1">按日期汇总所选指标，默认展示最近 7 天。</p>
              </div>
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
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              总计：{formatMetricValue(selectedMetric, trendTotal)}
            </p>
          </Card>

          <Card className="p-4 border-border bg-card xl:col-span-2">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="mr-auto">
                <h3 className="text-sm font-semibold text-foreground">窗口明细</h3>
                <p className="text-xs text-muted-foreground mt-1">按当前选择的“{selectedMetricConfig.shortLabel}”从高到低排序。</p>
              </div>
              <ChartNoAxesColumn className="w-4 h-4 text-primary" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
              <div className="space-y-3 max-h-[460px] overflow-auto pr-1">
                {sortedBySelectedMetric.length > 0 ? (
                  sortedBySelectedMetric
                    .filter(item => getMetricValue(item, selectedMetric) > 0)
                    .map((item, index) => (
                      <ProgressRow
                        key={item.classificationKey}
                        label={item.displayName}
                        sub={`${compactTypeLabel(item.objectType)} · 聚焦 ${formatDuration(item.focusSeconds)}`}
                        value={formatMetricValue(selectedMetric, getMetricValue(item, selectedMetric))}
                        max={topValue}
                        color={getSeriesColor(index)}
                      />
                    ))
                ) : (
                  <p className="text-xs text-muted-foreground py-10 text-center">
                    当天暂无键鼠记录。记录只会归入已经达到窗口记录阈值的窗口。
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border/70 bg-secondary/20 p-3 min-h-[260px]">
                <h4 className="text-xs font-semibold text-foreground mb-2">窗口占比</h4>
                {pieRows.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={pieRows} dataKey="value" cx="50%" cy="50%" innerRadius={42} outerRadius={78} paddingAngle={2}>
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
                  <div className="h-full min-h-[220px] flex items-center justify-center text-xs text-muted-foreground">
                    暂无占比数据
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="text-xs text-muted-foreground leading-relaxed">
          说明：鼠标移动距离以像素累计，不换算为实际物理距离；如果焦点落在管理员权限程序上，普通权限运行的 KewuToolbox 可能无法捕获对应键鼠事件。
        </div>
      </div>
    </DashboardLayout>
  );
}
