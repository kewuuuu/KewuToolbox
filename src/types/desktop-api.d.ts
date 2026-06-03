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
      }) => Promise<StartPortableUpdateResult>;
      openExternalUrl: (payload: { url: string }) => Promise<{ ok: boolean; error?: string }>;
      getDataFilePath: () => Promise<string>;
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
      onState: (callback: (nextState: AppState) => void) => () => void;
    };
  }
}

export {};
