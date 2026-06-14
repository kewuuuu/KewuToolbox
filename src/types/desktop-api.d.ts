import type { AppState, AppUserState } from '@/types';
import type { MonitoringDerivedRow, MonitoringDerivedTagStat } from '@/lib/analyticsReadModel';

declare global {
  interface SetDataFilePathResult {
    ok: boolean;
    path?: string;
    error?: 'invalid_path' | 'path_not_writable' | 'invalid_json' | 'create_failed';
    requiresCreate?: boolean;
    existed?: boolean;
    created?: boolean;
    state?: AppState;
  }

  interface UpdateCheckResult {
    ok: boolean;
    error?: string;
    detail?: string;
    currentVersion?: string;
    latestVersion?: string;
    hasUpdate?: boolean;
    releaseName?: string;
    releaseUrl?: string;
    releaseNotes?: string;
    publishedAt?: string;
    assetName?: string;
    assetUrl?: string;
    assetSize?: number;
    sha256Name?: string;
    sha256Url?: string;
    repositoryUrl?: string;
    updateSource?: 'github_api' | 'github_redirect' | string;
    apiFailureDetail?: string;
  }

  interface StartPortableUpdateResult {
    ok: boolean;
    error?: string;
    detail?: string;
    targetPath?: string;
    updaterPath?: string;
    downloadedPath?: string;
    expectedSha256?: string;
  }

  interface UpdateProgressEvent {
    phase?: string;
    status?: 'running' | 'success' | 'failed' | string;
    percent?: number;
    transferredBytes?: number;
    totalBytes?: number;
    message?: string;
    updatedAt?: string;
  }

  interface ActivityDataResult {
    ok: boolean;
    range: {
      startMs: number;
      endMs: number;
      limit: number;
    };
    sessions: AppState['sessions'];
    processTimeline: AppState['processTimeline'];
    inputActivityTimeline: AppState['inputActivityTimeline'];
  }

  interface MonitoringSummaryResult {
    ok: boolean;
    historyRows: MonitoringDerivedRow[];
    currentRows: MonitoringDerivedRow[];
    historyTotal?: number;
    currentTotal?: number;
    page?: number;
    pageSize?: number;
    tagStats: MonitoringDerivedTagStat[];
  }

  interface AnalyticsSummaryResult {
    ok: boolean;
    range: {
      startDate: string;
      endDate: string;
      startMs: number;
      endMs: number;
    };
    focus: {
      distribution: {
        category: Array<{ name: string; seconds: number; minutes: number }>;
        window: Array<{ name: string; seconds: number; minutes: number }>;
      };
      trend: {
        category: {
          data: Array<Record<string, string | number>>;
          series: Array<{ key: string; name: string; totalSeconds: number }>;
        };
        window: {
          data: Array<Record<string, string | number>>;
          series: Array<{ key: string; name: string; totalSeconds: number }>;
        };
      };
      heatmap: Array<{ date: string; seconds: number; minutes: number }>;
      hourly: {
        category: {
          data: Array<Record<string, string | number>>;
          series: Array<{ key: string; name: string }>;
        };
        window: {
          data: Array<Record<string, string | number>>;
          series: Array<{ key: string; name: string }>;
        };
      };
      timelineItems: Array<{
        id: string;
        type: 'focus' | 'power';
        label: string;
        detail: string;
        category?: string;
        startMs: number;
        endMs: number;
        durationSeconds: number;
        markerColor?: string;
      }>;
      metrics: {
        objectCount: number;
        longestContinuousFocusSeconds: number;
      };
    };
    input: {
      rows: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
      trend: Array<{ date: string; label: string; value: number }>;
    };
  }

  interface StorageStatusResult {
    ok: boolean;
    dataDirectoryPath?: string;
    dbPath?: string;
    schemaVersion?: number;
    sizeBytes?: number;
    counts?: {
      sections: number;
      sessions: number;
      processTimeline: number;
      inputActivityTimeline: number;
      focusDailyCache?: number;
      inputDailyCache?: number;
      monitoringSummaryCache?: number;
      clipboardHistory?: number;
    };
    cacheHealth?: {
      focus?: {
        sourceCount: number;
        cachedSourceCount: number;
        missingSourceCount: number;
        staleSourceCount: number;
        ok: boolean;
      };
      input?: {
        sourceCount: number;
        cachedSourceCount: number;
        missingSourceCount: number;
        staleSourceCount: number;
        ok: boolean;
      };
      monitoringSummary?: {
        ok: boolean;
        mergeGapMs: number;
        cachedMergeGapMs: number;
        sourceSessionCount: number;
        cachedSessionCount: number;
        sourceSessionMaxEndMs: number;
        cachedSessionMaxEndMs: number;
        sourceProcessTimelineCount: number;
        cachedProcessTimelineCount: number;
        sourceProcessTimelineMaxEndMs: number;
        cachedProcessTimelineMaxEndMs: number;
        rowCount: number;
        missingSessionCount: number;
        missingProcessTimelineCount: number;
      };
    };
    legacy?: {
      hasLegacyJson: boolean;
      legacyStateFile: string;
      sectionFileCount: number;
    };
  }

  interface StorageMigrationResult {
    ok: boolean;
    error?: 'no_legacy_json' | 'write_failed' | string;
    state?: AppState;
    status?: StorageStatusResult;
  }

  interface AnalyticsCacheRebuildResult {
    ok: boolean;
    error?: string;
    focusSourceCount?: number;
    inputSourceCount?: number;
    focusDailyCache?: number;
    inputDailyCache?: number;
    monitoringSummaryCache?: {
      ok: boolean;
      rowCount: number;
      sourceSessionCount: number;
      sourceProcessTimelineCount: number;
      sourceSessionMaxEndMs: number;
      sourceProcessTimelineMaxEndMs: number;
      mergeGapMs: number;
      updatedAtMs: number;
    };
    status?: StorageStatusResult;
  }

  type ClipboardSnapshotKind = 'text' | 'image' | 'other';

  interface ClipboardImagePayload {
    dataUrl: string;
    thumbnailDataUrl?: string;
    filePath?: string;
    width: number;
    height: number;
    type: string;
    byteLength?: number;
  }

  interface ClipboardSnapshot {
    id: string;
    kind: ClipboardSnapshotKind;
    capturedAt: string;
    lastSeenAt?: string;
    seenCount?: number;
    signature?: string;
    title?: string;
    formats?: string[];
    text?: string;
    image?: ClipboardImagePayload;
    details?: Array<{ name: string; value?: string; byteLength?: number; digest?: string }>;
  }

  interface WriteClipboardResult {
    ok: boolean;
    error?: string;
    detail?: string;
  }

  interface Window {
    desktopApi?: {
      isElectron: boolean;
      getState: () => Promise<AppState>;
      getActivityData: (payload: {
        startMs: number;
        endMs: number;
        limit?: number;
      }) => Promise<ActivityDataResult>;
      getActivityDateKeys: () => Promise<string[]>;
      getAnalyticsSummary: (payload: {
        startDate: string;
        endDate: string;
        heatmapCategory?: string;
        inputMetric?: string;
        windowLimit?: number;
        timelineLimit?: number;
      }) => Promise<AnalyticsSummaryResult>;
      getMonitoringSummary: (payload?: {
        scope?: 'history' | 'current';
        page?: number;
        pageSize?: number;
        sort?: {
          key: string;
          direction: 'asc' | 'desc';
        };
        limit?: number;
      }) => Promise<MonitoringSummaryResult>;
      deleteMonitoringRecords: (payload: { classificationKeys: string[] }) => Promise<{
        ok: boolean;
        changedCount: number;
        state: AppState;
      }>;
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
      startPortableUpdate: (payload: {
        assetUrl: string;
        sha256Url: string;
        assetName?: string;
      }) => Promise<StartPortableUpdateResult>;
      openExternalUrl: (payload: { url: string }) => Promise<{ ok: boolean; error?: string }>;
      getDataFilePath: () => Promise<string>;
      getStorageStatus: () => Promise<StorageStatusResult>;
      migrateLegacyJsonStorage: () => Promise<StorageMigrationResult>;
      rebuildAnalyticsCache: () => Promise<AnalyticsCacheRebuildResult>;
      setDataFilePath: (payload: {
        targetPath: string;
        createIfMissing?: boolean;
      }) => Promise<SetDataFilePathResult>;
      selectDataFilePath: () => Promise<string | null>;
      saveUserState: (partial: Partial<AppUserState>) => Promise<{ ok: boolean }>;
      mergeRecordsByWhitelist: () => Promise<{ ok: boolean; changedCount: number; state: AppState }>;
      clearAllData: () => Promise<AppState>;
      clearDiagnosticLogs: () => Promise<{ ok: boolean }>;
      notify: (payload: { title: string; body?: string }) => Promise<{ ok: boolean; error?: string }>;
      hideToTray: () => Promise<{ ok: boolean }>;
      selectAudioFile: () => Promise<string | null>;
      getClipboardCurrent: () => Promise<ClipboardSnapshot>;
      getClipboardHistory: () => Promise<ClipboardSnapshot[]>;
      restoreClipboardHistoryItem: (payload: { id: string }) => Promise<WriteClipboardResult>;
      writeClipboardItem: (payload: {
        kind: 'text' | 'image';
        text?: string;
        dataUrl?: string;
      }) => Promise<WriteClipboardResult>;
      onClipboardChanged: (callback: (payload: {
        current?: ClipboardSnapshot;
        history?: ClipboardSnapshot[];
      }) => void) => () => void;
      onUpdateProgress: (callback: (progress: UpdateProgressEvent) => void) => () => void;
      onState: (callback: (nextState: AppState) => void) => () => void;
    };
  }
}

export {};
