import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { ProcessBlacklistRule, ProcessWhitelistRule, SoundBalanceCache } from '@/types';
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
import { Copy, Database, Download, ExternalLink, FolderOpen, Github, MoonStar, Play, Plus, RefreshCw, Sun, Trash2 } from 'lucide-react';

type SettingsTab = 'general' | 'database' | 'plugins' | 'sounds' | 'updates' | 'console';
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

function formatBytes(bytes: number | undefined) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(value)} B`;
}

function getUpdatePhaseLabel(progress: UpdateProgressEvent | null) {
  if (!progress) {
    return '';
  }
  if (progress.message) {
    return progress.message;
  }
  switch (progress.phase) {
    case 'preparing':
      return '准备更新...';
    case 'downloading-package':
      return '正在下载新版程序...';
    case 'downloading-sha256':
      return '正在下载校验文件...';
    case 'verifying':
      return '正在校验更新文件...';
    case 'launching-updater':
      return '正在启动替换程序...';
    case 'ready-to-replace':
      return '下载完成，准备关闭并替换...';
    case 'failed':
      return '更新失败';
    default:
      return '正在更新...';
  }
}

function formatUpdateProgressBytes(progress: UpdateProgressEvent | null) {
  if (!progress) {
    return '';
  }
  const transferred = formatBytes(progress.transferredBytes);
  const total = formatBytes(progress.totalBytes);
  if (transferred === '-' && total === '-') {
    return '';
  }
  if (total === '-') {
    return transferred;
  }
  return `${transferred} / ${total}`;
}

function getUpdateProgressPercent(progress: UpdateProgressEvent | null) {
  const value = Number(progress?.percent);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

export default function SettingsPage() {
  const {
    state,
    updatePreferences,
    updateSettings,
    updateUiState,
    mergeRecordsByWhitelist,
    clearAllData,
    clearDiagnosticLogs,
    addSoundFile,
    updateSoundFile,
    deleteSoundFile,
  } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingCreatePath, setPendingCreatePath] = useState('');
  const [isChangingDataPath, setIsChangingDataPath] = useState(false);
  const [isClearingAllData, setIsClearingAllData] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [isMergingWhitelistRecords, setIsMergingWhitelistRecords] = useState(false);
  const [applyingBalanceEventType, setApplyingBalanceEventType] = useState<SoundEventType | null>(null);
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isStartingUpdate, setIsStartingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatusResult | null>(null);
  const [isRefreshingStorageStatus, setIsRefreshingStorageStatus] = useState(false);
  const [isMigratingStorage, setIsMigratingStorage] = useState(false);
  const browserFilePickerRef = useRef<HTMLInputElement | null>(null);
  const settingsUi = state.uiState.settings;
  const updateSettingsUi = (partial: Partial<typeof settingsUi>) => {
    updateUiState({
      settings: partial as typeof settingsUi,
    });
  };
  const manualPath = settingsUi.manualPath;
  const manualName = settingsUi.manualName;
  const whitelistNameInput = settingsUi.whitelistNameInput;
  const whitelistNamePatternInput = settingsUi.whitelistNamePatternInput;
  const whitelistTypePatternInput = settingsUi.whitelistTypePatternInput;
  const whitelistProcessPatternInput = settingsUi.whitelistProcessPatternInput;
  const blacklistNameInput = settingsUi.blacklistNameInput;
  const blacklistTypeInput = settingsUi.blacklistTypeInput;
  const blacklistProcessInput = settingsUi.blacklistProcessInput;
  const dataFilePathInput = settingsUi.dataFilePathInput;
  const thresholdInput = settingsUi.thresholdInput || String(state.preferences.recordWindowThresholdSeconds);
  const analyticsWindowItemLimitInput =
    settingsUi.analyticsWindowItemLimitInput || String(state.preferences.analyticsWindowItemLimit ?? 10);
  const setManualPath = (manualPath: string) => updateSettingsUi({ manualPath });
  const setManualName = (manualName: string) => updateSettingsUi({ manualName });
  const setWhitelistNameInput = (whitelistNameInput: string) => updateSettingsUi({ whitelistNameInput });
  const setWhitelistNamePatternInput = (whitelistNamePatternInput: string) =>
    updateSettingsUi({ whitelistNamePatternInput });
  const setWhitelistTypePatternInput = (whitelistTypePatternInput: string) =>
    updateSettingsUi({ whitelistTypePatternInput });
  const setWhitelistProcessPatternInput = (whitelistProcessPatternInput: string) =>
    updateSettingsUi({ whitelistProcessPatternInput });
  const setBlacklistNameInput = (blacklistNameInput: string) => updateSettingsUi({ blacklistNameInput });
  const setBlacklistTypeInput = (blacklistTypeInput: string) => updateSettingsUi({ blacklistTypeInput });
  const setBlacklistProcessInput = (blacklistProcessInput: string) => updateSettingsUi({ blacklistProcessInput });
  const setDataFilePathInput = (dataFilePathInput: string) => updateSettingsUi({ dataFilePathInput });
  const setThresholdInput = (thresholdInput: string) => updateSettingsUi({ thresholdInput });
  const setAnalyticsWindowItemLimitInput = (analyticsWindowItemLimitInput: string) =>
    updateSettingsUi({ analyticsWindowItemLimitInput });

  useEffect(() => {
    if (!window.desktopApi?.isElectron) {
      setAppVersion('1.0.5');
      return;
    }

    let disposed = false;
    const loadDesktopMeta = async () => {
      try {
        const [currentPath, version, nextStorageStatus] = await Promise.all([
          window.desktopApi!.getDataFilePath(),
          window.desktopApi!.getAppVersion?.() ?? Promise.resolve('1.0.5'),
          window.desktopApi!.getStorageStatus?.() ?? Promise.resolve(null),
        ]);
        if (disposed) {
          return;
        }
        if (!dataFilePathInput) {
          updateUiState({
            settings: { dataFilePathInput: currentPath } as typeof settingsUi,
          });
        }
        setAppVersion(version || '1.0.6');
        setStorageStatus(nextStorageStatus);
      } catch {
        if (!disposed) {
      toast.error('读取数据目录失败');
        }
      }
    };

    void loadDesktopMeta();
    return () => {
      disposed = true;
    };
  }, [dataFilePathInput, updateUiState]);

  useEffect(() => {
    if (!window.desktopApi?.isElectron || !window.desktopApi.onUpdateProgress) {
      return undefined;
    }
    return window.desktopApi.onUpdateProgress(progress => {
      setUpdateProgress(progress);
    });
  }, []);

  const tabParam = searchParams.get('tab');
  const tab: SettingsTab =
    tabParam === 'sounds'
      ? 'sounds'
      : tabParam === 'plugins'
        ? 'plugins'
        : tabParam === 'database'
          ? 'database'
          : tabParam === 'updates'
            ? 'updates'
            : tabParam === 'console'
              ? 'console'
              : 'general';

  const sortedSoundFiles = useMemo(
    () =>
      [...state.soundFiles].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [state.soundFiles],
  );
  const isElectronRuntime = Boolean(window.desktopApi?.isElectron);

  const handleTabChange = (nextTab: string) => {
    const normalized: SettingsTab =
      nextTab === 'sounds'
        ? 'sounds'
        : nextTab === 'plugins'
          ? 'plugins'
          : nextTab === 'database'
            ? 'database'
            : nextTab === 'updates'
              ? 'updates'
              : nextTab === 'console'
                ? 'console'
                : 'general';
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

  const commitAnalyticsWindowItemLimitInput = (rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setAnalyticsWindowItemLimitInput(String(state.preferences.analyticsWindowItemLimit ?? 10));
      toast.error('数据统计窗口数量必须是数字');
      return;
    }

    const normalized = Math.max(1, Math.floor(parsed));
    updatePreferences({ analyticsWindowItemLimit: normalized });
    setAnalyticsWindowItemLimitInput(String(normalized));
  };

  const handleAnalyticsWindowItemLimitKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitAnalyticsWindowItemLimitInput(analyticsWindowItemLimitInput);
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

  const refreshStorageStatus = async () => {
    if (!window.desktopApi?.isElectron || !window.desktopApi.getStorageStatus) {
      return null;
    }
    const nextStatus = await window.desktopApi.getStorageStatus();
    setStorageStatus(nextStatus);
    return nextStatus;
  };

  const handleRefreshStorageStatus = async () => {
    if (isRefreshingStorageStatus) {
      return;
    }
    setIsRefreshingStorageStatus(true);
    try {
      await refreshStorageStatus();
      toast.success('已刷新数据库状态');
    } catch {
      toast.error('刷新数据库状态失败');
    } finally {
      setIsRefreshingStorageStatus(false);
    }
  };

  const handleMigrateLegacyJsonStorage = async () => {
    if (isMigratingStorage) {
      return;
    }
    if (!window.desktopApi?.isElectron || !window.desktopApi.migrateLegacyJsonStorage) {
      toast.info('当前环境不支持数据库迁移');
      return;
    }
    const confirmed = window.confirm('确认将当前数据目录中的旧 JSON 数据迁移到 SQLite 吗？迁移会保留旧 JSON 文件，但会用旧 JSON 内容刷新当前 SQLite 数据库。');
    if (!confirmed) {
      return;
    }

    setIsMigratingStorage(true);
    try {
      const result = await window.desktopApi.migrateLegacyJsonStorage();
      if (result.ok) {
        if (result.status) {
          setStorageStatus(result.status);
        } else {
          await refreshStorageStatus();
        }
        toast.success('旧 JSON 数据已迁移到 SQLite');
        return;
      }
      if (result.error === 'no_legacy_json') {
        toast.info('当前数据目录没有可迁移的旧 JSON 数据');
      } else {
        toast.error('迁移失败，请查看控制台日志');
      }
      if (result.status) {
        setStorageStatus(result.status);
      }
    } catch {
      toast.error('迁移失败，请查看控制台日志');
    } finally {
      setIsMigratingStorage(false);
    }
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
      toast.info('当前环境不支持选择数据目录');
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
      toast.error('请输入数据目录路径');
      return;
    }
    if (!window.desktopApi?.isElectron) {
      toast.info('当前环境不支持修改数据目录');
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
        void refreshStorageStatus();
        toast.success(result.created ? '已创建并加载新数据目录' : '已加载数据目录');
        return;
      }

      if (result.requiresCreate && result.path) {
        setPendingCreatePath(result.path);
        return;
      }

      if (result.error === 'invalid_json') {
        toast.error('目标目录中的数据文件损坏');
      } else if (result.error === 'path_not_writable') {
        toast.error('该路径不可写，请更换路径');
      } else if (result.error === 'create_failed') {
        toast.error('创建数据目录失败');
      } else {
        toast.error('修改数据目录失败');
      }
    } catch {
      toast.error('修改数据目录失败');
    } finally {
      setIsChangingDataPath(false);
    }
  };

  const addProcessWhitelistRule = () => {
    const name = whitelistNameInput.trim();
    const namePattern = whitelistNamePatternInput.trim();
    const typePattern = whitelistTypePatternInput.trim();
    const processPattern = whitelistProcessPatternInput.trim();
    if (!namePattern && !typePattern && !processPattern) {
      toast.error('至少填写名称、类型、进程中的一个匹配字段');
      return;
    }
    const fallbackName = namePattern || typePattern || processPattern || '白名单规则';
    const now = new Date().toISOString();
    const nextRule: ProcessWhitelistRule = {
      id: makeRuleId('wl'),
      name: name || fallbackName,
      namePattern: namePattern || undefined,
      typePattern: typePattern || undefined,
      processPattern: processPattern || undefined,
      createdAt: now,
      updatedAt: now,
    };
    updatePreferences({ processWhitelist: [nextRule, ...state.preferences.processWhitelist] });
    setWhitelistNameInput('');
    setWhitelistNamePatternInput('');
    setWhitelistTypePatternInput('');
    setWhitelistProcessPatternInput('');
  };

  const updateProcessWhitelistRule = (
    ruleId: string,
    key: 'name' | 'namePattern' | 'typePattern' | 'processPattern',
    value: string,
  ) => {
    const trimmedValue = value.trim();
    const now = new Date().toISOString();
    const nextRules = state.preferences.processWhitelist
      .map(rule => {
        if (rule.id !== ruleId) {
          return rule;
        }
        const nextRule: ProcessWhitelistRule = {
          ...rule,
          [key]: key === 'name' ? trimmedValue || rule.name : trimmedValue || undefined,
          updatedAt: now,
        };
        if (!nextRule.namePattern && !nextRule.typePattern && !nextRule.processPattern) {
          return null;
        }
        const fallbackName =
          nextRule.namePattern || nextRule.typePattern || nextRule.processPattern || rule.name;
        if (!nextRule.name || !nextRule.name.trim()) {
          nextRule.name = fallbackName;
        }
        return nextRule;
      })
      .filter((rule): rule is ProcessWhitelistRule => Boolean(rule));

    updatePreferences({ processWhitelist: nextRules });
  };

  const deleteProcessWhitelistRule = (ruleId: string) => {
    updatePreferences({
      processWhitelist: state.preferences.processWhitelist.filter(rule => rule.id !== ruleId),
    });
  };

  const handleMergeRecordsByWhitelist = async () => {
    if (state.preferences.processWhitelist.length === 0) {
      toast.info('当前没有白名单规则');
      return;
    }
    if (!window.desktopApi?.isElectron) {
      toast.info('当前环境不支持归并历史记录');
      return;
    }
    setIsMergingWhitelistRecords(true);
    try {
      const changedCount = await mergeRecordsByWhitelist();
      if (changedCount > 0) {
        toast.success('已按白名单归并记录', {
          description: `处理了 ${changedCount} 条历史记录`,
        });
      } else {
        toast.info('没有需要归并的记录');
      }
    } catch {
      toast.error('归并历史记录失败');
    } finally {
      setIsMergingWhitelistRecords(false);
    }
  };

  const openOfficialPluginDownload = async (assetName: string) => {
    const versionTag = `v${appVersion || '1.0.6'}`;
    const targetUrl = `https://github.com/kewuuuu/KewuToolbox/releases/download/${versionTag}/${assetName}`;
    if (window.desktopApi?.isElectron && window.desktopApi.openExternalUrl) {
      const result = await window.desktopApi.openExternalUrl({ url: targetUrl });
      if (!result.ok) {
        toast.error('打开下载链接失败');
      }
      return;
    }
    window.open(targetUrl, '_blank');
  };

  const openOfficialBrowserPluginDownload = async () => {
    await openOfficialPluginDownload('browser-extension.zip');
  };

  const openOfficialVsCodePluginDownload = async () => {
    await openOfficialPluginDownload('vscode-extension.zip');
  };

  const openRepositoryHome = async () => {
    const targetUrl = 'https://github.com/kewuuuu/KewuToolbox';
    if (window.desktopApi?.isElectron && window.desktopApi.openExternalUrl) {
      const result = await window.desktopApi.openExternalUrl({ url: targetUrl });
      if (!result.ok) {
        toast.error('打开 GitHub 仓库失败');
      }
      return;
    }
    window.open(targetUrl, '_blank');
  };

  const handleCheckForUpdates = async () => {
    if (!window.desktopApi?.isElectron || !window.desktopApi.checkForUpdates) {
      toast.info('当前环境不支持检查更新');
      return;
    }
    if (isCheckingUpdate) {
      return;
    }
    setUpdateProgress(null);
    setIsCheckingUpdate(true);
    try {
      const result = await window.desktopApi.checkForUpdates();
      setUpdateCheckResult(result);
      if (!result.ok) {
        toast.error('检查更新失败', { description: result.detail || result.error });
        return;
      }
      if (result.hasUpdate) {
        toast.success(`发现新版本 v${result.latestVersion}`);
      } else {
        toast.info('当前已经是最新版本');
      }
    } catch (error) {
      toast.error('检查更新失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleStartPortableUpdate = async () => {
    if (!updateCheckResult?.hasUpdate || !updateCheckResult.assetUrl) {
      toast.info('请先检查到可用的新版本');
      return;
    }
    if (!updateCheckResult.sha256Url) {
      toast.error('该版本缺少 .sha256 校验文件，不能自动更新');
      return;
    }
    if (!window.desktopApi?.isElectron || !window.desktopApi.startPortableUpdate) {
      toast.info('当前环境不支持自动更新');
      return;
    }
    if (isStartingUpdate) {
      return;
    }
    setUpdateProgress({
      phase: 'preparing',
      status: 'running',
      percent: 0,
      message: '准备下载更新...',
    });
    setIsStartingUpdate(true);
    try {
      const result = await window.desktopApi.startPortableUpdate({
        assetUrl: updateCheckResult.assetUrl,
        sha256Url: updateCheckResult.sha256Url,
        assetName: updateCheckResult.assetName,
      });
      if (!result.ok) {
        const messages: Record<string, string> = {
          not_packaged: '开发模式不能执行自动覆盖更新，请使用打包后的便携版。',
          missing_target_path: '无法识别当前程序路径。',
          invalid_update_url: '更新下载地址不合法。',
          download_update_failed: '下载新版程序失败。',
          download_sha256_failed: '下载 SHA256 校验文件失败。',
          checksum_failed: '新版程序校验失败，已取消更新。',
          write_updater_failed: '无法在程序同目录写入更新程序。',
          launch_updater_failed: '启动更新程序失败。',
        };
        setUpdateProgress(previous => ({
          ...(previous || {}),
          phase: 'failed',
          status: 'failed',
          message: messages[result.error || ''] || result.detail || result.error || '更新失败',
        }));
        toast.error('启动更新失败', { description: messages[result.error || ''] || result.detail || result.error });
        setIsStartingUpdate(false);
        return;
      }
      toast.success('新版已下载并校验完成，正在关闭主程序并替换。');
    } catch (error) {
      setUpdateProgress(previous => ({
        ...(previous || {}),
        phase: 'failed',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }));
      toast.error('启动更新失败', { description: error instanceof Error ? error.message : String(error) });
      setIsStartingUpdate(false);
    }
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

  const handleCopyLogs = async () => {
    const lines = [...state.diagnosticLogs]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .map(item => {
        const detail = item.detail?.trim() ? ` | ${item.detail.trim()}` : '';
        return `[${item.occurredAt}] [${item.level.toUpperCase()}] ${item.message}${detail}`;
      });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('日志已复制');
    } catch {
      toast.error('复制日志失败');
    }
  };

  const handleClearLogs = async () => {
    if (isClearingLogs) {
      return;
    }
    setIsClearingLogs(true);
    try {
      await clearDiagnosticLogs();
      toast.success('已清空日志');
    } finally {
      setIsClearingLogs(false);
    }
  };

  return (
    <DashboardLayout pageTitle="设置">
      <div className="max-w-5xl mx-auto">
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="general">通用配置</TabsTrigger>
            <TabsTrigger value="database">数据库</TabsTrigger>
            <TabsTrigger value="plugins">插件</TabsTrigger>
            <TabsTrigger value="sounds">提示音管理</TabsTrigger>
            <TabsTrigger value="updates">更新</TabsTrigger>
            <TabsTrigger value="console">控制台</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">记录与界面</h3>
                <p className="text-xs text-muted-foreground">
                  只记录总可见时长达到阈值的窗口；数据统计窗口模式会按配置限制显示数量；主题会立即生效。
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
                  <label className="text-xs text-muted-foreground">数据统计窗口数量 n</label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={analyticsWindowItemLimitInput}
                    onChange={event => setAnalyticsWindowItemLimitInput(event.target.value)}
                    onBlur={() => commitAnalyticsWindowItemLimitInput(analyticsWindowItemLimitInput)}
                    onKeyDown={handleAnalyticsWindowItemLimitKeyDown}
                    className="h-9"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    窗口模式下，图表只展示最高或最近的 n 个窗口，默认 10。
                  </p>
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
                  <p className="text-sm font-medium text-foreground">数据目录路径</p>
                  <p className="text-xs text-muted-foreground">
                    程序会把数据拆分为多个文件存放在该目录中（并包含日志目录）。切换后若目录中存在历史数据会直接加载。
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={dataFilePathInput}
                      onChange={event => setDataFilePathInput(event.target.value)}
                      placeholder="输入新的数据目录路径（也兼容旧 .json 路径）"
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">白名单规则（支持通配符）</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => void handleMergeRecordsByWhitelist()}
                      disabled={isMergingWhitelistRecords || state.preferences.processWhitelist.length === 0}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isMergingWhitelistRecords ? 'animate-spin' : ''}`} />
                      {isMergingWhitelistRecords ? '归并中...' : '按白名单归并记录'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    匹配字段与黑名单一致：名称 / 类型 / 进程。命中白名单后将按规则名归并统计，并覆盖原本进程显示名。
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_160px_1fr_auto] gap-2 items-end">
                  <Input
                    value={whitelistNameInput}
                    onChange={event => setWhitelistNameInput(event.target.value)}
                    placeholder="命名（替代显示名）"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addProcessWhitelistRule();
                      }
                    }}
                  />
                  <Input
                    value={whitelistNamePatternInput}
                    onChange={event => setWhitelistNamePatternInput(event.target.value)}
                    placeholder="名称模式，如 *bilibili* 或 https://*.bilibili.com/*"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addProcessWhitelistRule();
                      }
                    }}
                  />
                  <Input
                    value={whitelistTypePatternInput}
                    onChange={event => setWhitelistTypePatternInput(event.target.value)}
                    placeholder="类型模式，如 BrowserTab"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addProcessWhitelistRule();
                      }
                    }}
                  />
                  <Input
                    value={whitelistProcessPatternInput}
                    onChange={event => setWhitelistProcessPatternInput(event.target.value)}
                    placeholder="进程模式，如 msedge.exe"
                    className="h-8"
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        addProcessWhitelistRule();
                      }
                    }}
                  />
                  <Button type="button" size="sm" onClick={addProcessWhitelistRule}>
                    添加
                  </Button>
                </div>
                <div className="space-y-2">
                  {state.preferences.processWhitelist.map(rule => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-1 md:grid-cols-[220px_1fr_160px_1fr_auto] gap-2 items-center"
                    >
                      <Input
                        value={rule.name}
                        className="h-8"
                        placeholder="规则名称"
                        onChange={event => updateProcessWhitelistRule(rule.id, 'name', event.target.value)}
                      />
                      <Input
                        value={rule.namePattern ?? ''}
                        className="h-8"
                        placeholder="名称模式"
                        onChange={event =>
                          updateProcessWhitelistRule(rule.id, 'namePattern', event.target.value)
                        }
                      />
                      <Input
                        value={rule.typePattern ?? ''}
                        className="h-8"
                        placeholder="类型模式"
                        onChange={event =>
                          updateProcessWhitelistRule(rule.id, 'typePattern', event.target.value)
                        }
                      />
                      <Input
                        value={rule.processPattern ?? ''}
                        className="h-8"
                        placeholder="进程模式"
                        onChange={event =>
                          updateProcessWhitelistRule(rule.id, 'processPattern', event.target.value)
                        }
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteProcessWhitelistRule(rule.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {state.preferences.processWhitelist.length === 0 && (
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
                        value={rule.namePattern ?? ''}
                        className="h-8"
                        placeholder="名称模式"
                        onChange={event =>
                          updateProcessBlacklistRule(rule.id, 'namePattern', event.target.value)
                        }
                      />
                      <Input
                        value={rule.typePattern ?? ''}
                        className="h-8"
                        placeholder="类型模式"
                        onChange={event =>
                          updateProcessBlacklistRule(rule.id, 'typePattern', event.target.value)
                        }
                      />
                      <Input
                        value={rule.processPattern ?? ''}
                        className="h-8"
                        placeholder="进程模式"
                        onChange={event =>
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
                    <AlertDialogTitle>目标数据目录不存在</AlertDialogTitle>
                    <AlertDialogDescription>
                      将在以下路径创建新的数据目录并切换：
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

          <TabsContent value="database" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">SQLite 数据库</h3>
                  <p className="text-xs text-muted-foreground">
                    当前版本使用 SQLite 文件保存数据；旧 JSON 文件会保留，可在此手动迁移。该迁移入口计划只保留一个大版本。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    disabled={isRefreshingStorageStatus}
                    onClick={() => void handleRefreshStorageStatus()}
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshingStorageStatus ? 'animate-spin' : ''}`} />
                    刷新状态
                  </Button>
                  <Button
                    type="button"
                    className="gap-1.5"
                    disabled={isMigratingStorage}
                    onClick={() => void handleMigrateLegacyJsonStorage()}
                  >
                    <Database className="w-4 h-4" />
                    {isMigratingStorage ? '迁移中...' : '从旧 JSON 迁移'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-3 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">数据目录</p>
                  <p className="text-[11px] font-mono break-all text-foreground">
                    {storageStatus?.dataDirectoryPath || state.dataDirectoryPath || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">SQLite 文件</p>
                  <p className="text-[11px] font-mono break-all text-foreground">
                    {storageStatus?.dbPath || '-'}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">文件大小</p>
                    <p className="text-foreground font-medium">{formatBytes(storageStatus?.sizeBytes)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">焦点记录</p>
                    <p className="text-foreground font-medium">{storageStatus?.counts?.sessions ?? '-'}</p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">进程时间线</p>
                    <p className="text-foreground font-medium">{storageStatus?.counts?.processTimeline ?? '-'}</p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">键鼠时间线</p>
                    <p className="text-foreground font-medium">{storageStatus?.counts?.inputActivityTimeline ?? '-'}</p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">剪贴板历史</p>
                    <p className="text-foreground font-medium">{storageStatus?.counts?.clipboardHistory ?? '-'}</p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-muted-foreground">配置片段</p>
                    <p className="text-foreground font-medium">{storageStatus?.counts?.sections ?? '-'}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">旧 JSON 数据</p>
                  <p className="text-xs text-muted-foreground">
                    {storageStatus?.legacy?.hasLegacyJson
                      ? `检测到旧 JSON 数据：分片文件 ${storageStatus.legacy.sectionFileCount} 个。`
                      : '当前数据目录没有检测到旧 JSON 数据。'}
                  </p>
                  {storageStatus?.legacy?.legacyStateFile ? (
                    <p className="text-[11px] font-mono break-all text-muted-foreground">
                      {storageStatus.legacy.legacyStateFile}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  disabled={isMigratingStorage || !storageStatus?.legacy?.hasLegacyJson}
                  onClick={() => void handleMigrateLegacyJsonStorage()}
                >
                  <Database className="w-4 h-4" />
                  执行迁移
                </Button>
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
          <TabsContent value="plugins" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">官方插件下载</h3>
                <p className="text-xs text-muted-foreground">
                  当前版本：v{appVersion}。可下载官方浏览器插件并在浏览器扩展管理页加载。
                </p>
              </div>

              <div className="rounded-lg border border-border/70 p-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">浏览器桥接插件</p>
                  <p className="text-xs text-muted-foreground">
                    下载地址将自动拼接到 Release：`browser-extension.zip`
                  </p>
                </div>
                <Button type="button" className="gap-1.5" onClick={() => void openOfficialBrowserPluginDownload()}>
                  <Download className="w-4 h-4" />
                  下载官方插件
                </Button>
              </div>

              <div className="rounded-lg border border-border/70 p-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">VSCode 工作区桥接插件</p>
                  <p className="text-xs text-muted-foreground">
                    下载地址将自动拼接到 Release：`vscode-extension.zip`
                  </p>
                </div>
                <Button type="button" className="gap-1.5" onClick={() => void openOfficialVsCodePluginDownload()}>
                  <Download className="w-4 h-4" />
                  下载官方插件
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">已连接插件</p>
                  <p className="text-xs text-muted-foreground">
                    下列信息由插件上报。若插件停止心跳，列表会自动移除。
                  </p>
                </div>
                {state.pluginConnections.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">暂无已连接插件</p>
                ) : (
                  <div className="space-y-2">
                    {state.pluginConnections.map(plugin => (
                      <div
                        key={plugin.pluginId}
                        className="grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr_0.7fr_0.9fr] gap-2 rounded border border-border/60 p-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground" title={plugin.pluginName}>
                            {plugin.pluginName}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground" title={plugin.pluginId}>
                            ID: {plugin.pluginId}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>版本: {plugin.pluginVersion}</p>
                          <p>协议: {plugin.protocolVersion || '-'}</p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>记录数: {plugin.recordCount}</p>
                          <p>{plugin.isOfficial ? '官方插件' : '第三方插件'}</p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>最近上报:</p>
                          <p>{new Date(plugin.lastSeenAt).toLocaleString('zh-CN')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="updates" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">软件更新</h3>
                  <p className="text-xs text-muted-foreground">
                    当前版本：v{appVersion}。更新检查会读取 GitHub Releases 最新正式版本。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="gap-1.5" onClick={() => void openRepositoryHome()}>
                    <Github className="w-4 h-4" />
                    GitHub 仓库首页
                  </Button>
                  <Button
                    type="button"
                    className="gap-1.5"
                    disabled={isCheckingUpdate}
                    onClick={() => void handleCheckForUpdates()}
                  >
                    <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                    {isCheckingUpdate ? '检查中...' : '检查更新'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">当前版本</p>
                    <p className="text-foreground font-medium">v{updateCheckResult?.currentVersion || appVersion}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">最新版本</p>
                    <p className="text-foreground font-medium">
                      {updateCheckResult?.latestVersion ? `v${updateCheckResult.latestVersion}` : '尚未检查'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">便携版更新文件</p>
                    <p className="text-foreground break-all">
                      {updateCheckResult?.assetName || '-'}
                      {updateCheckResult?.assetSize ? `（${formatBytes(updateCheckResult.assetSize)}）` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">SHA256 校验文件</p>
                    <p className={updateCheckResult?.sha256Url ? 'text-foreground break-all' : 'text-destructive'}>
                      {updateCheckResult?.sha256Name || (updateCheckResult?.ok ? '缺少 .sha256，不能自动更新' : '-')}
                    </p>
                  </div>
                </div>

                {updateCheckResult?.ok && (
                  <div className="rounded-lg bg-secondary/35 p-3 text-xs space-y-2">
                    <p className={updateCheckResult.hasUpdate ? 'text-primary font-medium' : 'text-muted-foreground'}>
                      {updateCheckResult.hasUpdate
                        ? `发现新版本 v${updateCheckResult.latestVersion}`
                        : '当前已经是最新版本'}
                    </p>
                    {updateCheckResult.releaseUrl && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={() => {
                          void window.desktopApi?.openExternalUrl?.({ url: updateCheckResult.releaseUrl || '' });
                        }}
                      >
                        打开发布页面
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {updateCheckResult.releaseNotes && (
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/60 p-2 text-[11px] text-muted-foreground bg-card/80">
                        {updateCheckResult.releaseNotes}
                      </pre>
                    )}
                  </div>
                )}

                {updateCheckResult && !updateCheckResult.ok && (
                  <p className="text-xs text-destructive">
                    检查失败：{updateCheckResult.detail || updateCheckResult.error || '未知错误'}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border/70 p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 min-w-[260px] flex-1">
                  <p className="text-sm font-medium text-foreground">便携版自动更新</p>
                  <p className="text-xs text-muted-foreground">
                    点击后主程序会先下载新版 exe 并显示进度，校验通过后再启动更新程序关闭主程序、覆盖 exe 并重启。
                  </p>
                  {updateProgress && (
                    <div className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className={updateProgress.status === 'failed' ? 'text-destructive' : 'text-foreground'}>
                          {getUpdatePhaseLabel(updateProgress)}
                        </span>
                        <span className="text-muted-foreground">
                          {getUpdateProgressPercent(updateProgress) === null
                            ? formatUpdateProgressBytes(updateProgress)
                            : `${Math.round(getUpdateProgressPercent(updateProgress) ?? 0)}%`}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-background">
                        <div
                          className={`h-full rounded-full transition-all ${
                            updateProgress.status === 'failed' ? 'bg-destructive' : 'bg-primary'
                          }`}
                          style={{
                            width: `${Math.max(
                              updateProgress.status === 'failed' ? 100 : 4,
                              getUpdateProgressPercent(updateProgress) ?? 4,
                            )}%`,
                          }}
                        />
                      </div>
                      {formatUpdateProgressBytes(updateProgress) && (
                        <p className="text-[11px] text-muted-foreground">{formatUpdateProgressBytes(updateProgress)}</p>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={
                    isStartingUpdate ||
                    !updateCheckResult?.hasUpdate ||
                    !updateCheckResult.assetUrl ||
                    !updateCheckResult.sha256Url
                  }
                  onClick={() => void handleStartPortableUpdate()}
                >
                  <Download className="w-4 h-4" />
                  {isStartingUpdate ? '下载中...' : '开始更新'}
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="console" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">运行日志</h3>
                <p className="text-xs text-muted-foreground">
                  显示主进程输出的错误与关键事件，日志文件会写入数据目录。
                </p>
              </div>

              <div className="rounded-lg border border-border/70 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">数据目录</p>
                <p className="text-[11px] font-mono break-all text-foreground">
                  {state.dataDirectoryPath || dataFilePathInput || '-'}
                </p>
                <p className="text-xs text-muted-foreground mt-2">日志文件</p>
                <p className="text-[11px] font-mono break-all text-foreground">
                  {state.logFilePath || '-'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyLogs()} className="gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  复制日志
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={isClearingLogs}
                  onClick={() => void handleClearLogs()}
                  className="gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isClearingLogs ? '清空中...' : '清空日志'}
                </Button>
              </div>

              <div className="rounded-lg border border-border/70 p-2 max-h-[440px] overflow-auto bg-secondary/10">
                {state.diagnosticLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">暂无日志</p>
                ) : (
                  <div className="space-y-1.5">
                    {[...state.diagnosticLogs]
                      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
                      .map(item => (
                        <div key={item.id} className="rounded border border-border/60 p-2 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{new Date(item.occurredAt).toLocaleString('zh-CN')}</span>
                            <span
                              className={
                                item.level === 'error'
                                  ? 'text-destructive'
                                  : item.level === 'warn'
                                    ? 'text-amber-500'
                                    : 'text-muted-foreground'
                              }
                            >
                              {item.level.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-foreground break-all">{item.message}</p>
                          {item.detail ? <p className="text-muted-foreground break-all">{item.detail}</p> : null}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

