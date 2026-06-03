import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Keyboard, Mouse, MousePointerClick } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
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
  { key: 'keyPresses', label: '按键次数', shortLabel: '按键' },
  { key: 'totalClicks', label: '鼠标点击', shortLabel: '点击' },
  { key: 'scrollTicks', label: '滚轮滚动', shortLabel: '滚动' },
  { key: 'mouseMovePixels', label: '鼠标移动距离', shortLabel: '移动' },
];

const RANK_AXIS_WIDTH = 132;
const RANK_LABEL_MAX_UNITS = 24;

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

function getTextVisualUnits(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (char.charCodeAt(0) <= 0x7f ? 1 : 2), 0);
}

function truncateTextByVisualUnits(value: string, maxUnits: number) {
  const text = value.trim();
  if (getTextVisualUnits(text) <= maxUnits) {
    return text;
  }

  const suffix = '...';
  const targetUnits = Math.max(1, maxUnits - suffix.length);
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

  return `${output || text.slice(0, 1)}${suffix}`;
}

function getRankLabelFontSize(value: string) {
  const units = getTextVisualUnits(value);
  if (units <= 14) {
    return 12;
  }
  if (units <= 22) {
    return 11;
  }
  if (units <= 30) {
    return 10;
  }
  return 9;
}

function renderRankYAxisTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const rawName = String(payload?.value ?? '');
  const displayName = truncateTextByVisualUnits(rawName, RANK_LABEL_MAX_UNITS);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{rawName}</title>
      <text
        x={-8}
        y={0}
        dy={4}
        textAnchor="end"
        fill="hsl(var(--foreground))"
        fontSize={getRankLabelFontSize(rawName)}
      >
        {displayName}
      </text>
    </g>
  );
}

function getSeriesColor(index: number) {
  return `hsl(${(index * 47 + 186) % 360}, 72%, 56%)`;
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
    return `${Math.round(value).toLocaleString('zh-CN')} px`;
  }
  return Math.round(value).toLocaleString('zh-CN');
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

function buildHourlyRows(
  records: InputActivityTimelineRecord[],
  range: TimeRange,
  metric: InputActivityMetric,
  topRows: WindowInputAggregate[],
) {
  const topKeySet = new Set(topRows.map(item => item.classificationKey));
  const series = topRows.map((item, index) => ({
    key: `series-${index}`,
    classificationKey: item.classificationKey,
    name: item.displayName,
    color: getSeriesColor(index),
  }));
  const seriesKeyMap = new Map(series.map(item => [item.classificationKey, item.key]));
  const rows: Array<Record<string, string | number>> = [];
  const startHour = new Date(range.startMs);
  startHour.setMinutes(0, 0, 0);
  const endHour = new Date(range.endMs);
  endHour.setMinutes(0, 0, 0);
  if (endHour.getTime() < range.endMs) {
    endHour.setHours(endHour.getHours() + 1);
  }

  for (let cursor = startHour.getTime(); cursor < endHour.getTime(); cursor += 3600000) {
    const row: Record<string, string | number> = {
      hour: new Date(cursor).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      timestamp: cursor,
      total: 0,
    };
    for (const item of series) {
      row[item.key] = 0;
    }
    rows.push(row);
  }

  for (const record of records) {
    const startMs = new Date(record.bucketStartAt).getTime();
    if (!Number.isFinite(startMs) || startMs < range.startMs || startMs >= range.endMs) {
      continue;
    }
    const bucketStartMs = Math.floor(startMs / 3600000) * 3600000;
    const row = rows.find(item => Number(item.timestamp) === bucketStartMs);
    if (!row) {
      continue;
    }
    const value = metric === 'totalClicks' ? getTotalClicks(record) : Number(record[metric] || 0);
    row.total = Number(row.total || 0) + value;
    if (topKeySet.has(record.classificationKey)) {
      const seriesKey = seriesKeyMap.get(record.classificationKey);
      if (seriesKey) {
        row[seriesKey] = Number(row[seriesKey] || 0) + value;
      }
    }
  }

  return { rows, series };
}

export default function InputActivityPage() {
  const { state, updateUiState } = useAppState();
  const inputUi = state.uiState.inputActivity;
  const selectedDate = inputUi.selectedDate || getLocalDateKey();
  const selectedMetric = inputUi.selectedMetric || 'keyPresses';
  const selectedMetricConfig = METRICS.find(item => item.key === selectedMetric) ?? METRICS[0];
  const windowLimit = Math.max(1, Math.floor(Number(state.preferences.analyticsWindowItemLimit) || 10));
  const selectedRange = useMemo(() => getDayRange(selectedDate), [selectedDate]);

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
  const sortedRows = useMemo(
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
  const topRows = sortedRows.filter(item => getMetricValue(item, selectedMetric) > 0).slice(0, windowLimit);

  const totals = useMemo(
    () =>
      aggregates.reduce(
        (sum, item) => ({
          keyPresses: sum.keyPresses + item.keyPresses,
          totalClicks: sum.totalClicks + item.totalClicks,
          scrollTicks: sum.scrollTicks + item.scrollTicks,
          mouseMovePixels: sum.mouseMovePixels + item.mouseMovePixels,
        }),
        { keyPresses: 0, totalClicks: 0, scrollTicks: 0, mouseMovePixels: 0 },
      ),
    [aggregates],
  );

  const pieData = topRows.map(item => ({
    name: item.displayName,
    value: getMetricValue(item, selectedMetric),
  }));
  const barData = topRows.map(item => ({
    name: item.displayName,
    value: getMetricValue(item, selectedMetric),
  }));
  const barChartHeight = Math.max(260, barData.length * 34);
  const recentRange = useMemo(() => {
    const endMs = Date.now();
    return {
      startMs: endMs - 12 * 3600000,
      endMs,
    };
  }, []);
  const recentRecords = useMemo(
    () => state.inputActivityTimeline.filter(record => isRecordInRange(record, recentRange)),
    [recentRange, state.inputActivityTimeline],
  );
  const recentAggregates = useMemo(
    () => buildWindowAggregates(recentRecords, new Map()),
    [recentRecords],
  );
  const recentTopRows = useMemo(
    () =>
      [...recentAggregates]
        .sort((a, b) => getMetricValue(b, selectedMetric) - getMetricValue(a, selectedMetric))
        .filter(item => getMetricValue(item, selectedMetric) > 0)
        .slice(0, windowLimit),
    [recentAggregates, selectedMetric, windowLimit],
  );
  const hourly = useMemo(
    () => buildHourlyRows(recentRecords, recentRange, selectedMetric, recentTopRows),
    [recentRecords, recentRange, recentTopRows, selectedMetric],
  );

  const currentFocused = state.currentFocusedWindow;
  const updateInputUi = (partial: Partial<typeof inputUi>) => {
    updateUiState({
      inputActivity: {
        ...inputUi,
        ...partial,
      },
    });
  };

  const statCards = [
    {
      label: '今日按键',
      value: formatMetricValue('keyPresses', totals.keyPresses),
      icon: Keyboard,
    },
    {
      label: '今日点击',
      value: formatMetricValue('totalClicks', totals.totalClicks),
      icon: MousePointerClick,
    },
    {
      label: '今日滚动',
      value: formatMetricValue('scrollTicks', totals.scrollTicks),
      icon: Activity,
    },
    {
      label: '今日鼠标移动',
      value: formatMetricValue('mouseMovePixels', totals.mouseMovePixels),
      icon: Mouse,
    },
  ];

  return (
    <DashboardLayout pageTitle="键鼠统计">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={selectedDate}
            onChange={event => updateInputUi({ selectedDate: event.target.value })}
            className="h-9 px-3 text-xs rounded-xl border border-border bg-card text-foreground"
          />
          <div className="flex rounded-xl border border-border overflow-hidden bg-secondary/50">
            {METRICS.map(metric => (
              <button
                key={metric.key}
                onClick={() => updateInputUi({ selectedMetric: metric.key })}
                className={`px-4 py-2 text-xs transition-colors ${
                  selectedMetric === metric.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {metric.shortLabel}
              </button>
            ))}
          </div>
          {currentFocused && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto px-3 py-2 rounded-xl bg-card border border-border">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              当前焦点：<span className="text-foreground max-w-sm truncate">{currentFocused.displayName}</span>
            </div>
          )}
        </div>

        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            键鼠统计只保存聚合数据：按键次数、鼠标点击次数、滚轮滚动量和鼠标移动距离；不会保存输入内容、具体按键文本、鼠标坐标或点击位置。
            如果焦点落在管理员权限程序上，普通权限运行的软件可能无法捕获对应输入事件。
          </p>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {statCards.map(card => (
            <Card key={card.label} className="p-4 bg-card border-border">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <card.icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-semibold text-foreground mt-2">{card.value}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">窗口{selectedMetricConfig.label}排行</h3>
              <span className="text-xs text-muted-foreground">前 {windowLimit} 项</span>
            </div>
            {barData.length > 0 ? (
              <div className="max-h-[520px] overflow-auto pr-1">
                <ResponsiveContainer width="100%" height={barChartHeight}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 6, right: 12, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={RANK_AXIS_WIDTH}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={renderRankYAxisTick}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [formatMetricValue(selectedMetric, value), selectedMetricConfig.label]}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-12">当天暂无键鼠记录</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">窗口占比</h3>
              <span className="text-xs text-muted-foreground">{selectedMetricConfig.label}</span>
            </div>
            {pieData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-center">
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={92}
                      paddingAngle={2}
                    >
                      {pieData.map((item, index) => (
                        <Cell key={item.name} fill={getSeriesColor(index)} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [formatMetricValue(selectedMetric, value), selectedMetricConfig.label]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 min-w-0 max-h-64 overflow-auto pr-1">
                  {pieData.map((item, index) => {
                    const total = pieData.reduce((sum, row) => sum + Number(row.value || 0), 0);
                    const percent = total > 0 ? Math.round((Number(item.value || 0) / total) * 100) : 0;
                    return (
                      <div key={item.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: getSeriesColor(index) }} />
                        <span className="text-foreground flex-1 truncate">{item.name}</span>
                        <span className="text-muted-foreground">{formatMetricValue(selectedMetric, item.value)}</span>
                        <span className="text-muted-foreground w-9 text-right">{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-12">当天暂无占比数据</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border xl:col-span-2">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">最近 12 小时键鼠活动</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  按窗口堆叠显示 {selectedMetricConfig.label}，最多显示最近活动前 {windowLimit} 个窗口。
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hourly.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [
                    formatMetricValue(selectedMetric, value),
                    name === 'total' ? '总量' : name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {hourly.series.length > 0 ? (
                  hourly.series.map(series => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.name}
                      stackId="input"
                      fill={series.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))
                ) : (
                  <Bar dataKey="total" name="总量" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 bg-card border-border xl:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">窗口键鼠明细</h3>
              <span className="text-xs text-muted-foreground">按 {selectedMetricConfig.label} 从高到低排序</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left font-medium py-2 pr-3">窗口</th>
                    <th className="text-left font-medium py-2 px-3">类型</th>
                    <th className="text-right font-medium py-2 px-3">今日焦点</th>
                    <th className="text-right font-medium py-2 px-3">按键</th>
                    <th className="text-right font-medium py-2 px-3">点击</th>
                    <th className="text-right font-medium py-2 px-3">滚动</th>
                    <th className="text-right font-medium py-2 px-3">鼠标移动</th>
                    <th className="text-right font-medium py-2 pl-3">最后输入</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length > 0 ? (
                    sortedRows.map(row => (
                      <tr key={row.classificationKey} className="border-b border-border/60 hover:bg-secondary/30">
                        <td className="py-2 pr-3">
                          <div className="max-w-[340px] truncate text-foreground" title={row.displayName}>
                            {row.displayName}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[340px]">{row.processName}</div>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{row.objectType}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{formatDuration(row.focusSeconds)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatMetricValue('keyPresses', row.keyPresses)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatMetricValue('totalClicks', row.totalClicks)}</td>
                        <td className="py-2 px-3 text-right text-foreground">{formatMetricValue('scrollTicks', row.scrollTicks)}</td>
                        <td className="py-2 px-3 text-right text-foreground">
                          {formatMetricValue('mouseMovePixels', row.mouseMovePixels)}
                        </td>
                        <td className="py-2 pl-3 text-right text-muted-foreground">{formatLastAt(row.lastAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-muted-foreground">
                        当天暂无键鼠记录。记录只会归入已经达到窗口记录阈值的窗口。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
