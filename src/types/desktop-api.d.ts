import { AppState, AppUserState } from '@/types';

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

  interface Window {
    desktopApi?: {
      isElectron: boolean;
      getState: () => Promise<AppState>;
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
      onUpdateProgress: (callback: (progress: UpdateProgressEvent) => void) => () => void;
      onState: (callback: (nextState: AppState) => void) => () => void;
    };
  }
}

export {};
