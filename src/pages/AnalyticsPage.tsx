import { useMemo } from 'react';
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
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { CATEGORIES, getCategoryColor } from '@/lib/categories';
import {
  ALL_HEATMAP_CATEGORIES,
  buildMultiSeriesDailyTrend,
  buildDistribution,
  buildHeatmap,
  buildHourlyActivity,
  buildTimelineItems,
  CompiledFocusSegment,
  compileFocusSegments,
  compileMergedFocusSegments,
  DisplayMode,
  formatDuration,
  getDayRange,
  getLocalDateKey,
  HeatmapCategory,
  TimeRange,
} from '@/lib/analyticsReadModel';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Category } from '@/types';

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  color: 'hsl(var(--foreground))',
  fontSize: '12px',
};

interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

function getWindowSeriesColor(index: number) {
  return `hsl(${(index * 43 + 198) % 360}, 72%, 56%)`;
}

function buildHourlyWindowActivity(
  segments: CompiledFocusSegment[],
  range: TimeRange,
  series: ChartSeries[],
) {
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
      hour: new Date(cursor).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
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
      if (overlapEnd <= overlapStart) {
        continue;
      }
      const spanMs = Math.max(1, segment.endMs - segment.startMs);
      const overlapSeconds = segment.durationSeconds * ((overlapEnd - overlapStart) / spanMs);
      const minutes = overlapSeconds / 60;
      bucket.totalMinutes = Number(bucket.totalMinutes) + minutes;
      const seriesKey = seriesKeyMap.get(segment.displayName);
      if (seriesKey) {
        bucket[seriesKey] = Number(bucket[seriesKey] || 0) + minutes;
      }
    }
  }

  return buckets.map(bucket => {
    const row = {
      ...bucket,
      totalMinutes: Math.round(Number(bucket.totalMinutes)),
    };
    for (const item of series) {
      row[item.key] = Math.round(Number(row[item.key] || 0));
    }
    return row;
  });
}

export default function AnalyticsPage() {
  const { state, setDisplayMode, updateUiState } = useAppState();
  const analyticsUi = state.uiState.analytics;
  const selectedDate = analyticsUi.selectedDate || getLocalDateKey();
  const heatmapCategory: HeatmapCategory =
    analyticsUi.heatmapCategory === ALL_HEATMAP_CATEGORIES || CATEGORIES.includes(analyticsUi.heatmapCategory)
      ? analyticsUi.heatmapCategory
      : CATEGORIES[0];
  const hourlyMode = analyticsUi.hourlyMode;
  const updateAnalyticsUi = (partial: Partial<typeof analyticsUi>) => {
    updateUiState({
      analytics: partial as typeof analyticsUi,
    });
  };
  const setSelectedDate = (selectedDate: string) => updateAnalyticsUi({ selectedDate });
  const setHeatmapCategory = (heatmapCategory: HeatmapCategory) => updateAnalyticsUi({ heatmapCategory });
  const setHourlyMode = (hourlyMode: 'total' | 'category') => updateAnalyticsUi({ hourlyMode });

  const displayMode: DisplayMode = state.displayMode === '显示窗口' ? 'window' : 'category';
  const mergeGapSeconds = state.preferences.recordWindowThresholdSeconds;
  const windowItemLimit = Math.max(1, Math.floor(Number(state.preferences.analyticsWindowItemLimit) || 10));
  const selectedRange = useMemo(() => getDayRange(selectedDate), [selectedDate]);
  const daySegments = useMemo(
    () => compileMergedFocusSegments(state.sessions, state.profiles, selectedRange, mergeGapSeconds),
    [mergeGapSeconds, selectedRange, state.profiles, state.sessions],
  );

  const totalSeconds = useMemo(
    () => daySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [daySegments],
  );
  const longestContinuousFocusSeconds = useMemo(
    () => daySegments.reduce((max, segment) => Math.max(max, segment.durationSeconds), 0),
    [daySegments],
  );

  const distribution = useMemo(() => {
    const rawDistribution = buildDistribution(daySegments, displayMode);
    if (displayMode !== 'category') {
      return rawDistribution.slice(0, windowItemLimit);
    }

    const distributionMap = new Map(rawDistribution.map(item => [item.name, item]));
    const categoryItems = CATEGORIES.map(category => distributionMap.get(category) ?? {
        name: category,
        seconds: 0,
        minutes: 0,
      });
    const extraItems = rawDistribution.filter(item => !CATEGORIES.includes(item.name));
    return [...categoryItems, ...extraItems]
      .sort((a, b) => {
        const secondsDiff = b.seconds - a.seconds;
        if (secondsDiff !== 0) {
          return secondsDiff;
        }
        const aIndex = CATEGORIES.indexOf(a.name as Category);
        const bIndex = CATEGORIES.indexOf(b.name as Category);
        if (aIndex >= 0 && bIndex >= 0) {
          return aIndex - bIndex;
        }
        if (aIndex >= 0) {
          return -1;
        }
        if (bIndex >= 0) {
          return 1;
        }
        return a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin');
      });
  }, [daySegments, displayMode, windowItemLimit]);
  const pieColors = useMemo(
    () =>
      distribution.map((item, index) =>
        displayMode === 'category'
          ? getCategoryColor(item.name as Category)
          : `hsl(${(index * 43) % 360}, 72%, 56%)`,
      ),
    [displayMode, distribution],
  );

  const barData = useMemo(
    () => distribution.map(item => ({ ...item, minutes: Math.round(item.seconds / 60) })),
    [distribution],
  );
  const barChartHeight = Math.max(260, barData.length * 30);
  const distributionTotalSeconds = useMemo(
    () => distribution.reduce((sum, item) => sum + item.seconds, 0),
    [distribution],
  );
  const hourlySeries = useMemo<ChartSeries[]>(
    () =>
      displayMode === 'category'
        ? CATEGORIES.map(category => ({
            key: category,
            name: category,
            color: getCategoryColor(category),
          }))
        : distribution.map((item, index) => ({
            key: `series-${index}`,
            name: item.name,
            color: getWindowSeriesColor(index),
          })),
    [displayMode, distribution],
  );
  const hourlyData = useMemo(
    () =>
      displayMode === 'category'
        ? buildHourlyActivity(daySegments, selectedRange, CATEGORIES)
        : buildHourlyWindowActivity(daySegments, selectedRange, hourlySeries),
    [daySegments, displayMode, hourlySeries, selectedRange],
  );
  const trend = useMemo(
    () =>
      buildMultiSeriesDailyTrend(state.sessions, state.profiles, displayMode, 14, new Date(), {
        categories: CATEGORIES,
        mergeGapSeconds,
        windowLimit: windowItemLimit,
      }),
    [displayMode, mergeGapSeconds, state.profiles, state.sessions, windowItemLimit],
  );
  const trendSeries = useMemo<ChartSeries[]>(
    () =>
      trend.series.map((item, index) => ({
        key: item.key,
        name: item.name,
        color: displayMode === 'category' ? getCategoryColor(item.name as Category) : getWindowSeriesColor(index),
      })),
    [displayMode, trend.series],
  );
  const heatmapData = useMemo(
    () => buildHeatmap(state.sessions, state.profiles, heatmapCategory, 90, new Date(), { mergeGapSeconds }),
    [heatmapCategory, mergeGapSeconds, state.profiles, state.sessions],
  );
  const maxHeatmapMinutes = Math.max(...heatmapData.map(item => item.minutes), 1);

  const timelineItems = useMemo(() => {
    const nowMs = Date.now();
    const range = {
      startMs: nowMs - 12 * 3600000,
      endMs: nowMs,
    };
    const segments = compileFocusSegments(state.sessions, state.profiles, range);
    const timelineLimit = displayMode === 'window' ? windowItemLimit : 40;
    return buildTimelineItems(segments, state.powerEvents, range, {
      mergeFocusGapSeconds: mergeGapSeconds,
    })
      .slice(-timelineLimit)
      .sort((a, b) => b.startMs - a.startMs || b.endMs - a.endMs);
  }, [displayMode, mergeGapSeconds, state.powerEvents, state.profiles, state.sessions, windowItemLimit]);

  const topItem = distribution.find(item => item.seconds > 0);
  const currentFocused = state.currentFocusedWindow;
  const objectCount = new Set(daySegments.map(segment => segment.classificationKey)).size;

  return (
    <DashboardLayout pageTitle="数据统计">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-xl border border-border overflow-hidden bg-secondary/50">
            {[
              { label: '显示性质', value: 'category' as const },
              { label: '显示窗口', value: 'window' as const },
            ].map(mode => (
              <button
                key={mode.value}
                onClick={() => setDisplayMode(mode.label)}
                className={`px-4 py-2 text-xs transition-colors ${
                  displayMode === mode.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={event => setSelectedDate(event.target.value)}
            className="h-9 px-3 text-xs rounded-xl border border-border bg-card text-foreground"
          />
          {currentFocused && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto px-3 py-2 rounded-xl bg-card border border-border">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: getCategoryColor(currentFocused.category) }}
              />
              当前焦点：<span className="text-foreground">{currentFocused.displayName}</span>
            </div>
          )}
        </div>

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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">占比统计</h3>
              <span className="text-xs text-muted-foreground">
                {displayMode === 'category' ? '按性质' : `按窗口 · 前 ${windowItemLimit} 项`}
              </span>
            </div>
            {distribution.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-center">
                {distributionTotalSeconds > 0 ? (
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie
                        data={distribution}
                        dataKey="seconds"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={92}
                        paddingAngle={2}
                      >
                        {distribution.map((item, index) => (
                          <Cell key={item.name} fill={pieColors[index]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number) => [formatDuration(value), '时长']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[230px] rounded-2xl border border-dashed border-border bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
                    当天暂无焦点记录
                  </div>
                )}
                <div className="space-y-2 min-w-0 max-h-64 overflow-auto pr-1">
                  {distribution.map((item, index) => {
                    const percent =
                      distributionTotalSeconds > 0 ? Math.round((item.seconds / distributionTotalSeconds) * 100) : 0;
                    return (
                      <div key={item.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: pieColors[index] }} />
                        <span className="text-foreground flex-1 truncate">{item.name}</span>
                        <span className="text-muted-foreground">{formatDuration(item.seconds)}</span>
                        <span className="text-muted-foreground w-9 text-right">{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-12">当天暂无焦点记录</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">焦点时长排行</h3>
            {barData.length > 0 ? (
              <div className="max-h-[520px] overflow-auto pr-1">
                <ResponsiveContainer width="100%" height={barChartHeight}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 86, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={86}
                      tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [`${value} 分钟`, '时长']}
                    />
                    <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-12">暂无排行数据</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">小时活动</h3>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[
                  { label: displayMode === 'category' ? '分类堆叠' : `窗口堆叠 · 前 ${windowItemLimit}`, value: 'category' as const },
                  { label: '总量', value: 'total' as const },
                ].map(item => (
                  <button
                    key={item.value}
                    onClick={() => setHourlyMode(item.value)}
                    className={`px-3 py-1 text-[11px] ${
                      hourlyMode === item.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [`${Math.round(value)} 分钟`, name === 'totalMinutes' ? '总量' : name]}
                />
                {hourlyMode === 'total' ? (
                  <Bar dataKey="totalMinutes" fill="hsl(var(--primary))" radius={[5, 5, 0, 0]} />
                ) : (
                  hourlySeries.map(series => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.name}
                      stackId="category"
                      fill={series.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 bg-card border-border">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">近 14 天趋势</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {displayMode === 'category'
                    ? '总聚焦时长 + 全部性质聚焦时长'
                    : `总聚焦时长 + 近 14 天聚焦时长前 ${windowItemLimit} 个窗口`}
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [`${Math.round(Number(value))} 分钟`, name]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line
                  type="monotone"
                  dataKey="totalMinutes"
                  name="总聚焦时长"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.4}
                  dot={false}
                />
                {trendSeries.map(series => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.name}
                    stroke={series.color}
                    strokeWidth={1.6}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 bg-card border-border xl:col-span-2">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">最近 12 小时时间线</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {displayMode === 'window'
                    ? `焦点窗口和系统事件按真实发生时间排序，最新在前，最多显示最近 ${windowItemLimit} 项`
                    : '焦点窗口和系统事件按真实发生时间排序，最新在前'}
                </p>
              </div>
            </div>
            <div className="space-y-1 max-h-72 overflow-auto pr-1">
              {timelineItems.length > 0 ? (
                timelineItems.map(item => {
                  const color = item.type === 'focus'
                    ? getCategoryColor(item.category ?? '其他')
                    : item.markerColor ?? '#22c55e';
                  return (
                    <div
                      key={`${item.type}-${item.id}-${item.startMs}`}
                      className="flex items-center gap-3 text-xs py-2 border-l-2 pl-3 rounded-r-lg hover:bg-secondary/40"
                      style={{ borderColor: color }}
                    >
                      <span className="text-muted-foreground w-12 shrink-0">
                        {new Date(item.startMs).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </span>
                      <span className="text-foreground flex-1 truncate">{item.label}</span>
                      <span className="text-muted-foreground truncate max-w-xs">{item.detail}</span>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground text-center py-8">最近 12 小时暂无记录</p>
              )}
            </div>
          </Card>

          <Card className="p-4 bg-card border-border xl:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">日历热力图</h3>
                <p className="text-xs text-muted-foreground mt-1">默认显示学习时长，可切换其他性质</p>
              </div>
              <Select value={heatmapCategory} onValueChange={value => setHeatmapCategory(value as HeatmapCategory)}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_HEATMAP_CATEGORIES}>{ALL_HEATMAP_CATEGORIES}</SelectItem>
                  {CATEGORIES.map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
            >
              {heatmapData.map(item => {
                const intensity = maxHeatmapMinutes > 0 ? item.minutes / maxHeatmapMinutes : 0;
                const color =
                  heatmapCategory === ALL_HEATMAP_CATEGORIES
                    ? '#38bdf8'
                    : getCategoryColor(heatmapCategory);
                const alpha = Math.round(intensity * 190 + 25).toString(16).padStart(2, '0');
                return (
                  <div
                    key={item.date}
                    title={`${item.date}: ${item.minutes} 分钟`}
                    className="aspect-square rounded-[4px] border border-border/30 cursor-pointer hover:ring-1 hover:ring-primary/60 transition-all"
                    style={{ backgroundColor: item.minutes > 0 ? `${color}${alpha}` : 'hsl(var(--secondary))' }}
                  />
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
