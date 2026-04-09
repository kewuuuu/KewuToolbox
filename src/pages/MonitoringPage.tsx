import { useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function MonitoringPage() {
  const { state } = useAppState();

  // All windows with aggregated stats
  const windowStats = useMemo(() => {
    const map = new Map<string, { displayName: string; objectType: string; processName: string; totalVisible: number; focusTime: number; lastSeen: string }>();
    state.sessions.forEach(s => {
      const existing = map.get(s.classificationKey);
      if (existing) {
        existing.totalVisible += s.durationSeconds;
        existing.focusTime += s.durationSeconds;
        if (s.endAt > existing.lastSeen) existing.lastSeen = s.endAt;
      } else {
        map.set(s.classificationKey, {
          displayName: s.displayName,
          objectType: s.objectType,
          processName: s.processName,
          totalVisible: s.durationSeconds,
          focusTime: s.durationSeconds,
          lastSeen: s.endAt,
        });
      }
    });
    return Array.from(map.values());
  }, [state.sessions]);

  const focusRanking = [...windowStats].sort((a, b) => b.focusTime - a.focusTime);

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}时${m}分` : `${m}分`;
  };

  const fw = state.currentFocusedWindow;

  return (
    <DashboardLayout pageTitle="原始监控">
      <div className="max-w-6xl mx-auto">
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="all">全部窗口</TabsTrigger>
            <TabsTrigger value="ranking">焦点排行</TabsTrigger>
            <TabsTrigger value="events">系统事件</TabsTrigger>
            <TabsTrigger value="debug">识别调试</TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <Card className="p-4 bg-card border-border overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">名称</th>
                    <th className="text-left py-2 px-2">类型</th>
                    <th className="text-left py-2 px-2">进程</th>
                    <th className="text-right py-2 px-2">总可见时长</th>
                    <th className="text-right py-2 px-2">焦点时长</th>
                    <th className="text-right py-2 px-2">最后出现</th>
                  </tr>
                </thead>
                <tbody>
                  {windowStats.map((w, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-1.5 px-2 text-foreground">{w.displayName}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{w.objectType}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{w.processName}</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{formatDuration(w.totalVisible)}</td>
                      <td className="py-1.5 px-2 text-right text-primary">{formatDuration(w.focusTime)}</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground">{new Date(w.lastSeen).toLocaleTimeString('zh-CN', { hour12: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="ranking">
            <Card className="p-4 bg-card border-border overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">窗口</th>
                    <th className="text-left py-2 px-2">类型</th>
                    <th className="text-right py-2 px-2">焦点时长</th>
                    <th className="text-left py-2 px-2">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {focusRanking.map((w, i) => {
                    const totalFocus = focusRanking.reduce((a, b) => a + b.focusTime, 0);
                    const pct = totalFocus > 0 ? (w.focusTime / totalFocus * 100) : 0;
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-secondary/30">
                        <td className="py-1.5 px-2 text-primary font-medium">{i + 1}</td>
                        <td className="py-1.5 px-2 text-foreground">{w.displayName}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{w.objectType}</td>
                        <td className="py-1.5 px-2 text-right text-foreground">{formatDuration(w.focusTime)}</td>
                        <td className="py-1.5 px-2 w-32">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card className="p-4 bg-card border-border">
              <div className="space-y-1.5">
                {[...state.powerEvents]
                  .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
                  .map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.markerColor }} />
                    <span className="text-xs font-medium text-foreground w-12">{e.eventType}</span>
                    <span className="text-xs text-muted-foreground flex-1">{e.detail}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="debug">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4 bg-card border-border">
                <h3 className="text-sm font-semibold text-foreground mb-3">当前焦点对象</h3>
                {fw ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">显示名称</span><span className="text-foreground">{fw.displayName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">分类键</span><span className="text-foreground">{fw.classificationKey}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">对象类型</span><span className="text-foreground">{fw.objectType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">进程名</span><span className="text-foreground">{fw.processName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">域名</span><span className="text-foreground">{fw.domain || '-'}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">分类</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: getCategoryColor(fw.category) + '22', color: getCategoryColor(fw.category) }}>
                        {fw.category}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">无焦点窗口</p>
                )}
              </Card>

              <Card className="p-4 bg-card border-border">
                <h3 className="text-sm font-semibold text-foreground mb-3">识别模拟</h3>
                <div className="space-y-3 text-xs">
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">浏览器标签识别</p>
                    <p className="text-foreground">
                      {fw?.objectType === 'BrowserTab' ? `✅ 检测到 ${fw.browserName} 标签: ${fw.normalizedTitle}` : '⬜ 当前非浏览器标签'}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">桌面识别</p>
                    <p className="text-foreground">
                      {fw?.objectType === 'Desktop' ? '✅ 当前为桌面' : '⬜ 当前非桌面'}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">原始窗口信息</p>
                    <pre className="text-[10px] text-muted-foreground overflow-auto">
                      {JSON.stringify(fw, null, 2)}
                    </pre>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
