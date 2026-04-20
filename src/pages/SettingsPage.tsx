import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { ProcessBlacklistRule, SoundBalanceCache, UrlWhitelistRule } from '@/types';
import {
  analyzeSoundFileLoudness,
  calculateBalancedGainFromAnalysis,
  getSoundDisplayNameFromPath,
  playSoundById,
  resolveSoundPlaybackForEvent,
  SoundEventType,
} from '@/lib/sound';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { FolderOpen, MoonStar, Play, Plus, Sun, Trash2 } from 'lucide-react';

type SettingsTab = 'general' | 'sounds';
const NONE_SOUND_ID = '__none__';
type SoundEventConfig = {
  eventType: SoundEventType;
  label: string;
  soundIdKey: 'completionSoundFileId' | 'distractionSoundFileId' | 'countdownSoundFileId';
  volumeModeKey: 'completionVolumeMode' | 'distractionVolumeMode' | 'countdownVolumeMode';
  manualMultiplierKey:
    | 'completionVolumeMultiplier'
    | 'distractionVolumeMultiplier'
    | 'countdownVolumeMultiplier';
  targetDbKey: 'completionBalancedTargetDb' | 'distractionBalancedTargetDb' | 'countdownBalancedTargetDb';
  cacheKey: 'completionBalanceCache' | 'distractionBalanceCache' | 'countdownBalanceCache';
};

const SOUND_EVENT_CONFIGS: SoundEventConfig[] = [
  {
    eventType: 'completion',
    label: '番茄钟到点',
    soundIdKey: 'completionSoundFileId',
    volumeModeKey: 'completionVolumeMode',
    manualMultiplierKey: 'completionVolumeMultiplier',
    targetDbKey: 'completionBalancedTargetDb',
    cacheKey: 'completionBalanceCache',
  },
  {
    eventType: 'distraction',
    label: '偏离提醒',
    soundIdKey: 'distractionSoundFileId',
    volumeModeKey: 'distractionVolumeMode',
    manualMultiplierKey: 'distractionVolumeMultiplier',
    targetDbKey: 'distractionBalancedTargetDb',
    cacheKey: 'distractionBalanceCache',
  },
  {
    eventType: 'countdown',
    label: '倒计时到点',
    soundIdKey: 'countdownSoundFileId',
    volumeModeKey: 'countdownVolumeMode',
    manualMultiplierKey: 'countdownVolumeMultiplier',
    targetDbKey: 'countdownBalancedTargetDb',
    cacheKey: 'countdownBalanceCache',
  },
];

function toFinite(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function toPositiveFinite(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function makeRuleId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SettingsPage() {
  const { state, updatePreferences, updateSettings, clearAllData, addSoundFile, updateSoundFile, deleteSoundFile } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manualPath, setManualPath] = useState('');
  const [manualName, setManualName] = useState('');
  const [urlNameInput, setUrlNameInput] = useState('');
  const [urlPatternInput, setUrlPatternInput] = useState('');
  const [blacklistNameInput, setBlacklistNameInput] = useState('');
  const [blacklistTypeInput, setBlacklistTypeInput] = useState('');
  const [blacklistProcessInput, setBlacklistProcessInput] = useState('');
  const [dataFilePathInput, setDataFilePathInput] = useState('');
  const [pendingCreatePath, setPendingCreatePath] = useState('');
  const [isChangingDataPath, setIsChangingDataPath] = useState(false);
  const [isClearingAllData, setIsClearingAllData] = useState(false);
  const [applyingBalanceEventType, setApplyingBalanceEventType] = useState<SoundEventType | null>(null);
  const [thresholdInput, setThresholdInput] = useState(
    String(state.preferences.recordWindowThresholdSeconds),
  );
  const browserFilePickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setThresholdInput(String(state.preferences.recordWindowThresholdSeconds));
  }, [state.preferences.recordWindowThresholdSeconds]);

  useEffect(() => {
    if (!window.desktopApi?.isElectron) {
      return;
    }

    let disposed = false;
    const loadPath = async () => {
      try {
        const currentPath = await window.desktopApi!.getDataFilePath();
        if (disposed) {
          return;
        }
        setDataFilePathInput(currentPath);
      } catch {
        if (!disposed) {
          toast.error('读取数据文件路径失败');
        }
      }
    };

    void loadPath();
    return () => {
      disposed = true;
    };
  }, []);

  const tabParam = searchParams.get('tab');
  const tab: SettingsTab = tabParam === 'sounds' ? 'sounds' : 'general';

  const sortedSoundFiles = useMemo(
    () =>
      [...state.soundFiles].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [state.soundFiles],
  );
  const isElectronRuntime = Boolean(window.desktopApi?.isElectron);

  const handleTabChange = (nextTab: string) => {
    const normalized: SettingsTab = nextTab === 'sounds' ? 'sounds' : 'general';
    if (normalized === 'general') {
      setSearchParams({});
      return;
    }
    setSearchParams({ tab: normalized });
  };

  const commitThresholdInput = (rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setThresholdInput(String(state.preferences.recordWindowThresholdSeconds));
      toast.error('记录阈值必须是数字');
      return;
    }

    const normalized = Math.max(0, Math.floor(parsed));
    updatePreferences({ recordWindowThresholdSeconds: normalized });
    setThresholdInput(String(normalized));
  };

  const handleThresholdKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitThresholdInput(thresholdInput);
    }
  };

  const getEventSoundId = (config: SoundEventConfig) => state.pomodoroSettings[config.soundIdKey] ?? '';
  const getEventVolumeMode = (config: SoundEventConfig) => state.pomodoroSettings[config.volumeModeKey];
  const getEventManualMultiplier = (config: SoundEventConfig) =>
    state.pomodoroSettings[config.manualMultiplierKey];
  const getEventTargetDb = (config: SoundEventConfig) => state.pomodoroSettings[config.targetDbKey];
  const getEventCache = (config: SoundEventConfig) => state.pomodoroSettings[config.cacheKey];

  const updateEventManualMultiplier = (config: SoundEventConfig, rawValue: string) => {
    updateSettings({
      [config.manualMultiplierKey]: toPositiveFinite(rawValue, getEventManualMultiplier(config)),
      [config.cacheKey]: undefined,
    });
  };

  const updateEventTargetDb = (config: SoundEventConfig, rawValue: string) => {
    updateSettings({
      [config.targetDbKey]: toFinite(rawValue, getEventTargetDb(config)),
      [config.cacheKey]: undefined,
    });
  };

  const updateEventVolumeMode = (config: SoundEventConfig, value: 'unbalanced' | 'balanced') => {
    updateSettings({
      [config.volumeModeKey]: value,
    });
  };

  const handleApplyBalance = async (config: SoundEventConfig) => {
    const soundFileId = getEventSoundId(config);
    if (!soundFileId) {
      toast.error('请先选择提示音文件');
      return;
    }
    const soundFile = state.soundFiles.find(item => item.id === soundFileId);
    if (!soundFile) {
      toast.error('未找到提示音文件');
      return;
    }

    const targetDb = getEventTargetDb(config);
    setApplyingBalanceEventType(config.eventType);
    try {
      const analysis = await analyzeSoundFileLoudness(soundFile.filePath);
      const normalizedGain = calculateBalancedGainFromAnalysis(analysis, targetDb);
      const nextCache: SoundBalanceCache = {
        soundFileId: soundFile.id,
        soundFileUpdatedAt: soundFile.updatedAt,
        targetDb,
        measuredAverageDb: analysis.measuredAverageDb,
        measuredPeakDb: analysis.measuredPeakDb,
        normalizedGain,
        generatedAt: new Date().toISOString(),
      };
      updateSettings({
        [config.cacheKey]: nextCache,
      });
      toast.success(`${config.label} 已应用音量平衡`);
    } catch {
      toast.error('应用音量平衡失败，请检查音频路径是否可读');
    } finally {
      setApplyingBalanceEventType(null);
    }
  };

  const handleClearAllData = async () => {
    if (isClearingAllData) {
      return;
    }

    setIsClearingAllData(true);
    try {
      await clearAllData();
      toast.success('已清除所有数据');
    } catch {
      toast.error('清除失败，请重试');
    } finally {
      setIsClearingAllData(false);
    }
  };

  const handleAutoLaunchChange = (checked: boolean) => {
    if (!isElectronRuntime) {
      toast.info('当前环境不支持开机自启动');
      return;
    }
    updatePreferences({ autoLaunchEnabled: checked });
    toast.success(checked ? '已开启开机自启动' : '已关闭开机自启动');
  };

  const handleHideToTrayNow = async () => {
    if (!window.desktopApi?.isElectron || !window.desktopApi.hideToTray) {
      toast.info('Tray operation is not supported in current environment');
      return;
    }

    try {
      const result = await window.desktopApi.hideToTray();
      if (result?.ok) {
        return;
      }
      toast.error('Failed to hide window to tray');
    } catch {
      toast.error('Failed to hide window to tray');
    }
  };

  const handlePickDataFilePath = async () => {
    if (!window.desktopApi?.isElectron) {
      toast.info('当前环境不支持选择数据文件路径');
      return;
    }
    const pickedPath = await window.desktopApi.selectDataFilePath();
    if (!pickedPath) {
      return;
    }
    setDataFilePathInput(pickedPath);
  };

  const commitDataFilePath = async (createIfMissing: boolean) => {
    const targetPath = dataFilePathInput.trim();
    if (!targetPath) {
      toast.error('请输入数据文件路径');
      return;
    }
    if (!window.desktopApi?.isElectron) {
      toast.info('当前环境不支持修改数据文件路径');
      return;
    }
    if (isChangingDataPath) {
      return;
    }

    setIsChangingDataPath(true);
    try {
      const result = await window.desktopApi.setDataFilePath({
        targetPath,
        createIfMissing,
      });

      if (result.ok && result.path) {
        setDataFilePathInput(result.path);
        setPendingCreatePath('');
        toast.success(result.created ? '已创建并加载新数据文件' : '已加载数据文件');
        return;
      }

      if (result.requiresCreate && result.path) {
        setPendingCreatePath(result.path);
        return;
      }

      if (result.error === 'invalid_json') {
        toast.error('目标文件不是有效的 JSON 数据文件');
      } else if (result.error === 'path_not_writable') {
        toast.error('该路径不可写，请更换路径');
      } else if (result.error === 'create_failed') {
        toast.error('创建数据文件失败');
      } else {
        toast.error('修改数据文件路径失败');
      }
    } catch {
      toast.error('修改数据文件路径失败');
    } finally {
      setIsChangingDataPath(false);
    }
  };

  const addUrlWhitelistRule = () => {
    const name = urlNameInput.trim();
    const pattern = urlPatternInput.trim();
    if (!pattern) {
      toast.error('请输入白名单网址模式');
      return;
    }
    const now = new Date().toISOString();
    const nextRule: UrlWhitelistRule = {
      id: makeRuleId('wl'),
      name: name || pattern,
      pattern,
      createdAt: now,
      updatedAt: now,
    };
    updatePreferences({ urlWhitelist: [nextRule, ...state.preferences.urlWhitelist] });
    setUrlNameInput('');
    setUrlPatternInput('');
  };

  const updateUrlWhitelistRule = (ruleId: string, key: 'name' | 'pattern', value: string) => {
    const trimmedValue = value.trim();
    if (key === 'pattern' && !trimmedValue) {
      updatePreferences({ urlWhitelist: state.preferences.urlWhitelist.filter(rule => rule.id !== ruleId) });
      return;
    }
    const now = new Date().toISOString();
    updatePreferences({
      urlWhitelist: state.preferences.urlWhitelist.map(rule =>
        rule.id === ruleId
          ? {
              ...rule,
              ...(key === 'name'
                ? { name: trimmedValue || rule.pattern }
                : {
                    pattern: trimmedValue,
                    name: rule.name === rule.pattern ? trimmedValue : rule.name,
                  }),
              updatedAt: now,
            }
          : rule,
      ),
    });
  };

  const deleteUrlWhitelistRule = (ruleId: string) => {
    updatePreferences({ urlWhitelist: state.preferences.urlWhitelist.filter(rule => rule.id !== ruleId) });
  };

  const addProcessBlacklistRule = () => {
    const namePattern = blacklistNameInput.trim();
    const typePattern = blacklistTypeInput.trim();
    const processPattern = blacklistProcessInput.trim();
    if (!namePattern && !typePattern && !processPattern) {
      toast.error('至少填写名称、类型、进程中的一个');
      return;
    }

    const now = new Date().toISOString();
    const nextRule: ProcessBlacklistRule = {
      id: makeRuleId('bl'),
      namePattern: namePattern || undefined,
      typePattern: typePattern || undefined,
      processPattern: processPattern || undefined,
      createdAt: now,
      updatedAt: now,
    };
    updatePreferences({ processBlacklist: [nextRule, ...state.preferences.processBlacklist] });
    setBlacklistNameInput('');
    setBlacklistTypeInput('');
    setBlacklistProcessInput('');
  };

  const updateProcessBlacklistRule = (
    ruleId: string,
    key: 'namePattern' | 'typePattern' | 'processPattern',
    value: string,
  ) => {
    const now = new Date().toISOString();
    const trimmedValue = value.trim();
    const nextRules = state.preferences.processBlacklist
      .map(rule => {
        if (rule.id !== ruleId) {
          return rule;
        }
        const nextRule: ProcessBlacklistRule = {
          ...rule,
          [key]: trimmedValue || undefined,
          updatedAt: now,
        };
        if (!nextRule.namePattern && !nextRule.typePattern && !nextRule.processPattern) {
          return null;
        }
        return nextRule;
      })
      .filter((rule): rule is ProcessBlacklistRule => Boolean(rule));

    updatePreferences({ processBlacklist: nextRules });
  };

  const deleteProcessBlacklistRule = (ruleId: string) => {
    updatePreferences({ processBlacklist: state.preferences.processBlacklist.filter(rule => rule.id !== ruleId) });
  };

  const handlePickAudioFile = async () => {
    if (!window.desktopApi?.isElectron) {
      toast.info('浏览器环境请手动输入路径或 URL');
      return;
    }
    const pickedPath = await window.desktopApi.selectAudioFile();
    if (!pickedPath) {
      return;
    }
    const defaultName = getSoundDisplayNameFromPath(pickedPath);
    const added = addSoundFile(defaultName, pickedPath, 1);
    if (added) {
      toast.success('已添加提示音文件');
    }
  };

  const handleManualAdd = () => {
    const filePath = manualPath.trim();
    if (!filePath) {
      toast.error('请输入提示音路径');
      return;
    }
    const name = manualName.trim() || getSoundDisplayNameFromPath(filePath);
    const added = addSoundFile(name, filePath, 1);
    if (!added) {
      toast.error('添加失败，请检查路径');
      return;
    }
    setManualPath('');
    setManualName('');
    toast.success('已添加提示音文件');
  };

  const handlePickPathForManualInput = async () => {
    if (!window.desktopApi?.isElectron) {
      browserFilePickerRef.current?.click();
      return;
    }
    const pickedPath = await window.desktopApi.selectAudioFile();
    if (!pickedPath) {
      return;
    }
    setManualPath(pickedPath);
    if (!manualName.trim()) {
      setManualName(getSoundDisplayNameFromPath(pickedPath));
    }
  };

  const handleBrowserFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        toast.error('读取文件失败');
        return;
      }
      setManualPath(dataUrl);
      if (!manualName.trim()) {
        setManualName(getSoundDisplayNameFromPath(file.name));
      }
      toast.info('已加载文件内容，可直接保存');
    };
    reader.onerror = () => {
      toast.error('读取文件失败');
    };
    reader.readAsDataURL(file);
  };

  const handlePreview = async (soundId: string) => {
    try {
      await playSoundById(state.soundFiles, {
        enabled: true,
        soundFileId: soundId,
        eventVolumeMultiplier: 1,
      });
    } catch {
      toast.error('试听失败，请检查音频文件');
    }
  };

  const handlePreviewEvent = async (config: SoundEventConfig) => {
    const playback = resolveSoundPlaybackForEvent(state.pomodoroSettings, state.soundFiles, config.eventType);
    if (!playback.soundFileId) {
      toast.error('请先选择提示音文件');
      return;
    }
    if (playback.volumeMode === 'balanced' && !playback.cacheReady) {
      toast.info('平衡模式尚未应用，当前将按原始音量试听');
    }
    try {
      await playSoundById(state.soundFiles, {
        enabled: true,
        soundFileId: playback.soundFileId,
        eventVolumeMultiplier: playback.eventVolumeMultiplier,
      });
    } catch {
      toast.error('试听失败，请检查音频文件');
    }
  };

  return (
    <DashboardLayout pageTitle="设置">
      <div className="max-w-5xl mx-auto">
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="general">通用配置</TabsTrigger>
            <TabsTrigger value="sounds">提示音管理</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">记录与界面</h3>
                <p className="text-xs text-muted-foreground">
                  只记录总可见时长达到阈值的窗口，主题会立即生效。
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">记录阈值（秒）</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={thresholdInput}
                    onChange={event => setThresholdInput(event.target.value)}
                    onBlur={() => commitThresholdInput(thresholdInput)}
                    onKeyDown={handleThresholdKeyDown}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">界面主题</label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={state.preferences.uiTheme === 'dark' ? 'default' : 'outline'}
                      className="gap-1.5"
                      onClick={() => updatePreferences({ uiTheme: 'dark' })}
                    >
                      <MoonStar className="w-4 h-4" />
                      暗色
                    </Button>
                    <Button
                      type="button"
                      variant={state.preferences.uiTheme === 'light' ? 'default' : 'outline'}
                      className="gap-1.5"
                      onClick={() => updatePreferences({ uiTheme: 'light' })}
                    >
                      <Sun className="w-4 h-4" />
                      亮色
                    </Button>
                  </div>
                </div>

                <div className="md:col-span-2 rounded-lg border border-border/70 p-3 flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">开机自启动</p>
                    <p className="text-xs text-muted-foreground">
                      {isElectronRuntime
                        ? '开启后，Windows 登录时会自动启动本软件。'
                        : '仅桌面版支持此功能。'}
                    </p>
                  </div>
                  <Switch
                    checked={state.preferences.autoLaunchEnabled}
                    onCheckedChange={handleAutoLaunchChange}
                    disabled={!isElectronRuntime}
                  />
                </div>

                <div className="md:col-span-2 rounded-lg border border-border/70 p-3 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">关闭窗口行为</p>
                    <p className="text-xs text-muted-foreground">
                      点击右上角关闭按钮时的默认动作。选择“每次询问”会弹出“关闭/隐藏到托盘”的确认框，并可勾选记住选择。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={state.preferences.closeWindowBehavior === 'ask' ? 'default' : 'outline'}
                      onClick={() => updatePreferences({ closeWindowBehavior: 'ask' })}
                    >
                      每次询问
                    </Button>
                    <Button
                      type="button"
                      variant={state.preferences.closeWindowBehavior === 'close' ? 'default' : 'outline'}
                      onClick={() => updatePreferences({ closeWindowBehavior: 'close' })}
                    >
                      直接关闭
                    </Button>
                    <Button
                      type="button"
                      variant={state.preferences.closeWindowBehavior === 'tray' ? 'default' : 'outline'}
                      onClick={() => updatePreferences({ closeWindowBehavior: 'tray' })}
                    >
                      隐藏到托盘
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleHideToTrayNow()}
                      disabled={!isElectronRuntime}
                    >
                      立即隐藏到托盘
                    </Button>
                  </div>
                </div>

                <div className="md:col-span-2 rounded-lg border border-border/70 p-3 space-y-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">倒计时完成后处理</p>
                    <p className="text-xs text-muted-foreground">
                      选择倒计时到点后是自动删除任务，还是保留在列表并以删除线显示（点击即可删除）。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={state.preferences.countdownCompletedTaskBehavior === 'keep' ? 'default' : 'outline'}
                      onClick={() => updatePreferences({ countdownCompletedTaskBehavior: 'keep' })}
                    >
                      手动点击后删除
                    </Button>
                    <Button
                      type="button"
                      variant={state.preferences.countdownCompletedTaskBehavior === 'delete' ? 'default' : 'outline'}
                      onClick={() => updatePreferences({ countdownCompletedTaskBehavior: 'delete' })}
                    >
                      完成即删除
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">数据文件路径</p>
                  <p className="text-xs text-muted-foreground">
                    当前数据库（数据文件）路径如下。修改后若目标文件存在会直接加载；若不存在会提示是否创建新文件。
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={dataFilePathInput}
                      onChange={event => setDataFilePathInput(event.target.value)}
                      placeholder="输入新的数据文件路径（可填目录或 .json 文件）"
                      className="h-8 font-mono text-[11px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0"
                      onClick={() => void handlePickDataFilePath()}
                      disabled={!isElectronRuntime || isChangingDataPath}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      选择
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void commitDataFilePath(false)}
                      disabled={!isElectronRuntime || isChangingDataPath}
                    >
                      {isChangingDataPath ? '应用中...' : '应用'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">网页白名单（支持通配符）</p>
                  <p className="text-xs text-muted-foreground">
                    命中白名单的网址将按“独立页面”统计，不再按域名合并。示例：`https://leetcode.com/problemset/*`
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-2">
                  <Input
                    value={urlNameInput}
                    onChange={event => setUrlNameInput(event.target.value)}
                    placeholder="规则名称，如 LeetCode 题库"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addUrlWhitelistRule();
                      }
                    }}
                  />
                  <Input
                    value={urlPatternInput}
                    onChange={event => setUrlPatternInput(event.target.value)}
                    placeholder="输入网址模式，如 https://example.com/path/*"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addUrlWhitelistRule();
                      }
                    }}
                  />
                  <Button type="button" size="sm" onClick={addUrlWhitelistRule}>
                    添加
                  </Button>
                </div>
                <div className="space-y-2">
                  {state.preferences.urlWhitelist.map(rule => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-2 items-center"
                    >
                      <Input
                        defaultValue={rule.name}
                        className="h-8"
                        placeholder="规则名称"
                        onBlur={event => updateUrlWhitelistRule(rule.id, 'name', event.target.value)}
                      />
                      <Input
                        defaultValue={rule.pattern}
                        className="h-8"
                        placeholder="网址通配规则"
                        onBlur={event => updateUrlWhitelistRule(rule.id, 'pattern', event.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteUrlWhitelistRule(rule.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {state.preferences.urlWhitelist.length === 0 && (
                    <p className="text-xs text-muted-foreground">暂无白名单规则</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">进程黑名单（支持通配符）</p>
                  <p className="text-xs text-muted-foreground">
                    名称 / 类型 / 进程可填一项或多项，全部匹配即忽略。类型可填：`AppWindow`、`BrowserTab`、`Desktop`。
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_1fr_auto] gap-2 items-end">
                  <Input
                    value={blacklistNameInput}
                    onChange={event => setBlacklistNameInput(event.target.value)}
                    placeholder="名称模式，如 *设置*"
                    className="h-8"
                  />
                  <Input
                    value={blacklistTypeInput}
                    onChange={event => setBlacklistTypeInput(event.target.value)}
                    placeholder="类型模式，如 AppWindow"
                    className="h-8"
                  />
                  <Input
                    value={blacklistProcessInput}
                    onChange={event => setBlacklistProcessInput(event.target.value)}
                    placeholder="进程模式，如 code.exe"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addProcessBlacklistRule();
                      }
                    }}
                  />
                  <Button type="button" size="sm" onClick={addProcessBlacklistRule}>
                    添加
                  </Button>
                </div>
                <div className="space-y-2">
                  {state.preferences.processBlacklist.map(rule => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-1 md:grid-cols-[1fr_160px_1fr_auto] gap-2 items-center"
                    >
                      <Input
                        defaultValue={rule.namePattern ?? ''}
                        className="h-8"
                        placeholder="名称模式"
                        onBlur={event =>
                          updateProcessBlacklistRule(rule.id, 'namePattern', event.target.value)
                        }
                      />
                      <Input
                        defaultValue={rule.typePattern ?? ''}
                        className="h-8"
                        placeholder="类型模式"
                        onBlur={event =>
                          updateProcessBlacklistRule(rule.id, 'typePattern', event.target.value)
                        }
                      />
                      <Input
                        defaultValue={rule.processPattern ?? ''}
                        className="h-8"
                        placeholder="进程模式"
                        onBlur={event =>
                          updateProcessBlacklistRule(rule.id, 'processPattern', event.target.value)
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteProcessBlacklistRule(rule.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {state.preferences.processBlacklist.length === 0 && (
                    <p className="text-xs text-muted-foreground">暂无黑名单规则</p>
                  )}
                </div>
              </div>

              <AlertDialog
                open={Boolean(pendingCreatePath)}
                onOpenChange={open => {
                  if (!open) {
                    setPendingCreatePath('');
                  }
                }}
              >
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle>目标数据文件不存在</AlertDialogTitle>
                    <AlertDialogDescription>
                      将在以下路径创建新的数据文件并切换：
                      <span className="block mt-1 font-mono text-[11px] break-all">{pendingCreatePath}</span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isChangingDataPath}
                      onClick={() => {
                        if (pendingCreatePath) {
                          setDataFilePathInput(pendingCreatePath);
                          void commitDataFilePath(true);
                        }
                      }}
                    >
                      {isChangingDataPath ? '创建中...' : '创建并切换'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <div className="pt-3 border-t border-border/70 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">危险操作</p>
                  <p className="text-xs text-muted-foreground">清空全部记录、专注计划、代办与设置，此操作不可撤销。</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="gap-1.5" disabled={isClearingAllData}>
                      <Trash2 className="w-4 h-4" />
                      清除所有数据
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认清除所有数据</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作会删除所有本地数据，且无法恢复。请再次确认是否继续。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={isClearingAllData}
                        onClick={() => void handleClearAllData()}
                      >
                        {isClearingAllData ? '清除中...' : '确认清除'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="sounds">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">提示音文件列表</h3>
                <Button size="sm" onClick={() => void handlePickAudioFile()} className="gap-1">
                  <Plus className="w-3.5 h-3.5" />
                  添加文件
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">事件提示音配置</p>
                  <p className="text-xs text-muted-foreground">
                    可为“番茄钟到点 / 偏离提醒 / 倒计时到点”分别设置声音；选择“无”表示不播放。
                  </p>
                </div>

                <div className="space-y-3">
                  {SOUND_EVENT_CONFIGS.map(config => {
                    const soundFileId = getEventSoundId(config);
                    const mode = getEventVolumeMode(config);
                    const cache = getEventCache(config);
                    const playback = resolveSoundPlaybackForEvent(state.pomodoroSettings, state.soundFiles, config.eventType);
                    return (
                      <div key={config.eventType} className="rounded-lg border border-border/70 p-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2 items-center">
                          <span className="text-xs text-muted-foreground">{config.label}</span>
                          <Select
                            value={soundFileId || NONE_SOUND_ID}
                            onValueChange={value =>
                              updateSettings({
                                [config.soundIdKey]: value === NONE_SOUND_ID ? '' : value,
                                [config.cacheKey]: undefined,
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE_SOUND_ID}>无</SelectItem>
                              {sortedSoundFiles.map(sound => (
                                <SelectItem key={sound.id} value={sound.id}>
                                  {sound.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handlePreviewEvent(config)}
                            disabled={!soundFileId}
                          >
                            试听
                          </Button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">音量模式</span>
                          <Button
                            type="button"
                            size="sm"
                            variant={mode === 'unbalanced' ? 'default' : 'outline'}
                            onClick={() => updateEventVolumeMode(config, 'unbalanced')}
                          >
                            不平衡
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={mode === 'balanced' ? 'default' : 'outline'}
                            onClick={() => updateEventVolumeMode(config, 'balanced')}
                          >
                            平衡
                          </Button>
                        </div>

                        {mode === 'unbalanced' ? (
                          <div className="grid grid-cols-1 md:grid-cols-[140px_180px_1fr] gap-2 items-center">
                            <span className="text-xs text-muted-foreground">音量倍率</span>
                            <Input
                              type="number"
                              step="0.1"
                              min="0.0001"
                              value={getEventManualMultiplier(config)}
                              onChange={event => updateEventManualMultiplier(config, event.target.value)}
                              className="h-8"
                            />
                            <p className="text-xs text-muted-foreground">倍率需大于 0，1 为原始音量，无上限。</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-[140px_180px_auto] gap-2 items-center">
                              <span className="text-xs text-muted-foreground">目标平均音量 (dB)</span>
                              <Input
                                type="number"
                                step="0.1"
                                value={getEventTargetDb(config)}
                                onChange={event => updateEventTargetDb(config, event.target.value)}
                                className="h-8"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!soundFileId || applyingBalanceEventType === config.eventType}
                                onClick={() => void handleApplyBalance(config)}
                              >
                                {applyingBalanceEventType === config.eventType ? '应用中...' : '应用并缓存'}
                              </Button>
                            </div>
                            {cache ? (
                              <p className="text-xs text-muted-foreground">
                                缓存：平均 {cache.measuredAverageDb.toFixed(2)} dB，峰值 {cache.measuredPeakDb.toFixed(2)} dB，倍率 x
                                {cache.normalizedGain.toFixed(3)}
                                {!playback.cacheReady ? '（缓存与当前配置不一致，请重新应用）' : ''}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">尚未生成缓存，点击“应用并缓存”后生效。</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground">路径或 URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      value={manualPath}
                      onChange={event => setManualPath(event.target.value)}
                      placeholder="例如 D:\\sounds\\alarm.wav"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0"
                      onClick={() => void handlePickPathForManualInput()}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      选择
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">名称（可选）</label>
                  <Input
                    value={manualName}
                    onChange={event => setManualName(event.target.value)}
                    placeholder="不填则自动取文件名"
                    className="h-8 mt-1"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={handleManualAdd}>
                  保存
                </Button>
              </div>

              <input
                ref={browserFilePickerRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/*"
                className="hidden"
                onChange={event => handleBrowserFilePicked(event)}
              />

              <div className="space-y-2">
                {sortedSoundFiles.map(sound => (
                  <div
                    key={sound.id}
                    className="grid grid-cols-1 md:grid-cols-[220px_1fr_120px_auto_auto] gap-2 items-center p-2 rounded-lg border border-border hover:bg-secondary/20"
                    onClick={() => void handlePreview(sound.id)}
                  >
                    <Input
                      value={sound.name}
                      className="h-8"
                      onClick={event => event.stopPropagation()}
                      onChange={event => updateSoundFile({ ...sound, name: event.target.value })}
                    />
                    <Input
                      value={sound.filePath}
                      className="h-8 font-mono text-[11px]"
                      onClick={event => event.stopPropagation()}
                      onChange={event => updateSoundFile({ ...sound, filePath: event.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.1"
                      value={sound.defaultVolumeMultiplier}
                      className="h-8"
                      onClick={event => event.stopPropagation()}
                      onChange={event =>
                        updateSoundFile({
                          ...sound,
                          defaultVolumeMultiplier: toFinite(event.target.value, 1),
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={event => {
                        event.stopPropagation();
                        void handlePreview(sound.id);
                      }}
                    >
                      <Play className="w-3.5 h-3.5" />
                      试听
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={event => {
                        event.stopPropagation();
                        deleteSoundFile(sound.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {sortedSoundFiles.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">暂无提示音文件</p>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

