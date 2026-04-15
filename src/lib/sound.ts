import { PomodoroSettings, SoundBalanceCache, SoundFileItem } from '@/types';

export type SoundEventType = 'completion' | 'distraction' | 'countdown';

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

function toPositiveFinite(value: number | undefined, fallback: number) {
  const parsed = toFinite(value, fallback);
  if (parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toLinearFromDb(db: number) {
  return Math.pow(10, db / 20);
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

export type SoundLoudnessAnalysis = {
  measuredAverageDb: number;
  measuredPeakDb: number;
  durationSeconds: number;
};

export async function analyzeSoundFileLoudness(filePath: string): Promise<SoundLoudnessAnalysis> {
  const source = toPlayableAudioSource(filePath);
  if (!source) {
    throw new Error('missing_sound_path');
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`sound_fetch_failed:${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('audio_context_unavailable');
  }

  const context = new AudioCtx();
  try {
    const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
    let sumSquares = 0;
    let totalSamples = 0;
    let peak = 0;

    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const channelData = buffer.getChannelData(channelIndex);
      totalSamples += channelData.length;
      for (let i = 0; i < channelData.length; i += 1) {
        const sample = channelData[i];
        sumSquares += sample * sample;
        const absSample = Math.abs(sample);
        if (absSample > peak) {
          peak = absSample;
        }
      }
    }

    const rms = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;
    const measuredAverageDb = rms > 0 ? 20 * Math.log10(rms) : -160;
    const measuredPeakDb = peak > 0 ? 20 * Math.log10(peak) : -160;

    return {
      measuredAverageDb,
      measuredPeakDb,
      durationSeconds: Number.isFinite(buffer.duration) ? Math.max(0, buffer.duration) : 0,
    };
  } finally {
    void context.close();
  }
}

export function calculateBalancedGainFromAnalysis(analysis: SoundLoudnessAnalysis, targetDb: number) {
  const safeTargetDb = Number.isFinite(targetDb) ? targetDb : -18;
  const averageLinear = toLinearFromDb(analysis.measuredAverageDb);
  const peakLinear = toLinearFromDb(analysis.measuredPeakDb);
  const targetLinear = toLinearFromDb(safeTargetDb);
  const gainByAverage = averageLinear > 0 ? targetLinear / averageLinear : 1;
  const gainByPeakSafety = peakLinear > 0 ? 0.98 / peakLinear : gainByAverage;
  const normalizedGain = Math.min(gainByAverage, gainByPeakSafety);
  if (!Number.isFinite(normalizedGain) || normalizedGain <= 0) {
    return 1;
  }
  return normalizedGain;
}

function isBalanceCacheValid(
  cache: SoundBalanceCache | undefined,
  expectedSoundId: string,
  expectedTargetDb: number,
  expectedSoundUpdatedAt: string | undefined,
) {
  if (!cache) {
    return false;
  }
  if (cache.soundFileId !== expectedSoundId) {
    return false;
  }
  if (Math.abs(cache.targetDb - expectedTargetDb) > 0.0001) {
    return false;
  }
  if (
    typeof expectedSoundUpdatedAt === 'string' &&
    expectedSoundUpdatedAt &&
    cache.soundFileUpdatedAt !== expectedSoundUpdatedAt
  ) {
    return false;
  }
  return Number.isFinite(cache.normalizedGain) && cache.normalizedGain > 0;
}

export type ResolvedSoundPlayback = {
  soundFileId: string;
  eventVolumeMultiplier: number;
  volumeMode: 'unbalanced' | 'balanced';
  cacheReady: boolean;
  targetDb?: number;
};

export function resolveSoundPlaybackForEvent(
  settings: PomodoroSettings,
  soundFiles: SoundFileItem[],
  eventType: SoundEventType,
): ResolvedSoundPlayback {
  if (eventType === 'completion') {
    const soundFileId = settings.completionSoundFileId;
    const volumeMode = settings.completionVolumeMode;
    const soundFile = soundFiles.find(item => item.id === soundFileId);
    if (volumeMode === 'balanced') {
      const targetDb = toFinite(settings.completionBalancedTargetDb, -18);
      const cacheReady = isBalanceCacheValid(
        settings.completionBalanceCache,
        soundFileId,
        targetDb,
        soundFile?.updatedAt,
      );
      return {
        soundFileId,
        eventVolumeMultiplier: cacheReady
          ? toPositiveFinite(settings.completionBalanceCache?.normalizedGain, 1)
          : 1,
        volumeMode,
        cacheReady,
        targetDb,
      };
    }
    return {
      soundFileId,
      eventVolumeMultiplier: toPositiveFinite(settings.completionVolumeMultiplier, 1),
      volumeMode,
      cacheReady: true,
    };
  }

  if (eventType === 'distraction') {
    const soundFileId = settings.distractionSoundFileId;
    const volumeMode = settings.distractionVolumeMode;
    const soundFile = soundFiles.find(item => item.id === soundFileId);
    if (volumeMode === 'balanced') {
      const targetDb = toFinite(settings.distractionBalancedTargetDb, -18);
      const cacheReady = isBalanceCacheValid(
        settings.distractionBalanceCache,
        soundFileId,
        targetDb,
        soundFile?.updatedAt,
      );
      return {
        soundFileId,
        eventVolumeMultiplier: cacheReady
          ? toPositiveFinite(settings.distractionBalanceCache?.normalizedGain, 1)
          : 1,
        volumeMode,
        cacheReady,
        targetDb,
      };
    }
    return {
      soundFileId,
      eventVolumeMultiplier: toPositiveFinite(settings.distractionVolumeMultiplier, 1),
      volumeMode,
      cacheReady: true,
    };
  }

  const soundFileId = settings.countdownSoundFileId;
  const volumeMode = settings.countdownVolumeMode;
  const soundFile = soundFiles.find(item => item.id === soundFileId);
  if (volumeMode === 'balanced') {
    const targetDb = toFinite(settings.countdownBalancedTargetDb, -18);
    const cacheReady = isBalanceCacheValid(
      settings.countdownBalanceCache,
      soundFileId,
      targetDb,
      soundFile?.updatedAt,
    );
    return {
      soundFileId,
      eventVolumeMultiplier: cacheReady ? toPositiveFinite(settings.countdownBalanceCache?.normalizedGain, 1) : 1,
      volumeMode,
      cacheReady,
      targetDb,
    };
  }
  return {
    soundFileId,
    eventVolumeMultiplier: toPositiveFinite(settings.countdownVolumeMultiplier, 1),
    volumeMode,
    cacheReady: true,
  };
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
    toPositiveFinite(sound.defaultVolumeMultiplier, 1) *
    toPositiveFinite(options.eventVolumeMultiplier, 1);
  await playSoundFile(sound.filePath, finalMultiplier);
}
