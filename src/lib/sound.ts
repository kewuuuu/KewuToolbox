import { SoundFileItem } from '@/types';

function toPlayableAudioSource(inputPath: string) {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('file://')) {
    return trimmed;
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    const normalized = trimmed.replace(/\\/g, '/');
    return `file:///${encodeURI(normalized)}`;
  }
  if (trimmed.startsWith('/')) {
    return `file://${encodeURI(trimmed)}`;
  }
  return trimmed;
}

function toFinite(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function getSoundDisplayNameFromPath(filePath: string) {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '未命名提示音';
  }
  const normalized = trimmed.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1] || trimmed;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex > 0) {
    return fileName.slice(0, dotIndex);
  }
  return fileName;
}

export async function playSoundFile(filePath: string, volumeMultiplier = 1) {
  const source = toPlayableAudioSource(filePath);
  if (!source) {
    throw new Error('missing_sound_path');
  }

  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    const audio = new Audio(source);
    audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, toFinite(volumeMultiplier, 1)));
    await audio.play();
    return;
  }

  const context = new AudioCtx();
  const audio = new Audio(source);
  audio.preload = 'auto';
  audio.currentTime = 0;

  const mediaNode = context.createMediaElementSource(audio);
  const gainNode = context.createGain();
  gainNode.gain.value = toFinite(volumeMultiplier, 1);
  mediaNode.connect(gainNode);
  gainNode.connect(context.destination);

  const cleanup = () => {
    window.setTimeout(() => void context.close(), 120);
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;

  await audio.play();
}

export type PlaySoundByIdOptions = {
  enabled?: boolean;
  soundFileId: string;
  eventVolumeMultiplier?: number;
};

export async function playSoundById(
  soundFiles: SoundFileItem[],
  options: PlaySoundByIdOptions,
) {
  if (options.enabled === false) {
    return;
  }
  const sound = soundFiles.find(item => item.id === options.soundFileId);
  if (!sound) {
    return;
  }
  const finalMultiplier =
    toFinite(sound.defaultVolumeMultiplier, 1) *
    toFinite(options.eventVolumeMultiplier, 1);
  await playSoundFile(sound.filePath, finalMultiplier);
}
