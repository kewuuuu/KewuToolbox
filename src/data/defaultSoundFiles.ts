import { SoundFileItem } from '@/types';

export const BUILTIN_COMPLETION_SOUND_ID = 'builtin-completion';
export const BUILTIN_WARNING_SOUND_ID = 'builtin-warning';

export function createDefaultSoundFiles(now = new Date().toISOString()): SoundFileItem[] {
  return [
    {
      id: BUILTIN_COMPLETION_SOUND_ID,
      name: '系统提示音（到点）',
      filePath: 'sounds/builtin_completion.wav',
      defaultVolumeMultiplier: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BUILTIN_WARNING_SOUND_ID,
      name: '系统警告音（偏离）',
      filePath: 'sounds/builtin_warning.wav',
      defaultVolumeMultiplier: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];
}
