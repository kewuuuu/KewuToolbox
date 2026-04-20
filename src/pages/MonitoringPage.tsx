import { useCallback, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { CATEGORIES, getCategoryColor } from '@/lib/categories';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Ban, ChevronDown, ChevronRight, Edit2, Plus, Trash2 } from 'lucide-react';

type ProcessRow = {
  classificationKey: string;
  profileId: string;
  displayName: string;
  objectType: string;
  processName: string;
  totalVisible: number;
  focusTime: number;
  lastFocus: string;
  longestContinuousFocus: number;
  category: string;
  tagId?: string;
};

type SortKey =
  | 'displayName'
  | 'objectType'
  | 'processName'
  | 'category'
  | 'tag'
  | 'totalVisible'
  | 'focusTime'
  | 'lastFocus'
  | 'longestContinuousFocus';

type SortDirection = 'asc' | 'desc';

type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const DESKTOP_KEY = 'desktop';
const BROWSER_DOMAIN_KEY_PREFIX = 'browser-domain|';
const BROWSER_WHITELIST_KEY_PREFIX = 'browser-whitelist|';

function parseCurrentKeyFallback(classificationKey: string) {
  if (classificationKey === DESKTOP_KEY) {
    return {
      displayName: '桌面',
      objectType: 'Desktop',
      processName: 'explorer.exe',
      category: '休息',
    };
  }

  if (classificationKey.startsWith(BROWSER_DOMAIN_KEY_PREFIX)) {
    const domain = classificationKey.slice(BROWSER_DOMAIN_KEY_PREFIX.length) || 'browser';
    return {
      displayName: domain,
      objectType: 'BrowserTab',
      processName: 'browser',
      category: '其他',
    };
  }

  if (classificationKey.startsWith(BROWSER_WHITELIST_KEY_PREFIX)) {
    const ruleId = classificationKey.slice(BROWSER_WHITELIST_KEY_PREFIX.length) || 'rule';
    return {
      displayName: `白名单规则 ${ruleId}`,
      objectType: 'BrowserTab',
      processName: 'browser',
      category: '其他',
    };
  }

  const appMatch = classificationKey.match(/^AppWindow\|([^|]+)\|(.*)$/);
  if (appMatch) {
    const processName = appMatch[1] || 'unknown';
    const title = appMatch[2] || processName;
    return {
      displayName: title,
      objectType: 'AppWindow',
      processName,
      category: '其他',
    };
  }

  return {
    displayName: classificationKey,
    objectType: 'AppWindow',
    processName: 'unknown',
    category: '其他',
  };
}

const DEFAULT_SORT_DIRECTION: Record<SortKey, SortDirection> = {
  displayName: 'asc',
  objectType: 'asc',
  processName: 'asc',
  category: 'asc',
  tag: 'asc',
  totalVisible: 'desc',
  focusTime: 'desc',
  lastFocus: 'desc',
  longestContinuousFocus: 'desc',
};

export default function MonitoringPage() {
  const {
    state,
    updateProfile,
    deleteMonitoringRecords,
    addProcessTag,
    updateProcessTag,
    deleteProcessTag,
    setProcessTagForProfile,
    updateUiState,
    updatePreferences,
  } = useAppState();

  const monitoringUi = state.uiState.monitoring;
  const activeTab = monitoringUi.activeTab;
  const historySort = monitoringUi.historySort as SortState;
  const currentSort = monitoringUi.currentSort as SortState;

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [expandedTagIds, setExpandedTagIds] = useState<Set<string>>(new Set());
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');

  const collator = useMemo(
    () => new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base' }),
    [],
  );

  const profileMap = useMemo(
    () => new Map(state.profiles.map(profile => [profile.classificationKey, profile])),
    [state.profiles],
  );
  const tagMap = useMemo(
    () => new Map(state.processTags.map(tag => [tag.id, tag])),
    [state.processTags],
  );
  const assignmentMap = useMemo(
    () => new Map(state.processTagAssignments.map(item => [item.classificationKey, item])),
    [state.processTagAssignments],
  );
  const tagStatsMap = useMemo(
    () => new Map(state.processTagStats.map(item => [item.tagId, item])),
    [state.processTagStats],
  );

  const historyRowsRaw = useMemo<ProcessRow[]>(() => {
    return state.windowStats.map(stat => {
      const profile = profileMap.get(stat.classificationKey);
      const assignment = assignmentMap.get(stat.classificationKey);
      return {
        classificationKey: stat.classificationKey,
        profileId: profile?.id ?? stat.classificationKey,
        displayName: stat.displayName,
        objectType: stat.objectType,
        processName: stat.processName,
        totalVisible: stat.totalVisibleSeconds,
        focusTime: stat.focusSeconds,
        lastFocus: stat.lastFocusAt,
        longestContinuousFocus: stat.longestContinuousFocusSeconds,
        category: profile?.category ?? stat.category,
        tagId: assignment?.tagId,
      };
    });
  }, [assignmentMap, profileMap, state.windowStats]);

  const currentRowsRaw = useMemo<ProcessRow[]>(() => {
    const statMap = new Map(
      state.windowStats.map(stat => [stat.classificationKey, stat]),
    );
    return state.currentProcessKeys.map(classificationKey => {
      const stat = statMap.get(classificationKey);
      const profile = profileMap.get(classificationKey);
      const assignment = assignmentMap.get(classificationKey);
      const fallback = parseCurrentKeyFallback(classificationKey);

      return {
        classificationKey,
        profileId: profile?.id ?? classificationKey,
        displayName: stat?.displayName ?? profile?.displayName ?? fallback.displayName,
        objectType: stat?.objectType ?? profile?.objectType ?? fallback.objectType,
        processName: stat?.processName ?? profile?.processName ?? fallback.processName,
        totalVisible: stat?.totalVisibleSeconds ?? 0,
        focusTime: stat?.focusSeconds ?? 0,
        lastFocus: stat?.lastFocusAt ?? '',
        longestContinuousFocus: stat?.longestContinuousFocusSeconds ?? 0,
        category: profile?.category ?? stat?.category ?? fallback.category,
        tagId: assignment?.tagId,
      };
    });
  }, [assignmentMap, profileMap, state.currentProcessKeys, state.windowStats]);

  const compareString = useCallback(
    (a: string, b: string) => collator.compare(a || '', b || ''),
    [collator],
  );

  const getRowTagName = useCallback(
    (row: ProcessRow) => {
      if (!row.tagId) {
        return '';
      }
      return tagMap.get(row.tagId)?.name || '';
    },
    [tagMap],
  );

  const compareRows = useCallback(
    (a: ProcessRow, b: ProcessRow, sort: SortState) => {
      let result = 0;
      switch (sort.key) {
        case 'displayName':
          result = compareString(a.displayName, b.displayName);
          break;
        case 'objectType':
          result = compareString(a.objectType, b.objectType);
          break;
        case 'processName':
          result = compareString(a.processName, b.processName);
          break;
        case 'category':
          result = compareString(a.category, b.category);
          break;
        case 'tag':
          result = compareString(getRowTagName(a), getRowTagName(b));
          break;
        case 'totalVisible':
          result = a.totalVisible - b.totalVisible;
          break;
        case 'focusTime':
          result = a.focusTime - b.focusTime;
          break;
        case 'lastFocus':
          result = new Date(a.lastFocus || 0).getTime() - new Date(b.lastFocus || 0).getTime();
          break;
        case 'longestContinuousFocus':
          result = a.longestContinuousFocus - b.longestContinuousFocus;
          break;
        default:
          result = 0;
      }

      if (result === 0) {
        result = compareString(a.displayName, b.displayName);
      }
      if (result === 0) {
        result = compareString(a.classificationKey, b.classificationKey);
      }

      return sort.direction === 'asc' ? result : -result;
    },
    [compareString, getRowTagName],
  );

  const historyRows = useMemo(
    () => [...historyRowsRaw].sort((a, b) => compareRows(a, b, historySort)),
    [compareRows, historyRowsRaw, historySort],
  );
  const currentRows = useMemo(
    () => [...currentRowsRaw].sort((a, b) => compareRows(a, b, currentSort)),
    [compareRows, currentRowsRaw, currentSort],
  );

  const historyGroups = useMemo(() => {
    const tagged = new Map<string, ProcessRow[]>();
    const untagged: ProcessRow[] = [];

    for (const row of historyRows) {
      if (!row.tagId || !tagMap.has(row.tagId)) {
        untagged.push(row);
        continue;
      }

      const list = tagged.get(row.tagId) ?? [];
      list.push(row);
      tagged.set(row.tagId, list);
    }

    const groups = [...tagged.entries()]
      .map(([tagId, rows]) => ({
        tagId,
        rows,
        tagName: tagMap.get(tagId)?.name || '',
        stat: tagStatsMap.get(tagId),
      }))
      .sort((a, b) => {
        let result = 0;
        if (historySort.key === 'totalVisible') {
          result = (a.stat?.totalVisibleSeconds || 0) - (b.stat?.totalVisibleSeconds || 0);
        } else if (historySort.key === 'focusTime') {
          result = (a.stat?.focusSeconds || 0) - (b.stat?.focusSeconds || 0);
        } else if (historySort.key === 'lastFocus') {
          result =
            new Date(a.stat?.lastFocusAt || 0).getTime() - new Date(b.stat?.lastFocusAt || 0).getTime();
        } else if (historySort.key === 'longestContinuousFocus') {
          result =
            (a.stat?.longestContinuousFocusSeconds || 0) - (b.stat?.longestContinuousFocusSeconds || 0);
        } else {
          result = compareString(a.tagName, b.tagName);
        }

        if (result === 0) {
          result = compareString(a.tagId, b.tagId);
        }
        return historySort.direction === 'asc' ? result : -result;
      });

    return { groups, untagged };
  }, [compareString, historyRows, historySort, tagMap, tagStatsMap]);

  const rowsForSelection = activeTab === 'current' ? currentRows : historyRows;
  const allSelected = rowsForSelection.length > 0 && selectedKeys.size === rowsForSelection.length;
  const partialSelected = selectedKeys.size > 0 && !allSelected;

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const toggleRow = (classificationKey: string, checked: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(classificationKey);
      } else {
        next.delete(classificationKey);
      }
      return next;
    });
  };

  const toggleAllInverse = () => {
    setSelectedKeys(prev => {
      const inverted = new Set<string>();
      for (const row of rowsForSelection) {
        if (!prev.has(row.classificationKey)) {
          inverted.add(row.classificationKey);
        }
      }
      return inverted;
    });
  };

  const handleDeleteAction = () => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedKeys(new Set());
      return;
    }

    const keys = [...selectedKeys];
    if (keys.length > 0) {
      deleteMonitoringRecords(keys);
      toast.success(`已删除 ${keys.length} 条记录`);
    }

    setSelectionMode(false);
    setSelectedKeys(new Set());
  };

  const handleSort = (scope: 'history' | 'current', key: SortKey) => {
    const sourceSort = scope === 'history' ? historySort : currentSort;
    const nextSort: SortState =
      sourceSort.key === key
        ? {
            key,
            direction: sourceSort.direction === 'asc' ? 'desc' : 'asc',
          }
        : {
            key,
            direction: DEFAULT_SORT_DIRECTION[key],
          };
    updateUiState({
      monitoring: {
        ...monitoringUi,
        [scope === 'history' ? 'historySort' : 'currentSort']: nextSort,
      },
    });
  };

  const getSortArrow = (scope: 'history' | 'current', key: SortKey) => {
    const sort = scope === 'history' ? historySort : currentSort;
    if (sort.key !== key) {
      return '';
    }
    return sort.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const handleBlockProcess = useCallback(
    (row: ProcessRow) => {
      const processPattern = row.processName?.trim();
      if (!processPattern) {
        toast.error('当前进程名为空，无法屏蔽');
        return;
      }

      const typePattern = row.objectType?.trim() || 'AppWindow';
      const existed = state.preferences.processBlacklist.some(rule => {
        const ruleProcess = (rule.processPattern || '').trim().toLowerCase();
        const ruleType = (rule.typePattern || '').trim().toLowerCase();
        return ruleProcess === processPattern.toLowerCase() && ruleType === typePattern.toLowerCase();
      });
      if (existed) {
        toast.info('该进程已在黑名单中');
        return;
      }

      const now = new Date().toISOString();
      updatePreferences({
        processBlacklist: [
          {
            id: `bl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            typePattern,
            processPattern,
            createdAt: now,
            updatedAt: now,
          },
          ...state.preferences.processBlacklist,
        ],
      });
      toast.success(`已屏蔽 ${processPattern}`);
    },
    [state.preferences.processBlacklist, updatePreferences],
  );

  const renderSortHeader = (
    scope: 'history' | 'current',
    key: SortKey,
    label: string,
    className: string,
  ) => (
    <th className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => handleSort(scope, key)}
      >
        <span>{label}</span>
        <span>{getSortArrow(scope, key)}</span>
      </button>
    </th>
  );

  const renderProcessRows = (rows: ProcessRow[], withTagColumn: boolean) =>
    rows.map(row => {
      const checked = selectedKeys.has(row.classificationKey);
      const tagValue = row.tagId && tagMap.has(row.tagId) ? row.tagId : '__none__';
      return (
        <tr key={row.classificationKey} className="border-b border-border/50 hover:bg-secondary/30">
          {selectionMode && (
            <td className="py-1.5 px-2">
              <Checkbox
                checked={checked}
                onCheckedChange={value => toggleRow(row.classificationKey, Boolean(value))}
              />
            </td>
          )}
          <td className="py-1.5 px-2 text-foreground">{row.displayName}</td>
          <td className="py-1.5 px-2 text-muted-foreground">{row.objectType}</td>
          <td className="py-1.5 px-2 text-muted-foreground">{row.processName}</td>
          <td className="py-1.5 px-2">
            <Select value={row.category} onValueChange={value => updateProfile(row.profileId, value)}>
              <SelectTrigger className="h-7 w-24 text-[11px]" style={{ borderColor: `${getCategoryColor(row.category)}55` }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(category => (
                  <SelectItem key={category} value={category}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(category) }} />
                      <span>{category}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </td>
          {withTagColumn && (
            <td className="py-1.5 px-2">
              <Select value={tagValue} onValueChange={value => setProcessTagForProfile(row.classificationKey, value === '__none__' ? undefined : value)}>
                <SelectTrigger className="h-7 w-36 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分配</SelectItem>
                  {state.processTags.map(tag => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </td>
          )}
          <td className="py-1.5 px-2 text-right text-muted-foreground">{formatDuration(row.totalVisible)}</td>
          <td className="py-1.5 px-2 text-right text-primary">{formatDuration(row.focusTime)}</td>
          <td className="py-1.5 px-2 text-right text-muted-foreground">
            {formatDuration(row.longestContinuousFocus)}
          </td>
          <td className="py-1.5 px-2 text-right text-muted-foreground">
            {row.lastFocus ? new Date(row.lastFocus).toLocaleString('zh-CN') : '-'}
          </td>
          <td className="py-1.5 px-2 text-right">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => handleBlockProcess(row)}
              title="屏蔽"
            >
              <Ban className="w-3.5 h-3.5" />
            </Button>
          </td>
        </tr>
      );
    });

  const renderHistoryGroupedRows = () => {
    const blocks: JSX.Element[] = [];

    for (const group of historyGroups.groups) {
      const expanded = expandedTagIds.has(group.tagId);
      blocks.push(
        <tr key={`tag-${group.tagId}`} className="border-b border-border bg-secondary/40">
          {selectionMode && <td className="py-2 px-2" />}
          <td className="py-2 px-2 text-foreground font-medium" colSpan={3}>
            <button
              className="inline-flex items-center gap-1.5"
              onClick={() => {
                setExpandedTagIds(prev => {
                  const next = new Set(prev);
                  if (next.has(group.tagId)) {
                    next.delete(group.tagId);
                  } else {
                    next.add(group.tagId);
                  }
                  return next;
                });
              }}
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span>{group.tagName}</span>
              <span className="text-[10px] text-muted-foreground">({group.rows.length})</span>
            </button>
          </td>
          <td className="py-2 px-2 text-muted-foreground">标签</td>
          <td className="py-2 px-2 text-right text-muted-foreground">
            {formatDuration(group.stat?.totalVisibleSeconds ?? 0)}
          </td>
          <td className="py-2 px-2 text-right text-primary">
            {formatDuration(group.stat?.focusSeconds ?? 0)}
          </td>
          <td className="py-2 px-2 text-right text-muted-foreground">
            {formatDuration(group.stat?.longestContinuousFocusSeconds ?? 0)}
          </td>
          <td className="py-2 px-2 text-right text-muted-foreground">
            {group.stat?.lastFocusAt ? new Date(group.stat.lastFocusAt).toLocaleString('zh-CN') : '-'}
          </td>
          <td className="py-2 px-2" />
        </tr>,
      );

      if (expanded) {
        blocks.push(...renderProcessRows(group.rows, false));
      }
    }

    if (historyGroups.untagged.length > 0) {
      blocks.push(...renderProcessRows(historyGroups.untagged, false));
    }

    return blocks;
  };

  const confirmCreateTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setCreatingTag(false);
      setNewTagName('');
      return;
    }
    addProcessTag(trimmed);
    setCreatingTag(false);
    setNewTagName('');
  };

  const confirmEditTag = () => {
    if (!editingTagId) {
      return;
    }
    const trimmed = editingTagName.trim();
    if (!trimmed) {
      setEditingTagId(null);
      setEditingTagName('');
      return;
    }
    updateProcessTag(editingTagId, trimmed);
    setEditingTagId(null);
    setEditingTagName('');
  };

  return (
    <DashboardLayout pageTitle="进程管理">
      <div className="max-w-6xl mx-auto">
        <Tabs
          value={activeTab}
          onValueChange={nextTab => {
            const normalizedTab =
              nextTab === 'history' ||
              nextTab === 'current' ||
              nextTab === 'tags' ||
              nextTab === 'events' ||
              nextTab === 'debug'
                ? nextTab
                : monitoringUi.activeTab;
            updateUiState({
              monitoring: {
                ...monitoringUi,
                activeTab: normalizedTab,
              },
            });
          }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <TabsList className="bg-secondary">
              <TabsTrigger value="history">历史记录</TabsTrigger>
              <TabsTrigger value="current">当前进程</TabsTrigger>
              <TabsTrigger value="tags">标签管理</TabsTrigger>
              <TabsTrigger value="events">系统事件</TabsTrigger>
              <TabsTrigger value="debug">识别调试</TabsTrigger>
            </TabsList>
            {(activeTab === 'history' || activeTab === 'current') && (
              <Button size="sm" variant={selectionMode ? 'destructive' : 'outline'} onClick={handleDeleteAction}>
                {selectionMode ? '确认删除' : '删除记录'}
              </Button>
            )}
          </div>

          <TabsContent value="history">
            <Card className="p-4 bg-card border-border overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {selectionMode && (
                      <th className="text-left py-2 px-2 w-10">
                        <Checkbox
                          checked={allSelected ? true : partialSelected ? 'indeterminate' : false}
                          onCheckedChange={() => toggleAllInverse()}
                        />
                      </th>
                    )}
                    {renderSortHeader('history', 'displayName', '名称', 'text-left py-2 px-2')}
                    {renderSortHeader('history', 'objectType', '类型', 'text-left py-2 px-2')}
                    {renderSortHeader('history', 'processName', '进程', 'text-left py-2 px-2')}
                    {renderSortHeader('history', 'category', '分类', 'text-left py-2 px-2')}
                    {renderSortHeader('history', 'totalVisible', '总可见时长', 'text-right py-2 px-2')}
                    {renderSortHeader('history', 'focusTime', '焦点时长', 'text-right py-2 px-2')}
                    {renderSortHeader('history', 'longestContinuousFocus', '最长焦点连续时长', 'text-right py-2 px-2')}
                    {renderSortHeader('history', 'lastFocus', '最后焦点时间', 'text-right py-2 px-2')}
                    <th className="text-right py-2 px-2">屏蔽</th>
                  </tr>
                </thead>
                <tbody>{renderHistoryGroupedRows()}</tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="current">
            <Card className="p-4 bg-card border-border overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {selectionMode && (
                      <th className="text-left py-2 px-2 w-10">
                        <Checkbox
                          checked={allSelected ? true : partialSelected ? 'indeterminate' : false}
                          onCheckedChange={() => toggleAllInverse()}
                        />
                      </th>
                    )}
                    {renderSortHeader('current', 'displayName', '名称', 'text-left py-2 px-2')}
                    {renderSortHeader('current', 'objectType', '类型', 'text-left py-2 px-2')}
                    {renderSortHeader('current', 'processName', '进程', 'text-left py-2 px-2')}
                    {renderSortHeader('current', 'category', '分类', 'text-left py-2 px-2')}
                    {renderSortHeader('current', 'tag', '标签', 'text-left py-2 px-2')}
                    {renderSortHeader('current', 'totalVisible', '总可见时长', 'text-right py-2 px-2')}
                    {renderSortHeader('current', 'focusTime', '焦点时长', 'text-right py-2 px-2')}
                    {renderSortHeader('current', 'longestContinuousFocus', '最长焦点连续时长', 'text-right py-2 px-2')}
                    {renderSortHeader('current', 'lastFocus', '最后焦点时间', 'text-right py-2 px-2')}
                    <th className="text-right py-2 px-2">屏蔽</th>
                  </tr>
                </thead>
                <tbody>{renderProcessRows(currentRows, true)}</tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="tags">
            <Card className="p-4 bg-card border-border space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">标签管理</h3>
                {!creatingTag && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setCreatingTag(true);
                      setNewTagName('');
                    }}
                    className="gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新增标签
                  </Button>
                )}
              </div>

              {creatingTag && (
                <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/20">
                  <Input
                    value={newTagName}
                    onChange={event => setNewTagName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        confirmCreateTag();
                      }
                      if (event.key === 'Escape') {
                        setCreatingTag(false);
                        setNewTagName('');
                      }
                    }}
                    placeholder="输入标签名，回车确认"
                    autoFocus
                  />
                  <Button size="sm" onClick={confirmCreateTag}>确认</Button>
                </div>
              )}

              <div className="space-y-2">
                {state.processTags.map(tag => {
                  const inEdit = editingTagId === tag.id;
                  return (
                    <div key={tag.id} className="flex items-center gap-2 p-2 rounded-lg border border-border">
                      {inEdit ? (
                        <Input
                          value={editingTagName}
                          onChange={event => setEditingTagName(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              confirmEditTag();
                            }
                            if (event.key === 'Escape') {
                              setEditingTagId(null);
                              setEditingTagName('');
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="text-sm text-foreground flex-1">{tag.name}</span>
                      )}
                      {inEdit ? (
                        <Button size="sm" onClick={confirmEditTag}>确认</Button>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => {
                          setEditingTagId(tag.id);
                          setEditingTagName(tag.name);
                        }}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteProcessTag(tag.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
                {state.processTags.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">暂无标签</p>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card className="p-4 bg-card border-border">
              <div className="space-y-1.5">
                {[...state.powerEvents]
                  .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
                  .map(event => (
                    <div key={event.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/30 border border-border/50">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: event.markerColor }} />
                      <span className="text-xs font-medium text-foreground w-12">{event.eventType}</span>
                      <span className="text-xs text-muted-foreground flex-1">{event.detail}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.occurredAt).toLocaleString('zh-CN')}
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
                {state.currentFocusedWindow ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">显示名称</span><span className="text-foreground">{state.currentFocusedWindow.displayName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">分类键</span><span className="text-foreground">{state.currentFocusedWindow.classificationKey}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">对象类型</span><span className="text-foreground">{state.currentFocusedWindow.objectType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">进程名</span><span className="text-foreground">{state.currentFocusedWindow.processName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">域名</span><span className="text-foreground">{state.currentFocusedWindow.domain || '-'}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">分类</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${getCategoryColor(state.currentFocusedWindow.category)}22`, color: getCategoryColor(state.currentFocusedWindow.category) }}>
                        {state.currentFocusedWindow.category}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">当前未识别到焦点窗口（浏览器未上报域名时会被忽略）。</p>
                )}
              </Card>

              <Card className="p-4 bg-card border-border">
                <h3 className="text-sm font-semibold text-foreground mb-3">识别调试</h3>
                <div className="space-y-3 text-xs">
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">浏览器域名识别</p>
                    <p className="text-foreground">
                      {state.currentFocusedWindow?.objectType === 'BrowserTab'
                        ? `已使用域名识别：${state.currentFocusedWindow.domain || state.currentFocusedWindow.normalizedTitle}`
                        : '当前不是浏览器标签页'}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">当前打开进程数</p>
                    <p className="text-foreground">{state.currentProcessKeys.length}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                    <p className="text-muted-foreground mb-1">焦点原始信息</p>
                    <pre className="text-[10px] text-muted-foreground overflow-auto">
                      {JSON.stringify(state.currentFocusedWindow, null, 2)}
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
