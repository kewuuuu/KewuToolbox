import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { getCategoryColor, CATEGORIES } from '@/lib/categories';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Category } from '@/types';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function AnalyticsPage() {
  const { state, updateProfile, setDisplayMode } = useAppState();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [heatmapCategory, setHeatmapCategory] = useState<Category>('学习');

  const isCategory = state.displayMode === '显示性质';

  // Filter sessions for selected date
  const daySessions = useMemo(() => {
    const dayStart = new Date(selectedDate + 'T00:00:00');
    const dayEnd = new Date(selectedDate + 'T23:59:59');
    return state.sessions.filter(s => {
      const st = new Date(s.startAt);
      return st >= dayStart && st <= dayEnd;
    });
  }, [state.sessions, selectedDate]);

  // Pie data
  const pieData = useMemo(() => {
    const map = new Map<string, number>();
    daySessions.forEach(s => {
      const key = isCategory ? s.categoryAtThatTime : s.displayName;
      map.set(key, (map.get(key) || 0) + s.durationSeconds);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value / 60) }))
      .sort((a, b) => b.value - a.value);
  }, [daySessions, isCategory]);

  const pieColors = isCategory
    ? pieData.map(d => getCategoryColor(d.name as Category))
    : pieData.map((_, i) => `hsl(${(i * 37) % 360}, 60%, 55%)`);

  // Bar data (top 10)
  const barData = useMemo(() => {
    const map = new Map<string, number>();
    daySessions.forEach(s => {
      const key = isCategory ? s.categoryAtThatTime : s.displayName;
      map.set(key, (map.get(key) || 0) + s.durationSeconds);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, minutes: Math.round(value / 60) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
  }, [daySessions, isCategory]);

  // Timeline sessions (last 12h)
  const timelineSessions = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 12 * 3600000);
    return state.sessions.filter(s => new Date(s.startAt) >= start).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [state.sessions]);

  // Heatmap data (last 30 days)
  const heatmapData = useMemo(() => {
    const days: { date: string; minutes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayStart = new Date(dateStr + 'T00:00:00');
      const dayEnd = new Date(dateStr + 'T23:59:59');
      const mins = state.sessions
        .filter(s => {
          const st = new Date(s.startAt);
          return st >= dayStart && st <= dayEnd && s.categoryAtThatTime === heatmapCategory;
        })
        .reduce((acc, s) => acc + s.durationSeconds, 0) / 60;
      days.push({ date: dateStr, minutes: Math.round(mins) });
    }
    return days;
  }, [state.sessions, heatmapCategory]);

  const maxHeatmap = Math.max(...heatmapData.map(d => d.minutes), 1);

  return (
    <DashboardLayout pageTitle="数据统计">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['显示性质', '显示窗口'] as const).map(m => (
              <button key={m} onClick={() => setDisplayMode(m)}
                className={`px-4 py-1.5 text-xs transition-colors ${state.displayMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}>
                {m}
              </button>
            ))}
          </div>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="h-8 px-2 text-xs rounded-lg border border-border bg-secondary text-foreground" />
          {state.currentFocusedWindow && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: getCategoryColor(state.currentFocusedWindow.category) }} />
              当前: {state.currentFocusedWindow.displayName}
            </div>
          )}
        </div>

        {/* Classification Profiles Table */}
        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-3">窗口分类管理</h3>
          <div className="overflow-auto max-h-48">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 px-2">名称</th>
                  <th className="text-left py-1.5 px-2">类型</th>
                  <th className="text-left py-1.5 px-2">进程</th>
                  <th className="text-left py-1.5 px-2">域名</th>
                  <th className="text-left py-1.5 px-2">分类</th>
                </tr>
              </thead>
              <tbody>
                {state.profiles.map(p => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-1.5 px-2 text-foreground">{p.displayName}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{p.objectType}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{p.processName}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{p.domain || '-'}</td>
                    <td className="py-1.5 px-2">
                      <Select value={p.category} onValueChange={(v) => updateProfile(p.id, v as Category)}>
                        <SelectTrigger className="h-6 w-20 text-[10px]" style={{ borderColor: getCategoryColor(p.category) + '44' }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(c => (
                            <SelectItem key={c} value={c}>
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(c) }} />
                                {c}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pie Chart */}
          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">扇形统计图</h3>
            {pieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(225, 15%, 15%)', border: '1px solid hsl(225, 12%, 20%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210, 20%, 90%)' }}
                      formatter={(v: number) => [`${v} 分钟`, '']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 flex-1">
                  {pieData.slice(0, 8).map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pieColors[i] }} />
                      <span className="text-foreground flex-1 truncate">{d.name}</span>
                      <span className="text-muted-foreground">{d.value}分</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">无数据</p>
            )}
          </Card>

          {/* Bar Chart */}
          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">焦点时长排行</h3>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 18%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215, 12%, 50%)' }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(210, 20%, 90%)' }} width={55} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(225, 15%, 15%)', border: '1px solid hsl(225, 12%, 20%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210, 20%, 90%)' }}
                    formatter={(v: number) => [`${v} 分钟`, '时长']} />
                  <Bar dataKey="minutes" fill="hsl(210, 80%, 55%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">无数据</p>
            )}
          </Card>

          {/* Timeline */}
          <Card className="p-4 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">时间线 (最近12小时)</h3>
            <div className="space-y-1 max-h-48 overflow-auto">
              {timelineSessions.slice(-20).map(s => (
                <div key={s.id} className="flex items-center gap-2 text-xs py-1 border-l-2 pl-2" style={{ borderColor: getCategoryColor(s.categoryAtThatTime) }}>
                  <span className="text-muted-foreground w-14 shrink-0">
                    {new Date(s.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="text-foreground flex-1 truncate">{s.displayName}</span>
                  <span className="text-muted-foreground">{Math.round(s.durationSeconds / 60)}分</span>
                </div>
              ))}
              {/* Power events markers */}
              {state.powerEvents.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs py-1 border-l-2 pl-2" style={{ borderColor: e.markerColor }}>
                  <span className="text-muted-foreground w-14 shrink-0">
                    {new Date(e.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="font-medium" style={{ color: e.markerColor }}>{e.eventType}</span>
                  <span className="text-muted-foreground">{e.detail}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Heatmap */}
          <Card className="p-4 bg-card border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">日历热力图</h3>
              <Select value={heatmapCategory} onValueChange={v => setHeatmapCategory(v as Category)}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-10 gap-1">
              {heatmapData.map(d => {
                const intensity = d.minutes / maxHeatmap;
                const color = getCategoryColor(heatmapCategory);
                return (
                  <div key={d.date} title={`${d.date}: ${d.minutes}分钟`}
                    className="aspect-square rounded-sm border border-border/30 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all"
                    style={{ backgroundColor: intensity > 0 ? `${color}${Math.round(intensity * 200 + 20).toString(16).padStart(2, '0')}` : 'hsl(225, 12%, 14%)' }}>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-2 justify-end">
              <span className="text-[10px] text-muted-foreground">少</span>
              {[0.1, 0.3, 0.5, 0.7, 1].map(i => (
                <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `${getCategoryColor(heatmapCategory)}${Math.round(i * 200 + 20).toString(16).padStart(2, '0')}` }} />
              ))}
              <span className="text-[10px] text-muted-foreground">多</span>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
