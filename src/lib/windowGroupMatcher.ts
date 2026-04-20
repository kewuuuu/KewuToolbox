import { ObjectType, WindowClassificationProfile, WindowGroupItem } from '@/types';

export type WindowGroupMatchCandidate = Pick<
  WindowClassificationProfile,
  'classificationKey' | 'displayName' | 'objectType' | 'processName' | 'normalizedTitle' | 'domain'
>;

function normalizePatternInput(input: unknown) {
  return typeof input === 'string' ? input.trim() : '';
}

function wildcardToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexBody}$`, 'i');
}

export function wildcardMatch(pattern: unknown, value: unknown) {
  const normalizedPattern = normalizePatternInput(pattern);
  const normalizedValue = typeof value === 'string' ? value : '';
  if (!normalizedPattern || !normalizedValue) {
    return false;
  }
  try {
    return wildcardToRegExp(normalizedPattern).test(normalizedValue);
  } catch {
    return false;
  }
}

function normalizeObjectType(typePattern: unknown): ObjectType | null {
  const normalized = normalizePatternInput(typePattern).toLowerCase();
  if (normalized === 'appwindow') {
    return 'AppWindow';
  }
  if (normalized === 'browsertab') {
    return 'BrowserTab';
  }
  if (normalized === 'desktop') {
    return 'Desktop';
  }
  return null;
}

function matchesBrowserNamePattern(
  namePattern: string,
  candidate: WindowGroupMatchCandidate,
) {
  if (!namePattern) {
    return true;
  }

  const valueSet = new Set<string>();
  const push = (value?: string) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      return;
    }
    valueSet.add(normalized);
    valueSet.add(normalized.replace(/^https?:\/\//i, ''));
  };

  push(candidate.normalizedTitle);
  push(candidate.displayName);
  push(candidate.domain);
  if (candidate.domain) {
    push(`https://${candidate.domain}`);
    push(`http://${candidate.domain}`);
  }

  for (const value of valueSet) {
    if (wildcardMatch(namePattern, value)) {
      return true;
    }
  }
  return false;
}

function matchesGenericNamePattern(
  namePattern: string,
  candidate: WindowGroupMatchCandidate,
) {
  if (!namePattern) {
    return true;
  }
  return (
    wildcardMatch(namePattern, candidate.displayName) ||
    wildcardMatch(namePattern, candidate.normalizedTitle)
  );
}

export function matchesWindowGroupItem(
  item: WindowGroupItem,
  candidate: WindowGroupMatchCandidate | null | undefined,
) {
  if (!candidate) {
    return false;
  }

  const hasPatternFields = Boolean(item.namePattern || item.typePattern || item.processPattern);
  const mode = item.matchMode ?? (hasPatternFields ? 'pattern' : 'exact');

  if (mode === 'exact') {
    return item.classificationKey === candidate.classificationKey;
  }

  const namePattern = normalizePatternInput(item.namePattern);
  const typePattern = normalizePatternInput(item.typePattern);
  const processPattern = normalizePatternInput(item.processPattern);
  const canonicalType = normalizeObjectType(typePattern);

  if (typePattern && !wildcardMatch(typePattern, candidate.objectType)) {
    return false;
  }

  const processIgnored = canonicalType === 'BrowserTab';
  if (!processIgnored && processPattern && !wildcardMatch(processPattern, candidate.processName)) {
    return false;
  }

  if (canonicalType === 'BrowserTab') {
    return matchesBrowserNamePattern(namePattern, candidate);
  }

  if (candidate.objectType === 'BrowserTab') {
    return (
      matchesBrowserNamePattern(namePattern, candidate) ||
      matchesGenericNamePattern(namePattern, candidate)
    );
  }

  return matchesGenericNamePattern(namePattern, candidate);
}

export function matchesAnyWindowGroup(
  windowGroup: WindowGroupItem[],
  candidate: WindowGroupMatchCandidate | null | undefined,
) {
  if (!Array.isArray(windowGroup) || windowGroup.length === 0 || !candidate) {
    return false;
  }
  return windowGroup.some(item => matchesWindowGroupItem(item, candidate));
}

export function formatWindowGroupItemType(typePattern: string | undefined, fallback?: ObjectType) {
  const canonical = normalizeObjectType(typePattern);
  if (canonical) {
    return canonical;
  }
  return fallback || '任意';
}
