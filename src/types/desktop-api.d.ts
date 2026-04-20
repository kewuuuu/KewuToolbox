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

  interface Window {
    desktopApi?: {
      isElectron: boolean;
      getState: () => Promise<AppState>;
      getAppVersion: () => Promise<string>;
      openExternalUrl: (payload: { url: string }) => Promise<{ ok: boolean; error?: string }>;
      getDataFilePath: () => Promise<string>;
      setDataFilePath: (payload: {
        targetPath: string;
        createIfMissing?: boolean;
      }) => Promise<SetDataFilePathResult>;
      selectDataFilePath: () => Promise<string | null>;
      saveUserState: (partial: Partial<AppUserState>) => Promise<{ ok: boolean }>;
      clearAllData: () => Promise<AppState>;
      notify: (payload: { title: string; body?: string }) => Promise<{ ok: boolean; error?: string }>;
      hideToTray: () => Promise<{ ok: boolean }>;
      selectAudioFile: () => Promise<string | null>;
      onState: (callback: (nextState: AppState) => void) => () => void;
    };
  }
}

export {};
