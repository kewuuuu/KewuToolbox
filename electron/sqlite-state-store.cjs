const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SQLITE_FILE_NAME = 'kewu-toolbox.sqlite';
const SCHEMA_VERSION = 2;
const TABLE_SECTION_KEYS = new Set(['sessions', 'processTimeline', 'inputActivityTimeline']);
const DEFAULT_CLIPBOARD_HISTORY_LIMIT = 300;
const DEFAULT_ACTIVITY_QUERY_LIMIT = 120000;

async function initializeSqliteEngine() {
  return true;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toTimeMs(value) {
  const time = typeof value === 'string' ? new Date(value).getTime() : Number(value);
  return Number.isFinite(time) ? time : 0;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value) {
  return typeof value === 'string' ? value : '';
}

function toJsonPayload(value) {
  return JSON.stringify(value ?? null);
}

function normalizeLimit(value, fallback = DEFAULT_CLIPBOARD_HISTORY_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(5000, Math.floor(parsed)));
}

function normalizeActivityLimit(value, fallback = DEFAULT_ACTIVITY_QUERY_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(500000, Math.floor(parsed)));
}

function toLocalDateKey(value) {
  const time = toTimeMs(value);
  if (time <= 0) {
    return '';
  }
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDateMs(dateKey) {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!parsed) {
    return 0;
  }
  return new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])).getTime();
}

function splitDurationByLocalDay(startMs, endMs, totalSeconds) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }
  const totalMs = Math.max(1, endMs - startMs);
  const normalizedTotalSeconds = Math.max(0, Number(totalSeconds) || totalMs / 1000);
  const output = [];
  let cursorMs = startMs;
  while (cursorMs < endMs) {
    const dateKey = toLocalDateKey(cursorMs);
    const dayStartMs = startOfLocalDateMs(dateKey);
    const nextDayMs = dayStartMs + 24 * 60 * 60 * 1000;
    const sliceEndMs = Math.min(endMs, nextDayMs);
    output.push({
      dateKey,
      seconds: normalizedTotalSeconds * ((sliceEndMs - cursorMs) / totalMs),
    });
    cursorMs = sliceEndMs;
  }
  return output.filter(item => item.dateKey && item.seconds > 0);
}

function pickInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function hashString(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeBindParams(params) {
  if (params === undefined) {
    return [];
  }
  if (Array.isArray(params)) {
    return params;
  }
  return [params];
}

class NativeStatementAdapter {
  constructor(statement, onRun) {
    this.statement = statement;
    this.onRun = onRun;
    this.boundParams = [];
    this.iterator = null;
    this.current = null;
  }

  bind(params) {
    this.closeIterator();
    this.boundParams = normalizeBindParams(params);
    this.current = null;
  }

  closeIterator() {
    if (this.iterator && typeof this.iterator.return === 'function') {
      try {
        this.iterator.return();
      } catch {
        // Ignore iterator cleanup failures.
      }
    }
    this.iterator = null;
  }

  step() {
    if (!this.iterator) {
      this.iterator = this.statement.raw().iterate(...this.boundParams)[Symbol.iterator]();
    }
    const next = this.iterator.next();
    if (next.done) {
      this.current = null;
      this.closeIterator();
      return false;
    }
    this.current = next.value;
    return true;
  }

  get() {
    return this.current || [];
  }

  run(params) {
    const info = this.statement.run(...normalizeBindParams(params));
    this.onRun(Number(info?.changes || 0));
    return info;
  }

  free() {
    this.closeIterator();
    this.current = null;
  }
}

class NativeDatabaseAdapter {
  constructor(dbPath) {
    this.native = new Database(dbPath);
    this.lastChanges = 0;
    this.native.pragma('journal_mode = WAL');
    this.native.pragma('synchronous = NORMAL');
    this.native.pragma('busy_timeout = 5000');
  }

  run(sql, params) {
    if (params !== undefined) {
      const info = this.native.prepare(sql).run(...normalizeBindParams(params));
      this.lastChanges = Number(info?.changes || 0);
      return info;
    }
    this.native.exec(sql);
    this.lastChanges = 0;
    return undefined;
  }

  exec(sql) {
    const statement = this.native.prepare(sql);
    const columns = statement.columns().map(column => column.name);
    const values = statement.raw().all();
    return values.length > 0 ? [{ columns, values }] : [];
  }

  all(sql, params) {
    return this.native.prepare(sql).all(...normalizeBindParams(params));
  }

  prepare(sql) {
    return new NativeStatementAdapter(this.native.prepare(sql), changes => {
      this.lastChanges = changes;
    });
  }

  getRowsModified() {
    return this.lastChanges;
  }

  checkpoint() {
    try {
      this.native.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // Checkpoint is a best-effort optimization.
    }
  }

  close() {
    this.checkpoint();
    this.native.close();
  }
}

class SqliteStateStore {
  constructor(dataDirPath, sectionKeys) {
    this.dataDirPath = dataDirPath;
    this.sectionKeys = sectionKeys;
    this.dbPath = path.join(dataDirPath, SQLITE_FILE_NAME);
    this.db = null;
  }

  open() {
    ensureDir(this.dataDirPath);
    this.db = new NativeDatabaseAdapter(this.dbPath);
    this.applySchema();
    this.flush();
  }

  close() {
    if (!this.db) {
      return;
    }
    this.flush();
    this.db.close();
    this.db = null;
  }

  hasDatabaseFile() {
    return fs.existsSync(this.dbPath);
  }

  applySchema() {
    this.db.run(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state_sections (
        section_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        classification_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        domain TEXT,
        category_at_that_time TEXT,
        start_at_ms INTEGER NOT NULL,
        end_at_ms INTEGER NOT NULL,
        duration_seconds REAL NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_focus_sessions_time
        ON focus_sessions(start_at_ms, end_at_ms);
      CREATE INDEX IF NOT EXISTS idx_focus_sessions_key_time
        ON focus_sessions(classification_key, start_at_ms, end_at_ms);

      CREATE TABLE IF NOT EXISTS process_timeline (
        id TEXT PRIMARY KEY,
        classification_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        domain TEXT,
        category_at_that_time TEXT,
        start_at_ms INTEGER NOT NULL,
        end_at_ms INTEGER NOT NULL,
        duration_seconds REAL NOT NULL,
        is_open INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_process_timeline_time
        ON process_timeline(start_at_ms, end_at_ms);
      CREATE INDEX IF NOT EXISTS idx_process_timeline_key_time
        ON process_timeline(classification_key, start_at_ms, end_at_ms);

      CREATE TABLE IF NOT EXISTS input_activity_timeline (
        id TEXT PRIMARY KEY,
        classification_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        domain TEXT,
        bucket_start_ms INTEGER NOT NULL,
        bucket_end_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_input_activity_timeline_time
        ON input_activity_timeline(bucket_start_ms, bucket_end_ms);
      CREATE INDEX IF NOT EXISTS idx_input_activity_timeline_key_time
        ON input_activity_timeline(classification_key, bucket_start_ms, bucket_end_ms);

      CREATE TABLE IF NOT EXISTS focus_daily_cache (
        source_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        classification_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        category_at_that_time TEXT,
        seconds REAL NOT NULL,
        PRIMARY KEY (source_id, date_key)
      );

      CREATE INDEX IF NOT EXISTS idx_focus_daily_cache_date
        ON focus_daily_cache(date_key, classification_key);
      CREATE INDEX IF NOT EXISTS idx_focus_daily_cache_key_date
        ON focus_daily_cache(classification_key, date_key);

      CREATE TABLE IF NOT EXISTS input_daily_cache (
        source_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        classification_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        key_presses INTEGER NOT NULL DEFAULT 0,
        left_clicks INTEGER NOT NULL DEFAULT 0,
        right_clicks INTEGER NOT NULL DEFAULT 0,
        middle_clicks INTEGER NOT NULL DEFAULT 0,
        side_back_clicks INTEGER NOT NULL DEFAULT 0,
        side_forward_clicks INTEGER NOT NULL DEFAULT 0,
        scroll_ticks INTEGER NOT NULL DEFAULT 0,
        mouse_move_pixels INTEGER NOT NULL DEFAULT 0,
        key_counts_json TEXT NOT NULL,
        last_at_ms INTEGER NOT NULL,
        PRIMARY KEY (source_id, date_key)
      );

      CREATE INDEX IF NOT EXISTS idx_input_daily_cache_date
        ON input_daily_cache(date_key, classification_key);
      CREATE INDEX IF NOT EXISTS idx_input_daily_cache_key_date
        ON input_daily_cache(classification_key, date_key);

      CREATE TABLE IF NOT EXISTS monitoring_summary_cache (
        classification_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        process_name TEXT NOT NULL,
        category_at_that_time TEXT,
        total_visible_seconds REAL NOT NULL DEFAULT 0,
        focus_seconds REAL NOT NULL DEFAULT 0,
        last_focus_ms INTEGER NOT NULL DEFAULT 0,
        longest_continuous_focus_seconds REAL NOT NULL DEFAULT 0,
        merge_gap_ms INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_monitoring_summary_cache_sort
        ON monitoring_summary_cache(merge_gap_ms, focus_seconds DESC, last_focus_ms DESC);

      CREATE TABLE IF NOT EXISTS clipboard_history (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        signature TEXT NOT NULL UNIQUE,
        captured_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        title TEXT,
        text TEXT,
        image_data_url TEXT,
        image_file_path TEXT,
        image_width INTEGER,
        image_height INTEGER,
        image_type TEXT,
        image_byte_length INTEGER,
        formats_json TEXT NOT NULL,
        details_json TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clipboard_history_captured_at
        ON clipboard_history(captured_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_clipboard_history_kind_time
        ON clipboard_history(kind, captured_at_ms DESC);
    `);

    this.tryRunSchemaPatch('ALTER TABLE clipboard_history ADD COLUMN image_file_path TEXT');

    this.upsertMeta('schema_version', String(SCHEMA_VERSION));
  }

  tryRunSchemaPatch(sql) {
    try {
      this.db.run(sql);
    } catch {
      // SQLite does not support IF NOT EXISTS for ADD COLUMN on older runtimes.
    }
  }

  upsertMeta(key, value) {
    this.db.run(
      `INSERT INTO meta (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  readMeta(key, fallback = '') {
    const row = this.db.all('SELECT value FROM meta WHERE key = ? LIMIT 1', [key])[0];
    return typeof row?.value === 'string' ? row.value : fallback;
  }

  countRows(tableName) {
    const result = this.db.exec(`SELECT COUNT(*) AS count FROM ${tableName}`);
    return Number(result[0]?.values?.[0]?.[0] || 0);
  }

  countDistinctRows(tableName, columnName) {
    const result = this.db.exec(`SELECT COUNT(DISTINCT ${columnName}) AS count FROM ${tableName}`);
    return Number(result[0]?.values?.[0]?.[0] || 0);
  }

  maxNumber(tableName, columnName) {
    const result = this.db.exec(`SELECT COALESCE(MAX(${columnName}), 0) AS value FROM ${tableName}`);
    return Number(result[0]?.values?.[0]?.[0] || 0);
  }

  readState() {
    return this.readStateWithOptions({ includeActivityTables: false });
  }

  readStateWithOptions(options = {}) {
    const state = {};
    let hasState = false;

    const sectionRows = this.db.exec('SELECT section_key, payload_json FROM state_sections');
    if (sectionRows[0]) {
      const columns = sectionRows[0].columns;
      const keyIndex = columns.indexOf('section_key');
      const payloadIndex = columns.indexOf('payload_json');
      for (const row of sectionRows[0].values) {
        const sectionKey = row[keyIndex];
        if (typeof sectionKey === 'string') {
          state[sectionKey] = safeJsonParse(row[payloadIndex], undefined);
          hasState = true;
        }
      }
    }

    if (options.includeActivityTables) {
      state.sessions = this.readPayloadRows('focus_sessions', 'start_at_ms');
      state.processTimeline = this.readPayloadRows('process_timeline', 'start_at_ms');
      state.inputActivityTimeline = this.readPayloadRows('input_activity_timeline', 'bucket_start_ms');
    } else {
      state.sessions = [];
      state.processTimeline = [];
      state.inputActivityTimeline = [];
    }
    hasState =
      hasState ||
      state.sessions.length > 0 ||
      state.processTimeline.length > 0 ||
      state.inputActivityTimeline.length > 0;

    return hasState ? state : null;
  }

  readPayloadRows(tableName, orderColumn) {
    const result = this.db.exec(`SELECT payload_json FROM ${tableName} ORDER BY ${orderColumn} ASC`);
    if (!result[0]) {
      return [];
    }
    return result[0].values
      .map(row => safeJsonParse(row[0], null))
      .filter(Boolean);
  }

  readPayloadRowsInRange(tableName, startColumn, endColumn, orderColumn, startMs, endMs, limit = DEFAULT_ACTIVITY_QUERY_LIMIT) {
    const normalizedStartMs = toNumber(startMs, 0);
    const normalizedEndMs = toNumber(endMs, Date.now());
    const normalizedLimit = normalizeActivityLimit(limit, DEFAULT_ACTIVITY_QUERY_LIMIT);
    const stmt = this.db.prepare(`
      SELECT payload_json
      FROM ${tableName}
      WHERE ${startColumn} < ? AND ${endColumn} > ?
      ORDER BY ${orderColumn} ASC
      LIMIT ?
    `);
    const rows = [];
    try {
      stmt.bind([normalizedEndMs, normalizedStartMs, normalizedLimit]);
      while (stmt.step()) {
        const payload = safeJsonParse(stmt.get()[0], null);
        if (payload) {
          rows.push(payload);
        }
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  readActivityRowsInRange(startMs, endMs, limit = DEFAULT_ACTIVITY_QUERY_LIMIT) {
    return {
      sessions: this.readPayloadRowsInRange('focus_sessions', 'start_at_ms', 'end_at_ms', 'start_at_ms', startMs, endMs, limit),
      processTimeline: this.readPayloadRowsInRange('process_timeline', 'start_at_ms', 'end_at_ms', 'start_at_ms', startMs, endMs, limit),
      inputActivityTimeline: this.readPayloadRowsInRange(
        'input_activity_timeline',
        'bucket_start_ms',
        'bucket_end_ms',
        'bucket_start_ms',
        startMs,
        endMs,
        limit,
      ),
    };
  }

  readAllMonitoringRows(limit = DEFAULT_ACTIVITY_QUERY_LIMIT) {
    const normalizedLimit = normalizeActivityLimit(limit, DEFAULT_ACTIVITY_QUERY_LIMIT);
    return {
      sessions: this.readPayloadRowsLimited('focus_sessions', 'start_at_ms', normalizedLimit),
      processTimeline: this.readPayloadRowsLimited('process_timeline', 'start_at_ms', normalizedLimit),
    };
  }

  readMonitoringAggregateRows(mergeGapSeconds = 0, options = {}) {
    const mergeGapMs = Math.max(0, toNumber(mergeGapSeconds, 0)) * 1000;
    const filterKeys = Array.isArray(options.classificationKeys)
      ? [...new Set(options.classificationKeys.map(key => toStringValue(key).trim()).filter(Boolean))]
      : null;
    if (!filterKeys && options.useCache !== false) {
      const cachedRows = this.readMonitoringSummaryCacheRowsIfHealthy(mergeGapMs);
      if (cachedRows) {
        return cachedRows;
      }
      try {
        this.rebuildMonitoringSummaryCache(mergeGapMs / 1000);
        const rebuiltRows = this.readMonitoringSummaryCacheRowsIfHealthy(mergeGapMs);
        if (rebuiltRows) {
          return rebuiltRows;
        }
      } catch {
        // Fall back to direct aggregation below.
      }
    }

    return this.computeMonitoringAggregateRows(mergeGapMs, filterKeys);
  }

  readMonitoringSummaryCacheRowsIfHealthy(mergeGapMs) {
    const status = this.getMonitoringSummaryCacheStatus(mergeGapMs);
    if (!status.ok) {
      return null;
    }
    if (status.sourceSessionCount === 0 && status.sourceProcessTimelineCount === 0) {
      return [];
    }
    return this.db.all(
      `
      SELECT
        classification_key AS classificationKey,
        display_name AS displayName,
        object_type AS objectType,
        process_name AS processName,
        category_at_that_time AS categoryAtThatTime,
        total_visible_seconds AS totalVisible,
        focus_seconds AS focusTime,
        last_focus_ms AS lastFocusMs,
        longest_continuous_focus_seconds AS longestContinuousFocus
      FROM monitoring_summary_cache
      WHERE merge_gap_ms = ?
      `,
      [mergeGapMs],
    );
  }

  getMonitoringSummaryCacheStatus(mergeGapMs = 0) {
    const normalizedMergeGapMs = Math.max(0, toNumber(mergeGapMs, 0));
    const sourceSessionCount = this.countRows('focus_sessions');
    const sourceProcessTimelineCount = this.countRows('process_timeline');
    const sourceSessionMaxEndMs = this.maxNumber('focus_sessions', 'end_at_ms');
    const sourceProcessTimelineMaxEndMs = this.maxNumber('process_timeline', 'end_at_ms');
    const cachedRowCount = this.countRows('monitoring_summary_cache');
    const cachedMergeGapMs = toNumber(this.readMeta('monitoring_summary_cache_merge_gap_ms', '-1'), -1);
    const cachedSessionCount = toNumber(this.readMeta('monitoring_summary_cache_session_count', '-1'), -1);
    const cachedProcessTimelineCount = toNumber(
      this.readMeta('monitoring_summary_cache_process_timeline_count', '-1'),
      -1,
    );
    const cachedSessionMaxEndMs = toNumber(this.readMeta('monitoring_summary_cache_session_max_end_ms', '-1'), -1);
    const cachedProcessTimelineMaxEndMs = toNumber(
      this.readMeta('monitoring_summary_cache_process_timeline_max_end_ms', '-1'),
      -1,
    );
    const emptySource = sourceSessionCount === 0 && sourceProcessTimelineCount === 0;
    return {
      ok: emptySource
        ? cachedRowCount === 0
        : cachedMergeGapMs === normalizedMergeGapMs &&
          cachedSessionCount === sourceSessionCount &&
          cachedProcessTimelineCount === sourceProcessTimelineCount &&
          cachedSessionMaxEndMs === sourceSessionMaxEndMs &&
          cachedProcessTimelineMaxEndMs === sourceProcessTimelineMaxEndMs,
      mergeGapMs: normalizedMergeGapMs,
      cachedMergeGapMs,
      sourceSessionCount,
      cachedSessionCount,
      sourceSessionMaxEndMs,
      cachedSessionMaxEndMs,
      sourceProcessTimelineCount,
      cachedProcessTimelineCount,
      sourceProcessTimelineMaxEndMs,
      cachedProcessTimelineMaxEndMs,
      rowCount: cachedRowCount,
      missingSessionCount: Math.max(0, sourceSessionCount - Math.max(0, cachedSessionCount)),
      missingProcessTimelineCount: Math.max(0, sourceProcessTimelineCount - Math.max(0, cachedProcessTimelineCount)),
    };
  }

  computeMonitoringAggregateRows(mergeGapMs = 0, filterKeys = null) {
    const makeClassificationFilter = () => {
      if (!filterKeys) {
        return { sql: '', params: [] };
      }
      if (filterKeys.length === 0) {
        return { sql: ' AND 1 = 0', params: [] };
      }
      return {
        sql: ` AND classification_key IN (${filterKeys.map(() => '?').join(', ')})`,
        params: filterKeys,
      };
    };
    const rows = new Map();

    const ensureRow = (classificationKey) => {
      const key = toStringValue(classificationKey);
      if (!key) {
        return null;
      }
      const existing = rows.get(key);
      if (existing) {
        return existing;
      }
      const next = {
        classificationKey: key,
        displayName: key,
        objectType: 'AppWindow',
        processName: 'unknown',
        categoryAtThatTime: '',
        totalVisible: 0,
        focusTime: 0,
        lastFocusMs: 0,
        longestContinuousFocus: 0,
      };
      rows.set(key, next);
      return next;
    };

    const metadataFilter = makeClassificationFilter();
    const metadataRows = this.db.all(`
      WITH combined AS (
        SELECT classification_key, display_name, object_type, process_name, category_at_that_time, end_at_ms AS seen_ms
        FROM process_timeline
        WHERE classification_key != ''${metadataFilter.sql}
        UNION ALL
        SELECT classification_key, display_name, object_type, process_name, category_at_that_time, end_at_ms AS seen_ms
        FROM focus_sessions
        WHERE classification_key != ''${metadataFilter.sql}
      ),
      ranked AS (
        SELECT
          classification_key,
          display_name,
          object_type,
          process_name,
          category_at_that_time,
          ROW_NUMBER() OVER (
            PARTITION BY classification_key
            ORDER BY seen_ms DESC
          ) AS rn
        FROM combined
      )
      SELECT
        classification_key AS classificationKey,
        display_name AS displayName,
        object_type AS objectType,
        process_name AS processName,
        category_at_that_time AS categoryAtThatTime
      FROM ranked
      WHERE rn = 1
    `, [...metadataFilter.params, ...metadataFilter.params]);

    for (const item of metadataRows) {
      const row = ensureRow(item.classificationKey);
      if (!row) {
        continue;
      }
      row.displayName = toStringValue(item.displayName) || row.displayName;
      row.objectType = toStringValue(item.objectType) || row.objectType;
      row.processName = toStringValue(item.processName) || row.processName;
      row.categoryAtThatTime = toStringValue(item.categoryAtThatTime);
    }

    const presenceFilter = makeClassificationFilter();
    const presenceRows = this.db.all(
      `
      WITH ordered AS (
        SELECT
          classification_key,
          start_at_ms,
          end_at_ms,
          LAG(end_at_ms) OVER (
            PARTITION BY classification_key
            ORDER BY start_at_ms ASC, end_at_ms ASC, id ASC
          ) AS previous_end_ms
        FROM process_timeline
        WHERE classification_key != '' AND end_at_ms > start_at_ms${presenceFilter.sql}
      ),
      marked AS (
        SELECT
          *,
          CASE
            WHEN previous_end_ms IS NULL OR start_at_ms - previous_end_ms > ? THEN 1
            ELSE 0
          END AS group_start
        FROM ordered
      ),
      grouped AS (
        SELECT
          *,
          SUM(group_start) OVER (
            PARTITION BY classification_key
            ORDER BY start_at_ms ASC, end_at_ms ASC
            ROWS UNBOUNDED PRECEDING
          ) AS group_id
        FROM marked
      ),
      segments AS (
        SELECT
          classification_key,
          MIN(start_at_ms) AS start_ms,
          MAX(end_at_ms) AS end_ms
        FROM grouped
        GROUP BY classification_key, group_id
      )
      SELECT
        classification_key AS classificationKey,
        SUM(CASE WHEN end_ms > start_ms THEN (end_ms - start_ms) / 1000.0 ELSE 0 END) AS totalVisible,
        MAX(end_ms) AS lastPresenceMs
      FROM segments
      GROUP BY classification_key
      `,
      [...presenceFilter.params, mergeGapMs],
    );

    for (const item of presenceRows) {
      const row = ensureRow(item.classificationKey);
      if (!row) {
        continue;
      }
      row.totalVisible = Math.max(row.totalVisible, toNumber(item.totalVisible, 0));
    }

    const focusFilter = makeClassificationFilter();
    const focusRows = this.db.all(
      `
      WITH ordered AS (
        SELECT
          classification_key,
          start_at_ms,
          end_at_ms,
          LAG(end_at_ms) OVER (
            PARTITION BY classification_key
            ORDER BY start_at_ms ASC, end_at_ms ASC, id ASC
          ) AS previous_end_ms
        FROM focus_sessions
        WHERE classification_key != '' AND end_at_ms > start_at_ms${focusFilter.sql}
      ),
      marked AS (
        SELECT
          *,
          CASE
            WHEN previous_end_ms IS NULL OR start_at_ms - previous_end_ms > ? THEN 1
            ELSE 0
          END AS group_start
        FROM ordered
      ),
      grouped AS (
        SELECT
          *,
          SUM(group_start) OVER (
            PARTITION BY classification_key
            ORDER BY start_at_ms ASC, end_at_ms ASC
            ROWS UNBOUNDED PRECEDING
          ) AS group_id
        FROM marked
      ),
      segments AS (
        SELECT
          classification_key,
          MIN(start_at_ms) AS start_ms,
          MAX(end_at_ms) AS end_ms
        FROM grouped
        GROUP BY classification_key, group_id
      )
      SELECT
        classification_key AS classificationKey,
        SUM(CASE WHEN end_ms > start_ms THEN (end_ms - start_ms) / 1000.0 ELSE 0 END) AS focusTime,
        MAX(end_ms) AS lastFocusMs,
        MAX(CASE WHEN end_ms > start_ms THEN (end_ms - start_ms) / 1000.0 ELSE 0 END) AS longestContinuousFocus
      FROM segments
      GROUP BY classification_key
      `,
      [...focusFilter.params, mergeGapMs],
    );

    for (const item of focusRows) {
      const row = ensureRow(item.classificationKey);
      if (!row) {
        continue;
      }
      row.focusTime = Math.max(row.focusTime, toNumber(item.focusTime, 0));
      row.lastFocusMs = Math.max(row.lastFocusMs, toNumber(item.lastFocusMs, 0));
      row.longestContinuousFocus = Math.max(
        row.longestContinuousFocus,
        toNumber(item.longestContinuousFocus, 0),
      );
    }

    return [...rows.values()];
  }

  readPayloadRowsLimited(tableName, orderColumn, limit = DEFAULT_ACTIVITY_QUERY_LIMIT) {
    const normalizedLimit = normalizeActivityLimit(limit, DEFAULT_ACTIVITY_QUERY_LIMIT);
    const stmt = this.db.prepare(`
      SELECT payload_json
      FROM (
        SELECT payload_json, ${orderColumn}
        FROM ${tableName}
        ORDER BY ${orderColumn} DESC
        LIMIT ?
      )
      ORDER BY ${orderColumn} ASC
    `);
    const rows = [];
    try {
      stmt.bind([normalizedLimit]);
      while (stmt.step()) {
        const payload = safeJsonParse(stmt.get()[0], null);
        if (payload) {
          rows.push(payload);
        }
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  readActivityDateKeys() {
    const dates = new Set();
    const collect = (query) => {
      const result = this.db.exec(query);
      if (!result[0]) {
        return;
      }
      for (const row of result[0].values) {
        const key = typeof row[0] === 'string' ? row[0] : toLocalDateKey(row[0]);
        if (key) {
          dates.add(key);
        }
      }
    };
    collect(`
      SELECT DISTINCT strftime('%Y-%m-%d', start_at_ms / 1000, 'unixepoch', 'localtime')
      FROM focus_sessions
      WHERE start_at_ms > 0
    `);
    collect(`
      SELECT DISTINCT strftime('%Y-%m-%d', end_at_ms / 1000, 'unixepoch', 'localtime')
      FROM focus_sessions
      WHERE end_at_ms > 0
    `);
    collect(`
      SELECT DISTINCT strftime('%Y-%m-%d', bucket_start_ms / 1000, 'unixepoch', 'localtime')
      FROM input_activity_timeline
      WHERE bucket_start_ms > 0
    `);
    return [...dates].sort();
  }

  countValidFocusSources() {
    const row = this.db.all(
      'SELECT COUNT(*) AS count FROM focus_sessions WHERE end_at_ms > start_at_ms',
    )[0];
    return Number(row?.count || 0);
  }

  countValidInputSources() {
    const row = this.db.all(
      'SELECT COUNT(*) AS count FROM input_activity_timeline WHERE bucket_end_ms > bucket_start_ms',
    )[0];
    return Number(row?.count || 0);
  }

  isDailyCacheFresh() {
    const focusSourceCount = this.countValidFocusSources();
    const inputSourceCount = this.countValidInputSources();
    const cachedFocusSourceCount = this.countDistinctRows('focus_daily_cache', 'source_id');
    const cachedInputSourceCount = this.countDistinctRows('input_daily_cache', 'source_id');
    return (
      cachedFocusSourceCount === focusSourceCount &&
      cachedInputSourceCount === inputSourceCount
    );
  }

  ensureDailyCachesFresh() {
    if (this.isDailyCacheFresh()) {
      return { ok: true, rebuilt: false };
    }
    return { ...this.rebuildDailyCaches(), rebuilt: true };
  }

  readFocusDailyRowsFromSource(startDate, endDate) {
    const startKey = String(startDate || '').slice(0, 10);
    const endKey = String(endDate || '').slice(0, 10);
    const startMs = startOfLocalDateMs(startKey);
    const endMs = startOfLocalDateMs(endKey) + 24 * 60 * 60 * 1000;
    if (!startKey || !endKey || startMs <= 0 || endMs <= startMs) {
      return [];
    }

    const sourceRows = this.db.all(
      `
      SELECT
        classification_key AS classificationKey,
        display_name AS displayName,
        object_type AS objectType,
        process_name AS processName,
        category_at_that_time AS categoryAtThatTime,
        start_at_ms AS startAtMs,
        end_at_ms AS endAtMs,
        duration_seconds AS durationSeconds
      FROM focus_sessions
      WHERE start_at_ms < ? AND end_at_ms > ? AND end_at_ms > start_at_ms
      ORDER BY start_at_ms ASC
      `,
      [endMs, startMs],
    );

    const rows = new Map();
    for (const source of sourceRows) {
      for (const slice of splitDurationByLocalDay(
        Number(source.startAtMs),
        Number(source.endAtMs),
        Number(source.durationSeconds),
      )) {
        if (slice.dateKey < startKey || slice.dateKey > endKey) {
          continue;
        }
        const key = [
          slice.dateKey,
          source.classificationKey,
          source.displayName,
          source.objectType,
          source.processName,
          source.categoryAtThatTime,
        ].join('\u001f');
        const existing = rows.get(key) || {
          dateKey: slice.dateKey,
          classificationKey: toStringValue(source.classificationKey),
          displayName: toStringValue(source.displayName),
          objectType: toStringValue(source.objectType),
          processName: toStringValue(source.processName),
          categoryAtThatTime: toStringValue(source.categoryAtThatTime),
          seconds: 0,
        };
        existing.seconds += Number(slice.seconds || 0);
        rows.set(key, existing);
      }
    }

    return [...rows.values()]
      .map(row => ({ ...row, seconds: Math.round(row.seconds) }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || b.seconds - a.seconds);
  }

  readInputDailyRowsFromSource(startDate, endDate) {
    const startKey = String(startDate || '').slice(0, 10);
    const endKey = String(endDate || '').slice(0, 10);
    const startMs = startOfLocalDateMs(startKey);
    const endMs = startOfLocalDateMs(endKey) + 24 * 60 * 60 * 1000;
    if (!startKey || !endKey || startMs <= 0 || endMs <= startMs) {
      return [];
    }

    return this.db.all(
      `
      SELECT payload_json AS payloadJson, bucket_start_ms AS bucketStartMs
      FROM input_activity_timeline
      WHERE bucket_start_ms < ? AND bucket_end_ms > ? AND bucket_end_ms > bucket_start_ms
      ORDER BY bucket_start_ms ASC
      `,
      [endMs, startMs],
    )
      .map(row => {
        const record = safeJsonParse(row.payloadJson, null);
        if (!record) {
          return null;
        }
        const bucketStartMs = toTimeMs(record.bucketStartAt) || Number(row.bucketStartMs || 0);
        const dateKey = toLocalDateKey(bucketStartMs);
        if (!dateKey || dateKey < startKey || dateKey > endKey) {
          return null;
        }
        return {
          dateKey,
          classificationKey: toStringValue(record.classificationKey),
          displayName: toStringValue(record.displayName),
          objectType: toStringValue(record.objectType),
          processName: toStringValue(record.processName),
          keyPresses: pickInteger(record.keyPresses),
          leftClicks: pickInteger(record.leftClicks),
          rightClicks: pickInteger(record.rightClicks),
          middleClicks: pickInteger(record.middleClicks),
          sideBackClicks: pickInteger(record.sideBackClicks),
          sideForwardClicks: pickInteger(record.sideForwardClicks),
          scrollTicks: pickInteger(record.scrollTicks),
          mouseMovePixels: pickInteger(record.mouseMovePixels),
          keyCounts: record.keyCounts && typeof record.keyCounts === 'object' ? record.keyCounts : {},
          lastAtMs: bucketStartMs,
        };
      })
      .filter(Boolean);
  }

  readFocusDailyCache(startDate, endDate) {
    const startKey = String(startDate || '').slice(0, 10);
    const endKey = String(endDate || '').slice(0, 10);
    if (!startKey || !endKey) {
      return [];
    }
    try {
      this.ensureDailyCachesFresh();
    } catch {
      return this.readFocusDailyRowsFromSource(startKey, endKey);
    }
    const rows = this.db.all(
      `
      SELECT
        date_key AS dateKey,
        classification_key AS classificationKey,
        display_name AS displayName,
        object_type AS objectType,
        process_name AS processName,
        category_at_that_time AS categoryAtThatTime,
        SUM(seconds) AS seconds
      FROM focus_daily_cache
      WHERE date_key >= ? AND date_key <= ?
      GROUP BY date_key, classification_key, display_name, object_type, process_name, category_at_that_time
      ORDER BY date_key ASC, seconds DESC
      `,
      [startKey, endKey],
    );
    if (rows.length === 0 && this.countValidFocusSources() > 0) {
      return this.readFocusDailyRowsFromSource(startKey, endKey);
    }
    return rows;
  }

  readInputDailyCache(startDate, endDate) {
    const startKey = String(startDate || '').slice(0, 10);
    const endKey = String(endDate || '').slice(0, 10);
    if (!startKey || !endKey) {
      return [];
    }
    try {
      this.ensureDailyCachesFresh();
    } catch {
      return this.readInputDailyRowsFromSource(startKey, endKey);
    }
    const rows = this.db.all(
      `
      SELECT
        date_key AS dateKey,
        classification_key AS classificationKey,
        display_name AS displayName,
        object_type AS objectType,
        process_name AS processName,
        key_presses AS keyPresses,
        left_clicks AS leftClicks,
        right_clicks AS rightClicks,
        middle_clicks AS middleClicks,
        side_back_clicks AS sideBackClicks,
        side_forward_clicks AS sideForwardClicks,
        scroll_ticks AS scrollTicks,
        mouse_move_pixels AS mouseMovePixels,
        key_counts_json AS keyCountsJson,
        last_at_ms AS lastAtMs
      FROM input_daily_cache
      WHERE date_key >= ? AND date_key <= ?
      ORDER BY date_key ASC, last_at_ms ASC
      `,
      [startKey, endKey],
    ).map(row => ({
      ...row,
      keyCounts: safeJsonParse(row.keyCountsJson, {}),
    }));
    if (rows.length === 0 && this.countValidInputSources() > 0) {
      return this.readInputDailyRowsFromSource(startKey, endKey);
    }
    return rows;
  }

  writeState(statePayload) {
    const updatedAt = new Date().toISOString();
    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.writeSectionRows(statePayload, updatedAt);
      this.writeFocusSessions(statePayload.sessions || []);
      this.writeProcessTimeline(statePayload.processTimeline || []);
      this.writeInputActivityTimeline(statePayload.inputActivityTimeline || []);
      this.upsertMeta('schema_version', String(SCHEMA_VERSION));
      this.upsertMeta('updated_at', updatedAt);
      this.db.run('COMMIT');
      this.flush();
      return true;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    }
  }

  writeSectionRows(statePayload, updatedAt) {
    this.db.run('DELETE FROM state_sections');
    const insert = this.db.prepare(`
      INSERT INTO state_sections (section_key, payload_json, updated_at)
      VALUES (?, ?, ?)
    `);
    try {
      for (const sectionKey of this.sectionKeys) {
        if (TABLE_SECTION_KEYS.has(sectionKey)) {
          continue;
        }
        insert.run([sectionKey, toJsonPayload(statePayload[sectionKey]), updatedAt]);
      }
    } finally {
      insert.free();
    }
  }

  writeFocusSessions(sessions) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO focus_sessions (
        id,
        classification_key,
        display_name,
        object_type,
        process_name,
        domain,
        category_at_that_time,
        start_at_ms,
        end_at_ms,
        duration_seconds,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const session of sessions) {
        insert.run([
          toStringValue(session.id),
          toStringValue(session.classificationKey),
          toStringValue(session.displayName),
          toStringValue(session.objectType),
          toStringValue(session.processName),
          toStringValue(session.domain),
          toStringValue(session.categoryAtThatTime),
          toTimeMs(session.startAt),
          toTimeMs(session.endAt),
          toNumber(session.durationSeconds),
          toJsonPayload(session),
        ]);
        this.writeFocusDailyCache(session);
      }
    } finally {
      insert.free();
    }
  }

  writeProcessTimeline(records) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO process_timeline (
        id,
        classification_key,
        display_name,
        object_type,
        process_name,
        domain,
        category_at_that_time,
        start_at_ms,
        end_at_ms,
        duration_seconds,
        is_open,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const record of records) {
        insert.run([
          toStringValue(record.id),
          toStringValue(record.classificationKey),
          toStringValue(record.displayName),
          toStringValue(record.objectType),
          toStringValue(record.processName),
          toStringValue(record.domain),
          toStringValue(record.categoryAtThatTime),
          toTimeMs(record.startAt),
          toTimeMs(record.endAt),
          toNumber(record.durationSeconds),
          record.isOpen ? 1 : 0,
          toJsonPayload(record),
        ]);
      }
    } finally {
      insert.free();
    }
  }

  writeFocusDailyCache(session) {
    const sourceId = toStringValue(session.id);
    if (!sourceId) {
      return;
    }
    this.db.run('DELETE FROM focus_daily_cache WHERE source_id = ?', [sourceId]);
    const startMs = toTimeMs(session.startAt);
    const endMs = toTimeMs(session.endAt);
    const slices = splitDurationByLocalDay(startMs, endMs, toNumber(session.durationSeconds));
    if (slices.length === 0) {
      return;
    }
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO focus_daily_cache (
        source_id,
        date_key,
        classification_key,
        display_name,
        object_type,
        process_name,
        category_at_that_time,
        seconds
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const slice of slices) {
        insert.run([
          sourceId,
          slice.dateKey,
          toStringValue(session.classificationKey),
          toStringValue(session.displayName),
          toStringValue(session.objectType),
          toStringValue(session.processName),
          toStringValue(session.categoryAtThatTime),
          slice.seconds,
        ]);
      }
    } finally {
      insert.free();
    }
  }

  writeInputDailyCache(record) {
    const sourceId = toStringValue(record.id);
    if (!sourceId) {
      return;
    }
    this.db.run('DELETE FROM input_daily_cache WHERE source_id = ?', [sourceId]);
    const bucketStartMs = toTimeMs(record.bucketStartAt);
    const dateKey = toLocalDateKey(bucketStartMs);
    if (!dateKey) {
      return;
    }
    this.db.run(
      `
      INSERT OR REPLACE INTO input_daily_cache (
        source_id,
        date_key,
        classification_key,
        display_name,
        object_type,
        process_name,
        key_presses,
        left_clicks,
        right_clicks,
        middle_clicks,
        side_back_clicks,
        side_forward_clicks,
        scroll_ticks,
        mouse_move_pixels,
        key_counts_json,
        last_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sourceId,
        dateKey,
        toStringValue(record.classificationKey),
        toStringValue(record.displayName),
        toStringValue(record.objectType),
        toStringValue(record.processName),
        pickInteger(record.keyPresses),
        pickInteger(record.leftClicks),
        pickInteger(record.rightClicks),
        pickInteger(record.middleClicks),
        pickInteger(record.sideBackClicks),
        pickInteger(record.sideForwardClicks),
        pickInteger(record.scrollTicks),
        pickInteger(record.mouseMovePixels),
        toJsonPayload(record.keyCounts || {}),
        toTimeMs(record.bucketStartAt),
      ],
    );
  }

  writeInputActivityTimeline(records) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO input_activity_timeline (
        id,
        classification_key,
        display_name,
        object_type,
        process_name,
        domain,
        bucket_start_ms,
        bucket_end_ms,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      for (const record of records) {
        insert.run([
          toStringValue(record.id),
          toStringValue(record.classificationKey),
          toStringValue(record.displayName),
          toStringValue(record.objectType),
          toStringValue(record.processName),
          toStringValue(record.domain),
          toTimeMs(record.bucketStartAt),
          toTimeMs(record.bucketEndAt),
          toJsonPayload(record),
        ]);
        this.writeInputDailyCache(record);
      }
    } finally {
      insert.free();
    }
  }

  getClipboardImageDir() {
    return path.join(this.dataDirPath, 'clipboard-images');
  }

  persistClipboardImageFile(snapshot) {
    const image = snapshot?.image;
    if (!image?.dataUrl || typeof image.dataUrl !== 'string') {
      return snapshot;
    }
    const match = /^data:image\/([^;,]+);base64,(.+)$/i.exec(image.dataUrl);
    if (!match) {
      return snapshot;
    }
    const imageType = (image.type || match[1] || 'png').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'png';
    const imageDir = this.getClipboardImageDir();
    ensureDir(imageDir);
    const fileName = `${snapshot.id || hashString(image.dataUrl)}.${imageType}`;
    const filePath = path.join(imageDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
    return {
      ...snapshot,
      image: {
        ...image,
        dataUrl: '',
        filePath,
      },
    };
  }

  hydrateClipboardImage(snapshot) {
    const image = snapshot?.image;
    if (!image || image.dataUrl || !image.filePath) {
      return snapshot;
    }
    try {
      if (!fs.existsSync(image.filePath)) {
        return snapshot;
      }
      const type = image.type || path.extname(image.filePath).replace('.', '') || 'png';
      const dataUrl = `data:image/${type};base64,${fs.readFileSync(image.filePath).toString('base64')}`;
      return {
        ...snapshot,
        image: {
          ...image,
          dataUrl,
        },
      };
    } catch {
      return snapshot;
    }
  }

  withClipboardImagePreview(snapshot) {
    const image = snapshot?.image;
    if (!image || snapshot.kind !== 'image') {
      return snapshot;
    }
    return {
      ...snapshot,
      image: {
        ...image,
        dataUrl: image.thumbnailDataUrl || '',
      },
    };
  }

  cleanupClipboardImageFiles() {
    const imageDir = this.getClipboardImageDir();
    if (!fs.existsSync(imageDir)) {
      return;
    }
    const referenced = new Set(
      this.db
        .all('SELECT image_file_path AS filePath FROM clipboard_history WHERE image_file_path IS NOT NULL AND image_file_path != ?',[ '' ])
        .map(row => path.resolve(String(row.filePath || '')))
        .filter(Boolean),
    );
    for (const file of fs.readdirSync(imageDir)) {
      const filePath = path.resolve(path.join(imageDir, file));
      if (!referenced.has(filePath)) {
        try {
          fs.rmSync(filePath, { force: true });
        } catch {
          // Ignore cleanup failures.
        }
      }
    }
  }

  getClipboardHistory(limit = DEFAULT_CLIPBOARD_HISTORY_LIMIT, options = {}) {
    const normalizedLimit = normalizeLimit(limit);
    const hydrateImages = Boolean(options.hydrateImages);
    const stmt = this.db.prepare(`
      SELECT payload_json, seen_count, last_seen_at_ms
      FROM clipboard_history
      ORDER BY captured_at_ms DESC
      LIMIT ?
    `);
    const rows = [];
    try {
      stmt.bind([normalizedLimit]);
      while (stmt.step()) {
        const row = stmt.get();
        const snapshot = safeJsonParse(row[0], null);
        if (!snapshot) {
          continue;
        }
        const seenCount = toNumber(row[1], 1);
        const lastSeenAtMs = toTimeMs(row[2]);
        const nextSnapshot = {
          ...snapshot,
          seenCount,
          lastSeenAt: lastSeenAtMs > 0 ? new Date(lastSeenAtMs).toISOString() : snapshot.capturedAt,
        };
        rows.push(hydrateImages ? this.hydrateClipboardImage(nextSnapshot) : this.withClipboardImagePreview(nextSnapshot));
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  getClipboardHistoryItem(id, options = {}) {
    const itemId = toStringValue(id).trim();
    if (!itemId) {
      return null;
    }
    const hydrateImages = options.hydrateImages !== false;
    const stmt = this.db.prepare(`
      SELECT payload_json, seen_count, last_seen_at_ms
      FROM clipboard_history
      WHERE id = ?
      LIMIT 1
    `);
    try {
      stmt.bind([itemId]);
      if (!stmt.step()) {
        return null;
      }
      const row = stmt.get();
      const snapshot = safeJsonParse(row[0], null);
      if (!snapshot) {
        return null;
      }
      const seenCount = toNumber(row[1], 1);
      const lastSeenAtMs = toTimeMs(row[2]);
      const nextSnapshot = {
        ...snapshot,
        seenCount,
        lastSeenAt: lastSeenAtMs > 0 ? new Date(lastSeenAtMs).toISOString() : snapshot.capturedAt,
      };
      return hydrateImages ? this.hydrateClipboardImage(nextSnapshot) : this.withClipboardImagePreview(nextSnapshot);
    } finally {
      stmt.free();
    }
  }

  findClipboardHistoryBySignature(signature) {
    const stmt = this.db.prepare('SELECT id, seen_count FROM clipboard_history WHERE signature = ? LIMIT 1');
    try {
      stmt.bind([signature]);
      if (!stmt.step()) {
        return null;
      }
      const row = stmt.get();
      return {
        id: toStringValue(row[0]),
        seenCount: toNumber(row[1], 1),
      };
    } finally {
      stmt.free();
    }
  }

  saveClipboardSnapshot(snapshot, signature, limit = DEFAULT_CLIPBOARD_HISTORY_LIMIT) {
    if (!snapshot || !signature) {
      return false;
    }

    const normalizedLimit = normalizeLimit(limit);
    const capturedAtMs = toTimeMs(snapshot.capturedAt) || Date.now();
    const lastSeenAt = new Date(capturedAtMs).toISOString();
    const existing = this.findClipboardHistoryBySignature(signature);
    const seenCount = existing ? existing.seenCount + 1 : 1;
    const storedSnapshot = this.persistClipboardImageFile({
      ...snapshot,
      id: existing?.id || toStringValue(snapshot.id) || `clip-${capturedAtMs}`,
      signature,
      seenCount,
      lastSeenAt,
    });
    const image = storedSnapshot.image || {};

    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      if (existing) {
        this.db.run(
          `
          UPDATE clipboard_history
          SET
            kind = ?,
            captured_at_ms = ?,
            last_seen_at_ms = ?,
            seen_count = ?,
            title = ?,
            text = ?,
            image_data_url = ?,
            image_file_path = ?,
            image_width = ?,
            image_height = ?,
            image_type = ?,
            image_byte_length = ?,
            formats_json = ?,
            details_json = ?,
            payload_json = ?
          WHERE signature = ?
          `,
          [
            toStringValue(storedSnapshot.kind),
            capturedAtMs,
            capturedAtMs,
            seenCount,
            toStringValue(storedSnapshot.title),
            toStringValue(storedSnapshot.text),
            toStringValue(image.dataUrl),
            toStringValue(image.filePath),
            toNumber(image.width),
            toNumber(image.height),
            toStringValue(image.type),
            toNumber(image.byteLength),
            toJsonPayload(storedSnapshot.formats || []),
            toJsonPayload(storedSnapshot.details || []),
            toJsonPayload(storedSnapshot),
            signature,
          ],
        );
      } else {
        this.db.run(
          `
          INSERT INTO clipboard_history (
            id,
            kind,
            signature,
            captured_at_ms,
            last_seen_at_ms,
            seen_count,
            title,
            text,
            image_data_url,
            image_file_path,
            image_width,
            image_height,
            image_type,
            image_byte_length,
            formats_json,
            details_json,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            storedSnapshot.id,
            toStringValue(storedSnapshot.kind),
            signature,
            capturedAtMs,
            capturedAtMs,
            seenCount,
            toStringValue(storedSnapshot.title),
            toStringValue(storedSnapshot.text),
            toStringValue(image.dataUrl),
            toStringValue(image.filePath),
            toNumber(image.width),
            toNumber(image.height),
            toStringValue(image.type),
            toNumber(image.byteLength),
            toJsonPayload(storedSnapshot.formats || []),
            toJsonPayload(storedSnapshot.details || []),
            toJsonPayload(storedSnapshot),
          ],
        );
      }

      const cleanup = this.db.prepare(`
        DELETE FROM clipboard_history
        WHERE id NOT IN (
          SELECT id FROM clipboard_history
          ORDER BY captured_at_ms DESC
          LIMIT ?
        )
      `);
      try {
        cleanup.run([normalizedLimit]);
      } finally {
        cleanup.free();
      }
      this.cleanupClipboardImageFiles();

      this.db.run('COMMIT');
      this.flush();
      return true;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    }
  }

  clearClipboardHistory() {
    this.db.run('DELETE FROM clipboard_history');
    try {
      fs.rmSync(this.getClipboardImageDir(), { recursive: true, force: true });
    } catch {
      // Ignore file cleanup failures.
    }
    this.flush();
  }

  clearActivityTables() {
    this.db.run(`
      DELETE FROM focus_sessions;
      DELETE FROM process_timeline;
      DELETE FROM input_activity_timeline;
      DELETE FROM focus_daily_cache;
      DELETE FROM input_daily_cache;
      DELETE FROM monitoring_summary_cache;
    `);
    this.upsertMeta('monitoring_summary_cache_session_count', '0');
    this.upsertMeta('monitoring_summary_cache_process_timeline_count', '0');
    this.upsertMeta('monitoring_summary_cache_session_max_end_ms', '0');
    this.upsertMeta('monitoring_summary_cache_process_timeline_max_end_ms', '0');
    this.upsertMeta('monitoring_summary_cache_updated_at_ms', String(Date.now()));
    this.flush();
  }

  deleteActivityByClassificationKeys(classificationKeys) {
    const keys = Array.isArray(classificationKeys)
      ? classificationKeys.map(key => String(key || '').trim()).filter(Boolean)
      : [];
    if (keys.length === 0) {
      return 0;
    }

    const deleteFrom = (tableName) => {
      const stmt = this.db.prepare(`DELETE FROM ${tableName} WHERE classification_key = ?`);
      let changed = 0;
      try {
        for (const key of keys) {
          stmt.run([key]);
          changed += this.db.getRowsModified();
        }
      } finally {
        stmt.free();
      }
      return changed;
    };

    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const changed =
        deleteFrom('focus_sessions') +
        deleteFrom('process_timeline') +
        deleteFrom('input_activity_timeline') +
        deleteFrom('focus_daily_cache') +
        deleteFrom('input_daily_cache') +
        deleteFrom('monitoring_summary_cache');
      this.db.run('COMMIT');
      this.flush();
      return changed;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    }
  }

  rebuildMonitoringSummaryCache(mergeGapSeconds = 0) {
    const mergeGapMs = Math.max(0, toNumber(mergeGapSeconds, 0)) * 1000;
    const rows = this.computeMonitoringAggregateRows(mergeGapMs, null);
    const sourceSessionCount = this.countRows('focus_sessions');
    const sourceProcessTimelineCount = this.countRows('process_timeline');
    const sourceSessionMaxEndMs = this.maxNumber('focus_sessions', 'end_at_ms');
    const sourceProcessTimelineMaxEndMs = this.maxNumber('process_timeline', 'end_at_ms');
    const updatedAtMs = Date.now();

    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db.run('DELETE FROM monitoring_summary_cache');
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO monitoring_summary_cache (
          classification_key,
          display_name,
          object_type,
          process_name,
          category_at_that_time,
          total_visible_seconds,
          focus_seconds,
          last_focus_ms,
          longest_continuous_focus_seconds,
          merge_gap_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      try {
        for (const row of rows) {
          insert.run([
            toStringValue(row.classificationKey),
            toStringValue(row.displayName) || toStringValue(row.classificationKey),
            toStringValue(row.objectType) || 'AppWindow',
            toStringValue(row.processName) || 'unknown',
            toStringValue(row.categoryAtThatTime),
            toNumber(row.totalVisible),
            toNumber(row.focusTime),
            toNumber(row.lastFocusMs),
            toNumber(row.longestContinuousFocus),
            mergeGapMs,
            updatedAtMs,
          ]);
        }
      } finally {
        insert.free();
      }
      this.upsertMeta('monitoring_summary_cache_merge_gap_ms', String(mergeGapMs));
      this.upsertMeta('monitoring_summary_cache_session_count', String(sourceSessionCount));
      this.upsertMeta('monitoring_summary_cache_process_timeline_count', String(sourceProcessTimelineCount));
      this.upsertMeta('monitoring_summary_cache_session_max_end_ms', String(sourceSessionMaxEndMs));
      this.upsertMeta(
        'monitoring_summary_cache_process_timeline_max_end_ms',
        String(sourceProcessTimelineMaxEndMs),
      );
      this.upsertMeta('monitoring_summary_cache_updated_at_ms', String(updatedAtMs));
      this.db.run('COMMIT');
      this.flush();
      return {
        ok: true,
        rowCount: rows.length,
        sourceSessionCount,
        sourceProcessTimelineCount,
        sourceSessionMaxEndMs,
        sourceProcessTimelineMaxEndMs,
        mergeGapMs,
        updatedAtMs,
      };
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    }
  }

  rebuildDailyCaches() {
    let focusSourceCount = 0;
    let inputSourceCount = 0;
    const chunkSize = 1000;

    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db.run('DELETE FROM focus_daily_cache');
      this.db.run('DELETE FROM input_daily_cache');

      let lastFocusRowId = 0;
      while (true) {
        const focusRows = this.db.all(
          `
          SELECT rowid AS rowId, payload_json AS payloadJson
          FROM focus_sessions
          WHERE rowid > ?
          ORDER BY rowid ASC
          LIMIT ?
          `,
          [lastFocusRowId, chunkSize],
        );
        if (focusRows.length === 0) {
          break;
        }
        for (const row of focusRows) {
          const session = safeJsonParse(row.payloadJson, null);
          if (session) {
            this.writeFocusDailyCache(session);
            focusSourceCount += 1;
          }
          lastFocusRowId = Math.max(lastFocusRowId, Number(row.rowId) || lastFocusRowId);
        }
      }

      let lastInputRowId = 0;
      while (true) {
        const inputRows = this.db.all(
          `
          SELECT rowid AS rowId, payload_json AS payloadJson
          FROM input_activity_timeline
          WHERE rowid > ?
          ORDER BY rowid ASC
          LIMIT ?
          `,
          [lastInputRowId, chunkSize],
        );
        if (inputRows.length === 0) {
          break;
        }
        for (const row of inputRows) {
          const record = safeJsonParse(row.payloadJson, null);
          if (record) {
            this.writeInputDailyCache(record);
            inputSourceCount += 1;
          }
          lastInputRowId = Math.max(lastInputRowId, Number(row.rowId) || lastInputRowId);
        }
      }

      this.db.run('COMMIT');
      this.flush();
      return {
        ok: true,
        focusSourceCount,
        inputSourceCount,
        focusDailyCache: this.db.all('SELECT COUNT(*) AS count FROM focus_daily_cache')[0]?.count ?? 0,
        inputDailyCache: this.db.all('SELECT COUNT(*) AS count FROM input_daily_cache')[0]?.count ?? 0,
      };
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures.
      }
      throw error;
    }
  }

  getStatus(options = {}) {
    const countRows = tableName => {
      const result = this.db.exec(`SELECT COUNT(*) AS count FROM ${tableName}`);
      return Number(result[0]?.values?.[0]?.[0] || 0);
    };
    const countDistinct = (tableName, columnName) => {
      const result = this.db.exec(`SELECT COUNT(DISTINCT ${columnName}) AS count FROM ${tableName}`);
      return Number(result[0]?.values?.[0]?.[0] || 0);
    };
    let sizeBytes = 0;
    try {
      sizeBytes = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    } catch {
      sizeBytes = 0;
    }
    const sessionCount = countRows('focus_sessions');
    const processTimelineCount = countRows('process_timeline');
    const inputTimelineCount = countRows('input_activity_timeline');
    const focusDailyCacheCount = countRows('focus_daily_cache');
    const inputDailyCacheCount = countRows('input_daily_cache');
    const monitoringSummaryCacheCount = countRows('monitoring_summary_cache');
    const cachedFocusSourceCount = countDistinct('focus_daily_cache', 'source_id');
    const cachedInputSourceCount = countDistinct('input_daily_cache', 'source_id');
    const monitoringMergeGapMs = Math.max(0, toNumber(options.monitoringMergeGapSeconds, 0)) * 1000;
    const monitoringSummaryCache = this.getMonitoringSummaryCacheStatus(monitoringMergeGapMs);

    return {
      ok: true,
      dbPath: this.dbPath,
      schemaVersion: SCHEMA_VERSION,
      sizeBytes,
      counts: {
        sections: countRows('state_sections'),
        sessions: sessionCount,
        processTimeline: processTimelineCount,
        inputActivityTimeline: inputTimelineCount,
        focusDailyCache: focusDailyCacheCount,
        inputDailyCache: inputDailyCacheCount,
        monitoringSummaryCache: monitoringSummaryCacheCount,
        clipboardHistory: countRows('clipboard_history'),
      },
      cacheHealth: {
        focus: {
          sourceCount: sessionCount,
          cachedSourceCount: cachedFocusSourceCount,
          missingSourceCount: Math.max(0, sessionCount - cachedFocusSourceCount),
          staleSourceCount: Math.max(0, cachedFocusSourceCount - sessionCount),
          ok: cachedFocusSourceCount === sessionCount,
        },
        input: {
          sourceCount: inputTimelineCount,
          cachedSourceCount: cachedInputSourceCount,
          missingSourceCount: Math.max(0, inputTimelineCount - cachedInputSourceCount),
          staleSourceCount: Math.max(0, cachedInputSourceCount - inputTimelineCount),
          ok: cachedInputSourceCount === inputTimelineCount,
        },
        monitoringSummary: monitoringSummaryCache,
      },
    };
  }

  flush() {
    ensureDir(this.dataDirPath);
    if (this.db && typeof this.db.checkpoint === 'function') {
      this.db.checkpoint();
    }
  }
}

module.exports = {
  SQLITE_FILE_NAME,
  initializeSqliteEngine,
  createSqliteStateStore(dataDirPath, sectionKeys) {
    const store = new SqliteStateStore(dataDirPath, sectionKeys);
    store.open();
    return store;
  },
};
