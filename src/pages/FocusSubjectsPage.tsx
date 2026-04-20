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
import { matchesWindowGroupItem } from '@/lib/windowGroupMatcher';

type SelectableProfile = {
  id: string;
  classificationKey: string;
  displayName: string;
  objectType: 'AppWindow' | 'BrowserTab' | 'Desktop';
  processName: string;
};

function toCanonicalObjectType(input: string) {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'appwindow') {
    return 'AppWindow';
  }
  if (normalized === 'browsertab') {
    return 'BrowserTab';
  }
  if (normalized === 'desktop') {
    return 'Desktop';
  }
  return undefined;
}

function isBrowserTabType(input: string) {
  return input.trim().toLowerCase() === 'browsertab';
}

function hasPatternMatcher(item: WindowGroupItem) {
  return Boolean(item.matchMode === 'pattern' || item.namePattern || item.typePattern || item.processPattern);
}

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
  const [manualNamePattern, setManualNamePattern] = useState('');
  const [manualTypePattern, setManualTypePattern] = useState('');
  const [manualProcessPattern, setManualProcessPattern] = useState('');

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setDefaultMinutes(25);
    setSelectedWindows([]);
    setManualNamePattern('');
    setManualTypePattern('');
    setManualProcessPattern('');
    setModalOpen(true);
  };

  const openEdit = (subject: FocusSubject) => {
    setEditing(subject);
    setTitle(subject.title);
    setDefaultMinutes(subject.defaultMinutes);
    setSelectedWindows([...subject.windowGroup]);
    setManualNamePattern('');
    setManualTypePattern('');
    setManualProcessPattern('');
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
          processName: profile.processName,
          matchMode: 'exact',
        },
      ];
    });
  };

  const removeWindowGroupItem = (classificationKey: string) => {
    setSelectedWindows(prev => prev.filter(item => item.classificationKey !== classificationKey));
  };

  const addManualRule = () => {
    const namePattern = manualNamePattern.trim();
    const typePattern = manualTypePattern.trim();
    const browserTabType = isBrowserTabType(typePattern);
    const processPattern = browserTabType ? '' : manualProcessPattern.trim();
    const canonicalType = toCanonicalObjectType(typePattern);
    const displayName = `规则: 名称 ${namePattern || '*'} / 类型 ${typePattern || '*'} / 进程 ${
      browserTabType ? '(忽略)' : processPattern || '*'
    }`;

    setSelectedWindows(prev => [
      ...prev,
      {
        classificationKey: `subject-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        displayName,
        objectType: canonicalType,
        matchMode: 'pattern',
        namePattern: namePattern || undefined,
        typePattern: typePattern || undefined,
        processPattern: processPattern || undefined,
      },
    ]);

    setManualNamePattern('');
    setManualTypePattern('');
    setManualProcessPattern('');
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
    return state.sessions
      .filter(
        session =>
          new Date(session.startAt) >= todayStart &&
          subject.windowGroup.some(item =>
            matchesWindowGroupItem(item, {
              classificationKey: session.classificationKey,
              displayName: session.displayName,
              objectType: session.objectType,
              processName: session.processName,
              normalizedTitle: session.windowTitle || session.browserTabTitle || session.displayName,
              domain: session.domain,
            }),
          ),
      )
      .reduce((acc, session) => acc + session.durationSeconds, 0);
  };

  const sortedProfiles = useMemo(() => {
    const statLastFocusMap = new Map(
      state.windowStats.map(stat => [stat.classificationKey, new Date(stat.lastFocusAt).getTime() || 0]),
    );
    const currentKeySet = new Set(state.currentProcessKeys);
    const collator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base' });

    return state.profiles
      .filter(profile => currentKeySet.has(profile.classificationKey))
      .sort((a, b) => {
      const lastFocusA = statLastFocusMap.get(a.classificationKey) ?? 0;
      const lastFocusB = statLastFocusMap.get(b.classificationKey) ?? 0;
      if (lastFocusA !== lastFocusB) {
        return lastFocusB - lastFocusA;
      }
      return collator.compare(a.displayName, b.displayName);
    });
  }, [state.currentProcessKeys, state.profiles, state.windowStats]);

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

                <div className="min-w-0 space-y-2">
                  <label className="block text-xs text-muted-foreground">已添加的进程/规则</label>
                  <div className="max-h-52 overflow-auto rounded-lg border border-border p-2">
                    {selectedWindows.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">暂无已添加项</p>
                    ) : (
                      <div className="space-y-1.5">
                        {selectedWindows.map(item => {
                          const patternMode = hasPatternMatcher(item);
                          const browserTabRule = isBrowserTabType(item.typePattern || '');
                          const nameText = patternMode ? item.namePattern?.trim() || '任意' : item.displayName;
                          const typeText = patternMode
                            ? item.typePattern?.trim() || '任意'
                            : item.objectType || '任意';
                          const processText = patternMode
                            ? browserTabRule
                              ? '(已忽略)'
                              : item.processPattern?.trim() || '任意'
                            : item.processName || '—';
                          return (
                            <div
                              key={item.classificationKey}
                              className="grid min-w-0 grid-cols-[1fr,auto] items-center gap-2 rounded border border-border/60 px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-xs text-foreground" title={item.displayName}>
                                  {item.displayName}
                                </p>
                                <p className="truncate text-[10px] text-muted-foreground">
                                  名称: {nameText} | 类型: {typeText} | 进程: {processText}
                                </p>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive"
                                onClick={() => removeWindowGroupItem(item.classificationKey)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  <label className="block text-xs text-muted-foreground">手动添加规则</label>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.2fr_0.8fr_1fr_auto]">
                    <Input
                      value={manualNamePattern}
                      onChange={event => setManualNamePattern(event.target.value)}
                      placeholder={
                        isBrowserTabType(manualTypePattern)
                          ? '名称/网址通配，如 https://*.bilibili.com/*'
                          : '名称通配，如 *Visual Studio Code*'
                      }
                      className="h-8"
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          addManualRule();
                        }
                      }}
                    />
                    <Input
                      value={manualTypePattern}
                      onChange={event => setManualTypePattern(event.target.value)}
                      placeholder="类型通配，如 BrowserTab"
                      className="h-8"
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          addManualRule();
                        }
                      }}
                    />
                    <Input
                      value={manualProcessPattern}
                      onChange={event => setManualProcessPattern(event.target.value)}
                      placeholder={isBrowserTabType(manualTypePattern) ? 'BrowserTab 类型下将忽略' : '进程通配，如 code.exe'}
                      className="h-8"
                      disabled={isBrowserTabType(manualTypePattern)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          addManualRule();
                        }
                      }}
                    />
                    <Button type="button" size="sm" onClick={addManualRule}>
                      添加
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    规则为空字段表示“匹配全部”。当类型填写 BrowserTab 时，名称按网址通配匹配，进程字段自动忽略。
                  </p>
                </div>

                <div className="min-w-0">
                  <label className="mb-2 block text-xs text-muted-foreground">从当前打开窗口快速添加</label>
                  <div className="max-h-56 overflow-auto rounded-lg border border-border p-2">
                    <div className="space-y-1">
                      {sortedProfiles.map(profile => (
                        <label
                          key={profile.id}
                          className="grid min-w-0 cursor-pointer grid-cols-[auto,1fr,auto] items-center gap-2 rounded p-1.5 hover:bg-secondary/50"
                        >
                          <Checkbox
                            checked={selectedWindows.some(
                              item =>
                                !hasPatternMatcher(item) &&
                                item.classificationKey === profile.classificationKey,
                            )}
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
