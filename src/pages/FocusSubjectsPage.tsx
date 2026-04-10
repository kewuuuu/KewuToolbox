import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FocusSubnav } from '@/components/focus/FocusSubnav';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Edit2, Trash2, ListPlus, Clock } from 'lucide-react';
import { FocusSubject, WindowGroupItem } from '@/types';

export default function FocusSubjectsPage() {
  const { state, addSubject, updateSubject, deleteSubject, addToQueue } = useAppState();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FocusSubject | null>(null);
  const [title, setTitle] = useState('');
  const [defaultMinutes, setDefaultMinutes] = useState(25);
  const [selectedWindows, setSelectedWindows] = useState<WindowGroupItem[]>([]);

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setDefaultMinutes(25);
    setSelectedWindows([]);
    setModalOpen(true);
  };

  const openEdit = (s: FocusSubject) => {
    setEditing(s);
    setTitle(s.title);
    setDefaultMinutes(s.defaultMinutes);
    setSelectedWindows([...s.windowGroup]);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    if (editing) {
      updateSubject({ ...editing, title, defaultMinutes, windowGroup: selectedWindows, updatedAt: now });
    } else {
      addSubject({ id: `sub-${Date.now()}`, title, defaultMinutes, windowGroup: selectedWindows, createdAt: now, updatedAt: now });
    }
    setModalOpen(false);
  };

  const toggleWindow = (profile: { classificationKey: string; displayName: string; objectType: 'AppWindow' | 'BrowserTab' | 'Desktop' }) => {
    setSelectedWindows(prev => {
      const exists = prev.some(w => w.classificationKey === profile.classificationKey);
      if (exists) return prev.filter(w => w.classificationKey !== profile.classificationKey);
      return [...prev, { classificationKey: profile.classificationKey, displayName: profile.displayName, objectType: profile.objectType }];
    });
  };

  const handleAddToQueue = (s: FocusSubject) => {
    addToQueue({
      id: `q-${Date.now()}`,
      itemType: 'Subject',
      title: s.title,
      durationMinutes: s.defaultMinutes,
      windowGroup: s.windowGroup,
      sourceSubjectId: s.id,
      orderIndex: state.queue.length,
    });
  };

  // Calculate today's focus time per subject
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const getSubjectFocusTime = (s: FocusSubject) => {
    const keys = new Set(s.windowGroup.map(w => w.classificationKey));
    return state.sessions
      .filter(sess => new Date(sess.startAt) >= todayStart && keys.has(sess.classificationKey))
      .reduce((acc, sess) => acc + sess.durationSeconds, 0);
  };

  const sortedProfiles = useMemo(() => {
    const statLastSeenMap = new Map(
      state.windowStats.map(stat => [
        stat.classificationKey,
        new Date(stat.lastSeenAt).getTime() || 0,
      ]),
    );
    const collator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base' });

    return [...state.profiles].sort((a, b) => {
      const lastSeenA = statLastSeenMap.get(a.classificationKey) ?? 0;
      const lastSeenB = statLastSeenMap.get(b.classificationKey) ?? 0;
      if (lastSeenA !== lastSeenB) {
        return lastSeenB - lastSeenA;
      }
      return collator.compare(a.displayName, b.displayName);
    });
  }, [state.profiles, state.windowStats]);

  return (
    <DashboardLayout pageTitle="专注事项">
      <div className="max-w-5xl mx-auto">
        <FocusSubnav />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">专注事项列表</h2>
          <Button onClick={openCreate} size="sm" className="gap-1"><Plus className="w-3.5 h-3.5" /> 新建事项</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {state.subjects.map(s => {
            const focusTime = getSubjectFocusTime(s);
            return (
              <Card key={s.id} className="p-4 bg-card border-border hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-medium text-foreground">{s.title}</h3>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleAddToQueue(s)}>
                      <ListPlus className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(s)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteSubject(s.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Clock className="w-3 h-3" />
                  <span>默认 {s.defaultMinutes} 分钟</span>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {s.windowGroup.map(w => (
                    <span key={w.classificationKey} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                      {w.displayName}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-primary">
                  今日: {Math.floor(focusTime / 60)}分{focusTime % 60}秒
                </div>
              </Card>
            );
          })}
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>{editing ? '编辑事项' : '新建事项'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">标题</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">默认时长 (分钟)</label>
                <Input type="number" value={defaultMinutes} onChange={e => setDefaultMinutes(+e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">窗口组</label>
                <div className="max-h-48 overflow-auto space-y-1 border border-border rounded-lg p-2">
                  {sortedProfiles.map(p => (
                    <label key={p.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-secondary/50 cursor-pointer">
                      <Checkbox
                        checked={selectedWindows.some(w => w.classificationKey === p.classificationKey)}
                        onCheckedChange={() => toggleWindow(p)}
                      />
                      <span className="text-sm text-foreground">{p.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">{p.objectType}</span>
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={handleSave} className="w-full">保存</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
