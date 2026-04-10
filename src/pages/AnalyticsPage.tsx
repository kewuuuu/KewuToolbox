import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { CATEGORIES, getCategoryColor } from '@/lib/categories';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Category } from '@/types';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function AnalyticsPage() {
  const { state, setDisplayMode } = useAppState();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [heatmapCategory, setHeatmapCategory] = useState<Category>(CATEGORIES[0]);

  const isCategory = state.displayMode === '显示性质';

  const daySessions = useMemo(() => {
    const dayStart = new Date(`${selectedDate}T00:00:00`);
    const dayEnd = new Date(`${selectedDate}T23:59:59`);
    return state.sessions.filter(session => {
      const start = new Date(session.startAt);
      return start >= dayStart && start <= dayEnd;
    });
  }, [selectedDate, state.sessions]);

  const pieData = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of daySessions) {
      const key = isCategory ? session.categoryAtThatTime : session.displayName;
      map.set(key, (map.get(key) || 0) + session.durationSeconds);
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value / 60) }))
      .sort((a, b) => b.value - a.value);
  }, [daySessions, isCategory]);

  const pieColors = isCategory
    ? pieData.map(item => getCategoryColor(item.name as Category))
    : pieData.map((_, index) => `hsl(${(index * 37) % 360}, 60%, 55%)`);

  const barData = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of daySessions) {
      const key = isCategory ? session.categoryAtThatTime : session.displayName;
      map.set(key, (map.get(key) || 0) + session.durationSeconds);
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, minutes: Math.round(value / 60) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
  }, [daySessions, isCategory]);

  const timelineSessions = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 12 * 3600000);
    return state.sessions
      .filter(session => new Date(session.startAt) >= start)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [state.sessions]);

  const timelinePowerEvents = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 12 * 3600000);
    return state.powerEvents
      .filter(event => new Date(event.occurredAt) >= start)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }, [state.powerEvents]);

  const heatmapData = useMemo(() => {
    const days: { date: string; minutes: number }[] = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - index);
      const dateStr = date.toISOString().slice(0, 10);
      const dayStart = new Date(`${dateStr}T00:00:00`);
      const dayEnd = new Date(`${dateStr}T23:59:59`);
      const minutes =
        state.sessions
          .filter(session => {
            const start = new Date(session.startAt);
            return start >= dayStart && start <= dayEnd && session.categoryAtThatTime === heatmapCategory;
          })
          .reduce((acc, session) => acc + session.durationSeconds, 0) / 60;
      days.push({ date: dateStr, minutes: Math.round(minutes) });
    }
    return days;
  }, [heatmapCategory, state.sessions]);

  const maxHeatmap = Math.max(...heatmapData.map(item => item.minutes), 1);

  return (
    <DashboardLayout pageTitle="数据统计">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['显示性质', '显示窗口'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setDisplayMode(mode)}
                className={`px-4 py-1.5 text-xs transition-colors ${
                  state.displayMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={event => setSelectedDate(event.target.value)}
            className="h-8 px-2 text-xs rounded-lg border border-border bg-secondary text-foreground"
          />
          {state.currentFocusedWindow && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: getCategoryColor(state.currentFocusedWindow.category) }} />
              当前: {state.currentFocusedWindow.displayName}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">扇形统计</h3>
            {pieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={2}>
                      {pieData.map((_, index) => <Cell key={index} fill={pieColors[index]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(225, 15%, 15%)',
                        border: '1px solid hsl(225, 12%, 20%)',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: 'hsl(210, 20%, 90%)',
                      }}
                      formatter={(value: number) => [`${value} 分钟`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 flex-1">
                  {pieData.slice(0, 8).map((item, index) => (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pieColors[index] }} />
                      <span className="text-foreground flex-1 truncate">{item.name}</span>
                      <span className="text-muted-foreground">{item.value} 分</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">无数据</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">焦点时长排行</h3>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 18%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215, 12%, 50%)' }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(210, 20%, 90%)' }} width={55} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(225, 15%, 15%)',
                      border: '1px solid hsl(225, 12%, 20%)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'hsl(210, 20%, 90%)',
                    }}
                    formatter={(value: number) => [`${value} 分钟`, '时长']}
                  />
                  <Bar dataKey="minutes" fill="hsl(210, 80%, 55%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">无数据</p>
            )}
          </Card>

          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">时间线（最近 12 小时）</h3>
            <div className="space-y-1 max-h-48 overflow-auto">
              {timelineSessions.slice(-20).map(session => (
                <div key={session.id} className="flex items-center gap-2 text-xs py-1 border-l-2 pl-2" style={{ borderColor: getCategoryColor(session.categoryAtThatTime) }}>
                  <span className="text-muted-foreground w-14 shrink-0">
                    {new Date(session.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="text-foreground flex-1 truncate">{session.displayName}</span>
                  <span className="text-muted-foreground">{Math.round(session.durationSeconds / 60)}分</span>
                </div>
              ))}
              {timelinePowerEvents.map(event => (
                <div key={event.id} className="flex items-center gap-2 text-xs py-1 border-l-2 pl-2" style={{ borderColor: event.markerColor }}>
                  <span className="text-muted-foreground w-14 shrink-0">
                    {new Date(event.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="font-medium" style={{ color: event.markerColor }}>{event.eventType}</span>
                  <span className="text-muted-foreground">{event.detail}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">日历热力图</h3>
              <Select value={heatmapCategory} onValueChange={value => setHeatmapCategory(value as Category)}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(category => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-10 gap-1">
              {heatmapData.map(item => {
                const intensity = item.minutes / maxHeatmap;
                const color = getCategoryColor(heatmapCategory);
                const alpha = Math.round(intensity * 200 + 20).toString(16).padStart(2, '0');
                return (
                  <div
                    key={item.date}
                    title={`${item.date}: ${item.minutes}分钟`}
                    className="aspect-square rounded-sm border border-border/30 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all"
                    style={{ backgroundColor: intensity > 0 ? `${color}${alpha}` : 'hsl(225, 12%, 14%)' }}
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
