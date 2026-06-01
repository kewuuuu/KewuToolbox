import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  buildDailyTrend,
  buildDistribution,
  buildHeatmap,
  buildHourlyActivity,
  buildTimelineItems,
  compileFocusSegments,
  compileMergedFocusSegments,
  DisplayMode,
  formatDuration,
  getDayRange,
  getLocalDateKey,
  HeatmapCategory,
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

function formatSignedMinutes(seconds: number) {
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes === 0) {
    return '持平';
  }
  return seconds >= 0 ? `增加 ${minutes} 分钟` : `减少 ${minutes} 分钟`;
}

export default function AnalyticsPage() {
  const { state, setDisplayMode } = useAppState();
  const [selectedDate, setSelectedDate] = useState(getLocalDateKey());
  const [heatmapCategory, setHeatmapCategory] = useState<HeatmapCategory>(CATEGORIES[0]);
  const [hourlyMode, setHourlyMode] = useState<'total' | 'category'>('category');

  const displayMode: DisplayMode = state.displayMode === '显示窗口' ? 'window' : 'category';
  const mergeGapSeconds = state.preferences.recordWindowThresholdSeconds;
  const selectedRange = useMemo(() => getDayRange(selectedDate), [selectedDate]);
  const yesterdayRange = useMemo(() => {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() - 1);
    return getDayRange(getLocalDateKey(date));
  }, [selectedDate]);

  const daySegments = useMemo(
    () => compileMergedFocusSegments(state.sessions, state.profiles, selectedRange, mergeGapSeconds),
    [mergeGapSeconds, selectedRange, state.profiles, state.sessions],
  );
  const yesterdaySegments = useMemo(
    () => compileMergedFocusSegments(state.sessions, state.profiles, yesterdayRange, mergeGapSeconds),
    [mergeGapSeconds, state.profiles, state.sessions, yesterdayRange],
  );

  const totalSeconds = useMemo(
    () => daySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [daySegments],
  );
  const yesterdaySeconds = useMemo(
    () => yesterdaySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [yesterdaySegments],
  );

  const distribution = useMemo(
    () => buildDistribution(daySegments, displayMode),
    [daySegments, displayMode],
  );
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
    () => distribution.slice(0, 12).map(item => ({ ...item, minutes: Math.max(1, item.minutes) })),
    [distribution],
  );
  const hourlyData = useMemo(
    () => buildHourlyActivity(daySegments, selectedRange, CATEGORIES),
    [daySegments, selectedRange],
  );
  const trendData = useMemo(
    () => buildDailyTrend(state.sessions, state.profiles, 14, new Date(), { mergeGapSeconds }),
    [mergeGapSeconds, state.profiles, state.sessions],
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
    return buildTimelineItems(segments, state.powerEvents, range, {
      mergeFocusGapSeconds: mergeGapSeconds,
    }).slice(-40);
  }, [mergeGapSeconds, state.powerEvents, state.profiles, state.sessions]);

  const currentFocused = state.currentFocusedWindow;
  const topItem = distribution[0];
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
            <p className="text-xs text-muted-foreground">当日焦点时长</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{formatDuration(totalSeconds)}</p>
          </Card>
          <Card className="p-4 bg-card border-border">
            <p className="text-xs text-muted-foreground">相比前一天</p>
            <p className="text-2xl font-semibold text-foreground mt-1">
              {formatSignedMinutes(totalSeconds - yesterdaySeconds)}
            </p>
          </Card>
          <Card className="p-4 bg-card border-border">
            <p className="text-xs text-muted-foreground">最常聚焦</p>
            <p className="text-lg font-semibold text-foreground mt-1 truncate">{topItem?.name ?? '暂无数据'}</p>
            {topItem && <p className="text-xs text-muted-foreground mt-1">{formatDuration(topItem.seconds)}</p>}
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
              <span className="text-xs text-muted-foreground">{displayMode === 'category' ? '按性质' : '按窗口'}</span>
            </div>
            {distribution.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-center">
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
                <div className="space-y-2 min-w-0">
                  {distribution.slice(0, 10).map((item, index) => {
                    const percent = totalSeconds > 0 ? Math.round((item.seconds / totalSeconds) * 100) : 0;
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
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} layout="vertical" margin={{ left: 70, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={70}
                    tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [`${value} 分钟`, '时长']}
                  />
                  <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-12">暂无排行数据</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">小时活动</h3>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {[
                  { label: '分类堆叠', value: 'category' as const },
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
                  CATEGORIES.map(category => (
                    <Bar
                      key={category}
                      dataKey={category}
                      stackId="category"
                      fill={getCategoryColor(category)}
                      radius={[4, 4, 0, 0]}
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">近 14 天趋势</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="focusTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => [`${value} 分钟`, '焦点时长']}
                />
                <Area
                  type="monotone"
                  dataKey="minutes"
                  stroke="hsl(var(--primary))"
                  fill="url(#focusTrend)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4 bg-card border-border xl:col-span-2">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">最近 12 小时时间线</h3>
                <p className="text-xs text-muted-foreground mt-1">焦点窗口和系统事件按真实发生时间排序</p>
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
