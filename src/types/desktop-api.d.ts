import { AppState, AppUserState } from '@/types';

declare global {
  interface Window {
    desktopApi?: {
      isElectron: boolean;
      getState: () => Promise<AppState>;
      saveUserState: (partial: Partial<AppUserState>) => Promise<{ ok: boolean }>;
      onState: (callback: (nextState: AppState) => void) => () => void;
    };
  }
}

export {};
