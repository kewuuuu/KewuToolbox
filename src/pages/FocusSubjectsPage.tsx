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

type SelectableProfile = {
  id: string;
  classificationKey: string;
  displayName: string;
  objectType: 'AppWindow' | 'BrowserTab' | 'Desktop';
};

function formatDurationSeconds(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}分 ${remain}秒`;
}

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

  const openEdit = (subject: FocusSubject) => {
    setEditing(subject);
    setTitle(subject.title);
    setDefaultMinutes(subject.defaultMinutes);
    setSelectedWindows([...subject.windowGroup]);
    setModalOpen(true);
  };

  const handleSave = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    const now = new Date().toISOString();
    const safeMinutes = Number.isFinite(defaultMinutes) ? Math.max(1, Math.floor(defaultMinutes)) : 25;

    if (editing) {
      updateSubject({
        ...editing,
        title: nextTitle,
        defaultMinutes: safeMinutes,
        windowGroup: selectedWindows,
        updatedAt: now,
      });
    } else {
      addSubject({
        id: `sub-${Date.now()}`,
        title: nextTitle,
        defaultMinutes: safeMinutes,
        windowGroup: selectedWindows,
        createdAt: now,
        updatedAt: now,
      });
    }

    setModalOpen(false);
  };

  const toggleWindow = (profile: SelectableProfile) => {
    setSelectedWindows(prev => {
      const exists = prev.some(item => item.classificationKey === profile.classificationKey);
      if (exists) {
        return prev.filter(item => item.classificationKey !== profile.classificationKey);
      }
      return [
        ...prev,
        {
          classificationKey: profile.classificationKey,
          displayName: profile.displayName,
          objectType: profile.objectType,
        },
      ];
    });
  };

  const handleAddToQueue = (subject: FocusSubject) => {
    addToQueue({
      id: `q-${Date.now()}`,
      itemType: 'Subject',
      title: subject.title,
      durationMinutes: subject.defaultMinutes,
      windowGroup: subject.windowGroup,
      sourceSubjectId: subject.id,
      orderIndex: state.queue.length,
    });
  };

  const todayStart = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const getSubjectFocusTime = (subject: FocusSubject) => {
    const keys = new Set(subject.windowGroup.map(item => item.classificationKey));
    return state.sessions
      .filter(session => new Date(session.startAt) >= todayStart && keys.has(session.classificationKey))
      .reduce((acc, session) => acc + session.durationSeconds, 0);
  };

  const sortedProfiles = useMemo(() => {
    const statLastFocusMap = new Map(
      state.windowStats.map(stat => [stat.classificationKey, new Date(stat.lastFocusAt).getTime() || 0]),
    );
    const collator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base' });

    return [...state.profiles].sort((a, b) => {
      const lastFocusA = statLastFocusMap.get(a.classificationKey) ?? 0;
      const lastFocusB = statLastFocusMap.get(b.classificationKey) ?? 0;
      if (lastFocusA !== lastFocusB) {
        return lastFocusB - lastFocusA;
      }
      return collator.compare(a.displayName, b.displayName);
    });
  }, [state.profiles, state.windowStats]);

  return (
    <DashboardLayout pageTitle="专注事项">
      <div className="max-w-5xl mx-auto px-3 sm:px-0">
        <FocusSubnav />

        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">专注事项列表</h2>
          <Button onClick={openCreate} size="sm" className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            新建事项
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.subjects.map(subject => {
            const focusTime = getSubjectFocusTime(subject);
            return (
              <Card key={subject.id} className="bg-card p-4 transition-colors hover:border-primary/30">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-medium text-foreground" title={subject.title}>
                    {subject.title}
                  </h3>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleAddToQueue(subject)}>
                      <ListPlus className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(subject)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteSubject(subject.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>默认 {subject.defaultMinutes} 分钟</span>
                </div>

                <div className="mb-2 flex flex-wrap gap-1">
                  {subject.windowGroup.map(window => (
                    <span
                      key={window.classificationKey}
                      className="max-w-full truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                      title={window.displayName}
                    >
                      {window.displayName}
                    </span>
                  ))}
                </div>

                <div className="text-xs text-primary">今日: {formatDurationSeconds(focusTime)}</div>
              </Card>
            );
          })}
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden border-border bg-card p-0">
            <div className="max-h-[85vh] overflow-y-auto p-6">
              <DialogHeader>
                <DialogTitle>{editing ? '编辑事项' : '新建事项'}</DialogTitle>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="min-w-0">
                  <label className="text-xs text-muted-foreground">标题</label>
                  <Input
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    className="mt-1 w-full min-w-0"
                    placeholder="请输入专注事项标题"
                  />
                </div>

                <div className="min-w-0">
                  <label className="text-xs text-muted-foreground">默认时长 (分钟)</label>
                  <Input
                    type="number"
                    min={1}
                    value={defaultMinutes}
                    onChange={event => setDefaultMinutes(Number(event.target.value))}
                    className="mt-1 w-full min-w-0"
                  />
                </div>

                <div className="min-w-0">
                  <label className="mb-2 block text-xs text-muted-foreground">窗口组</label>
                  <div className="max-h-56 overflow-auto rounded-lg border border-border p-2">
                    <div className="space-y-1">
                      {sortedProfiles.map(profile => (
                        <label
                          key={profile.id}
                          className="grid min-w-0 cursor-pointer grid-cols-[auto,1fr,auto] items-center gap-2 rounded p-1.5 hover:bg-secondary/50"
                        >
                          <Checkbox
                            checked={selectedWindows.some(item => item.classificationKey === profile.classificationKey)}
                            onCheckedChange={() => toggleWindow(profile)}
                          />
                          <span className="min-w-0 truncate text-sm text-foreground" title={profile.displayName}>
                            {profile.displayName}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{profile.objectType}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <Button onClick={handleSave} className="w-full">
                  保存
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
