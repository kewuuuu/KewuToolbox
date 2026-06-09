const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const SQLITE_FILE_NAME = 'kewu-toolbox.sqlite';
const SCHEMA_VERSION = 2;
const TABLE_SECTION_KEYS = new Set(['sessions', 'processTimeline', 'inputActivityTimeline']);
const DEFAULT_CLIPBOARD_HISTORY_LIMIT = 300;

let SQL = null;
let initializingSql = null;

function resolveSqlJsWasmPath(fileName) {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', fileName),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'sql.js', 'dist', fileName),
    path.join(process.resourcesPath || '', 'app', 'node_modules', 'sql.js', 'dist', fileName),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function initializeSqliteEngine() {
  if (SQL) {
    return SQL;
  }
  if (!initializingSql) {
    initializingSql = initSqlJs({
      locateFile: resolveSqlJsWasmPath,
    }).then(module => {
      SQL = module;
      return SQL;
    });
  }
  return initializingSql;
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

class SqliteStateStore {
  constructor(dataDirPath, sectionKeys) {
    if (!SQL) {
      throw new Error('SQLite engine has not been initialized.');
    }
    this.dataDirPath = dataDirPath;
    this.sectionKeys = sectionKeys;
    this.dbPath = path.join(dataDirPath, SQLITE_FILE_NAME);
    this.db = null;
  }

  open() {
    ensureDir(this.dataDirPath);
    if (fs.existsSync(this.dbPath)) {
      const bytes = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(bytes);
    } else {
      this.db = new SQL.Database();
    }
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

    this.upsertMeta('schema_version', String(SCHEMA_VERSION));
  }

  upsertMeta(key, value) {
    this.db.run(
      `INSERT INTO meta (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  readState() {
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

    state.sessions = this.readPayloadRows('focus_sessions', 'start_at_ms');
    state.processTimeline = this.readPayloadRows('process_timeline', 'start_at_ms');
    state.inputActivityTimeline = this.readPayloadRows('input_activity_timeline', 'bucket_start_ms');
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
    this.db.run('DELETE FROM focus_sessions');
    const insert = this.db.prepare(`
      INSERT INTO focus_sessions (
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
      }
    } finally {
      insert.free();
    }
  }

  writeProcessTimeline(records) {
    this.db.run('DELETE FROM process_timeline');
    const insert = this.db.prepare(`
      INSERT INTO process_timeline (
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

  writeInputActivityTimeline(records) {
    this.db.run('DELETE FROM input_activity_timeline');
    const insert = this.db.prepare(`
      INSERT INTO input_activity_timeline (
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
      }
    } finally {
      insert.free();
    }
  }

  getClipboardHistory(limit = DEFAULT_CLIPBOARD_HISTORY_LIMIT) {
    const normalizedLimit = normalizeLimit(limit);
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
        rows.push({
          ...snapshot,
          seenCount,
          lastSeenAt: lastSeenAtMs > 0 ? new Date(lastSeenAtMs).toISOString() : snapshot.capturedAt,
        });
      }
    } finally {
      stmt.free();
    }
    return rows;
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
    const storedSnapshot = {
      ...snapshot,
      id: existing?.id || toStringValue(snapshot.id) || `clip-${capturedAtMs}`,
      signature,
      seenCount,
      lastSeenAt,
    };
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
            image_width,
            image_height,
            image_type,
            image_byte_length,
            formats_json,
            details_json,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    this.flush();
  }

  getStatus() {
    const countRows = tableName => {
      const result = this.db.exec(`SELECT COUNT(*) AS count FROM ${tableName}`);
      return Number(result[0]?.values?.[0]?.[0] || 0);
    };
    let sizeBytes = 0;
    try {
      sizeBytes = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    } catch {
      sizeBytes = 0;
    }

    return {
      ok: true,
      dbPath: this.dbPath,
      schemaVersion: SCHEMA_VERSION,
      sizeBytes,
      counts: {
        sections: countRows('state_sections'),
        sessions: countRows('focus_sessions'),
        processTimeline: countRows('process_timeline'),
        inputActivityTimeline: countRows('input_activity_timeline'),
        clipboardHistory: countRows('clipboard_history'),
      },
    };
  }

  flush() {
    ensureDir(this.dataDirPath);
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
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
