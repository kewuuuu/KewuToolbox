using System.Globalization;
using System.IO;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WindowMonitorApp.Models;

namespace WindowMonitorApp.Data;

public sealed class AppDatabase
{
    private readonly object _syncRoot = new();
    private readonly string _databasePath;

    public AppDatabase()
    {
        var dataDirectory = Path.Combine(AppContext.BaseDirectory, "data");
        Directory.CreateDirectory(dataDirectory);
        _databasePath = Path.Combine(dataDirectory, "app.db");
    }

    public string DatabasePath => _databasePath;

    public void Initialize()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                CREATE TABLE IF NOT EXISTS window_stats (
                    window_key TEXT PRIMARY KEY,
                    process_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    total_seconds INTEGER NOT NULL DEFAULT 0,
                    focus_seconds INTEGER NOT NULL DEFAULT 0,
                    last_seen_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS focus_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    window_key TEXT NOT NULL,
                    process_name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS power_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT '',
                    UNIQUE(event_type, occurred_at, detail)
                );

                CREATE TABLE IF NOT EXISTS process_categories (
                    process_name TEXT PRIMARY KEY,
                    category TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS focus_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    default_minutes INTEGER NOT NULL DEFAULT 25,
                    window_keys_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS focus_plan_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    cycle_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS focus_plan_template_steps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_id INTEGER NOT NULL,
                    step_order INTEGER NOT NULL,
                    focus_item_id INTEGER NOT NULL,
                    duration_minutes INTEGER NOT NULL,
                    FOREIGN KEY(template_id) REFERENCES focus_plan_templates(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS todo_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    task_type TEXT NOT NULL DEFAULT '一次性',
                    repeat_mode TEXT NOT NULL DEFAULT '每日',
                    weekly_days TEXT NOT NULL DEFAULT '',
                    monthly_days TEXT NOT NULL DEFAULT '',
                    custom_pattern TEXT NOT NULL DEFAULT '',
                    reminder_enabled INTEGER NOT NULL DEFAULT 0,
                    reminder_year INTEGER NULL,
                    reminder_month INTEGER NULL,
                    reminder_day INTEGER NULL,
                    reminder_hour INTEGER NOT NULL DEFAULT 0,
                    reminder_minute INTEGER NOT NULL DEFAULT 0,
                    reminder_second INTEGER NOT NULL DEFAULT 0,
                    current_insight TEXT NOT NULL DEFAULT '',
                    last_reminder_stamp TEXT NOT NULL DEFAULT '',
                    is_archived INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT NULL
                );

                CREATE TABLE IF NOT EXISTS todo_archive_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    insight TEXT NOT NULL DEFAULT '',
                    completed_at TEXT NOT NULL,
                    task_snapshot_json TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY(task_id) REFERENCES todo_tasks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS ix_todo_archive_records_task_id
                ON todo_archive_records(task_id);

                CREATE INDEX IF NOT EXISTS ix_focus_plan_template_steps_template
                ON focus_plan_template_steps(template_id, step_order);
                """;
            command.ExecuteNonQuery();
            EnsureDefaultProcessCategories(connection);

            MigrateLegacyTodos(connection);
        }
    }

    public void UpsertWindowSamples(IReadOnlyCollection<TrackedWindow> windows, TrackedWindow? focusedWindow, DateTime timestampUtc)
    {
        if (windows.Count == 0 && focusedWindow is null)
        {
            return;
        }

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();

            var uniqueWindows = windows
                .GroupBy(w => w.WindowKey, StringComparer.Ordinal)
                .Select(g => g.First())
                .ToList();

            if (focusedWindow is not null && uniqueWindows.All(item => item.WindowKey != focusedWindow.WindowKey))
            {
                uniqueWindows.Add(focusedWindow);
            }

            foreach (var window in uniqueWindows)
            {
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText =
                    """
                    INSERT INTO window_stats(window_key, process_name, title, total_seconds, focus_seconds, last_seen_at)
                    VALUES($key, $process, $title, 1, $focusIncrement, $lastSeen)
                    ON CONFLICT(window_key) DO UPDATE SET
                        process_name = excluded.process_name,
                        title = excluded.title,
                        total_seconds = window_stats.total_seconds + 1,
                        focus_seconds = window_stats.focus_seconds + excluded.focus_seconds,
                        last_seen_at = excluded.last_seen_at;
                    """;
                command.Parameters.AddWithValue("$key", window.WindowKey);
                command.Parameters.AddWithValue("$process", window.ProcessName);
                command.Parameters.AddWithValue("$title", window.Title);
                command.Parameters.AddWithValue(
                    "$focusIncrement",
                    focusedWindow is not null && window.WindowKey == focusedWindow.WindowKey ? 1 : 0);
                command.Parameters.AddWithValue("$lastSeen", timestampUtc.ToString("O", CultureInfo.InvariantCulture));
                command.ExecuteNonQuery();
            }

            transaction.Commit();
        }
    }

    public void AddFocusSession(
        string windowKey,
        string processName,
        string title,
        DateTime startedAtUtc,
        DateTime endedAtUtc,
        long durationSeconds)
    {
        if (durationSeconds <= 0)
        {
            return;
        }

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO focus_sessions(window_key, process_name, title, started_at, ended_at, duration_seconds)
                VALUES($key, $process, $title, $startedAt, $endedAt, $durationSeconds);
                """;
            command.Parameters.AddWithValue("$key", windowKey);
            command.Parameters.AddWithValue("$process", processName);
            command.Parameters.AddWithValue("$title", title);
            command.Parameters.AddWithValue("$startedAt", startedAtUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$endedAt", endedAtUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$durationSeconds", durationSeconds);
            command.ExecuteNonQuery();
        }
    }

    public void AddPowerEvent(string eventType, DateTime occurredAtUtc, string? detail = null)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT OR IGNORE INTO power_events(event_type, occurred_at, detail)
                VALUES($eventType, $occurredAt, $detail);
                """;
            command.Parameters.AddWithValue("$eventType", eventType);
            command.Parameters.AddWithValue("$occurredAt", occurredAtUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$detail", detail ?? string.Empty);
            command.ExecuteNonQuery();
        }
    }

    public IReadOnlyList<WindowUsageStat> GetWindowStats(int maxCount)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT window_key, process_name, title, total_seconds, focus_seconds, last_seen_at
                FROM window_stats
                ORDER BY focus_seconds DESC, total_seconds DESC
                LIMIT $maxCount;
                """;
            command.Parameters.AddWithValue("$maxCount", maxCount);
            using var reader = command.ExecuteReader();

            var result = new List<WindowUsageStat>();
            while (reader.Read())
            {
                result.Add(new WindowUsageStat
                {
                    WindowKey = reader.GetString(0),
                    ProcessName = reader.GetString(1),
                    Title = reader.GetString(2),
                    TotalSeconds = reader.GetInt64(3),
                    FocusSeconds = reader.GetInt64(4),
                    LastSeenAtUtc = ParseUtc(reader.GetString(5))
                });
            }

            return result;
        }
    }

    public IReadOnlyList<PowerEventRecord> GetPowerEvents(int maxCount)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT event_type, occurred_at, detail
                FROM power_events
                ORDER BY occurred_at DESC
                LIMIT $maxCount;
                """;
            command.Parameters.AddWithValue("$maxCount", maxCount);
            using var reader = command.ExecuteReader();

            var result = new List<PowerEventRecord>();
            while (reader.Read())
            {
                result.Add(new PowerEventRecord
                {
                    EventType = reader.GetString(0),
                    OccurredAtUtc = ParseUtc(reader.GetString(1)),
                    Detail = reader.GetString(2)
                });
            }

            return result;
        }
    }

    public IReadOnlyList<PowerEventRecord> GetPowerEventsInRange(DateTime startUtc, DateTime endUtc)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT event_type, occurred_at, detail
                FROM power_events
                WHERE occurred_at >= $startUtc AND occurred_at <= $endUtc
                ORDER BY occurred_at ASC;
                """;
            command.Parameters.AddWithValue("$startUtc", startUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$endUtc", endUtc.ToString("O", CultureInfo.InvariantCulture));
            using var reader = command.ExecuteReader();

            var result = new List<PowerEventRecord>();
            while (reader.Read())
            {
                result.Add(new PowerEventRecord
                {
                    EventType = reader.GetString(0),
                    OccurredAtUtc = ParseUtc(reader.GetString(1)),
                    Detail = reader.GetString(2)
                });
            }

            return result;
        }
    }

    public IReadOnlyList<FocusSessionRecord> GetFocusSessionsInRange(DateTime startUtc, DateTime endUtc)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT window_key, process_name, title, started_at, ended_at, duration_seconds
                FROM focus_sessions
                WHERE ended_at > $startUtc AND started_at < $endUtc
                ORDER BY started_at ASC;
                """;
            command.Parameters.AddWithValue("$startUtc", startUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$endUtc", endUtc.ToString("O", CultureInfo.InvariantCulture));
            using var reader = command.ExecuteReader();

            var result = new List<FocusSessionRecord>();
            while (reader.Read())
            {
                var startedAtUtc = ParseUtc(reader.GetString(3));
                var endedAtUtc = ParseUtc(reader.GetString(4));
                if (endedAtUtc <= startUtc || startedAtUtc >= endUtc)
                {
                    continue;
                }

                result.Add(new FocusSessionRecord
                {
                    WindowKey = reader.GetString(0),
                    ProcessName = reader.GetString(1),
                    Title = reader.GetString(2),
                    StartedAtUtc = startedAtUtc,
                    EndedAtUtc = endedAtUtc,
                    DurationSeconds = reader.GetInt64(5)
                });
            }

            return result;
        }
    }

    public IReadOnlyList<string> GetKnownProcesses()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT process_name FROM window_stats
                UNION
                SELECT process_name FROM focus_sessions
                UNION
                SELECT process_name FROM process_categories
                ORDER BY process_name COLLATE NOCASE;
                """;
            using var reader = command.ExecuteReader();
            var result = new List<string>();
            while (reader.Read())
            {
                var processName = reader.GetString(0);
                if (!string.IsNullOrWhiteSpace(processName))
                {
                    result.Add(processName);
                }
            }

            if (!result.Contains(WindowCategory.DesktopProcess, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(WindowCategory.DesktopProcess);
            }

            return result;
        }
    }

    public Dictionary<string, string> GetProcessCategoryMap()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT process_name, category FROM process_categories;";
            using var reader = command.ExecuteReader();
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            while (reader.Read())
            {
                result[reader.GetString(0)] = reader.GetString(1);
            }

            return result;
        }
    }

    public void UpsertProcessCategory(string processName, string category)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO process_categories(process_name, category)
                VALUES($processName, $category)
                ON CONFLICT(process_name) DO UPDATE SET category = excluded.category;
                """;
            command.Parameters.AddWithValue("$processName", processName);
            command.Parameters.AddWithValue("$category", category);
            command.ExecuteNonQuery();
        }
    }

    public IReadOnlyList<FocusItem> GetFocusItems()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT id, title, default_minutes, window_keys_json
                FROM focus_items
                ORDER BY updated_at DESC, id DESC;
                """;
            using var reader = command.ExecuteReader();

            var result = new List<FocusItem>();
            while (reader.Read())
            {
                var item = new FocusItem
                {
                    Id = reader.GetInt64(0),
                    Title = reader.GetString(1),
                    DefaultMinutes = reader.GetInt32(2)
                };
                item.SetWindowKeys(ParseWindowKeyJson(reader.GetString(3)));
                result.Add(item);
            }

            return result;
        }
    }

    public FocusItem CreateFocusItem(string title, int defaultMinutes, IReadOnlyCollection<string> windowKeys)
    {
        var nowUtc = DateTime.UtcNow;
        var windowKeyJson = SerializeWindowKeys(windowKeys);
        var normalizedMinutes = Math.Clamp(defaultMinutes, 1, 240);

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO focus_items(title, default_minutes, window_keys_json, created_at, updated_at)
                VALUES($title, $defaultMinutes, $windowKeysJson, $createdAt, $updatedAt);
                SELECT last_insert_rowid();
                """;
            command.Parameters.AddWithValue("$title", title);
            command.Parameters.AddWithValue("$defaultMinutes", normalizedMinutes);
            command.Parameters.AddWithValue("$windowKeysJson", windowKeyJson);
            command.Parameters.AddWithValue("$createdAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
            var id = (long)(command.ExecuteScalar() ?? 0L);

            var item = new FocusItem
            {
                Id = id,
                Title = title,
                DefaultMinutes = normalizedMinutes
            };
            item.SetWindowKeys(ParseWindowKeyJson(windowKeyJson));
            return item;
        }
    }

    public void UpdateFocusItem(long id, string title, int defaultMinutes, IReadOnlyCollection<string> windowKeys)
    {
        var nowUtc = DateTime.UtcNow;
        var windowKeyJson = SerializeWindowKeys(windowKeys);
        var normalizedMinutes = Math.Clamp(defaultMinutes, 1, 240);

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                UPDATE focus_items
                SET title = $title,
                    default_minutes = $defaultMinutes,
                    window_keys_json = $windowKeysJson,
                    updated_at = $updatedAt
                WHERE id = $id;
                """;
            command.Parameters.AddWithValue("$title", title);
            command.Parameters.AddWithValue("$defaultMinutes", normalizedMinutes);
            command.Parameters.AddWithValue("$windowKeysJson", windowKeyJson);
            command.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
    }

    public void DeleteFocusItem(long id)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM focus_items WHERE id = $id;";
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
    }

    public long GetTotalFocusSecondsForWindows(IReadOnlyCollection<string> windowKeys)
    {
        if (windowKeys.Count == 0)
        {
            return 0;
        }

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();

            var distinctKeys = windowKeys
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            if (distinctKeys.Count == 0)
            {
                return 0;
            }

            var parameterNames = new List<string>(distinctKeys.Count);
            for (var i = 0; i < distinctKeys.Count; i++)
            {
                var parameterName = $"$key{i}";
                parameterNames.Add(parameterName);
                command.Parameters.AddWithValue(parameterName, distinctKeys[i]);
            }

            command.CommandText =
                $"""
                SELECT COALESCE(SUM(duration_seconds), 0)
                FROM focus_sessions
                WHERE window_key IN ({string.Join(", ", parameterNames)});
                """;
            var scalar = command.ExecuteScalar();
            return Convert.ToInt64(scalar ?? 0L, CultureInfo.InvariantCulture);
        }
    }

    public IReadOnlyList<FocusPlanTemplate> GetFocusPlanTemplates()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT t.id,
                       t.name,
                       t.cycle_count,
                       t.updated_at,
                       (
                           SELECT COUNT(*)
                           FROM focus_plan_template_steps s
                           WHERE s.template_id = t.id
                       ) AS step_count
                FROM focus_plan_templates t
                ORDER BY t.updated_at DESC, t.id DESC;
                """;
            using var reader = command.ExecuteReader();
            var result = new List<FocusPlanTemplate>();
            while (reader.Read())
            {
                result.Add(new FocusPlanTemplate
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    CycleCount = reader.GetInt32(2),
                    UpdatedAtUtc = ParseUtc(reader.GetString(3)),
                    StepCount = reader.GetInt32(4)
                });
            }

            return result;
        }
    }

    public long SaveFocusPlanTemplate(string name, int cycleCount, IReadOnlyList<FocusPlanTemplateStepRecord> steps)
    {
        var nowUtc = DateTime.UtcNow;
        var normalizedCycleCount = Math.Clamp(cycleCount, -100000, 100000);

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();

            long templateId;
            using (var existsCommand = connection.CreateCommand())
            {
                existsCommand.Transaction = transaction;
                existsCommand.CommandText = "SELECT id FROM focus_plan_templates WHERE name = $name LIMIT 1;";
                existsCommand.Parameters.AddWithValue("$name", name);
                var scalar = existsCommand.ExecuteScalar();
                templateId = scalar is null || scalar == DBNull.Value
                    ? 0
                    : Convert.ToInt64(scalar, CultureInfo.InvariantCulture);
            }

            if (templateId > 0)
            {
                using var updateCommand = connection.CreateCommand();
                updateCommand.Transaction = transaction;
                updateCommand.CommandText =
                    """
                    UPDATE focus_plan_templates
                    SET cycle_count = $cycleCount,
                        updated_at = $updatedAt
                    WHERE id = $id;
                    """;
                updateCommand.Parameters.AddWithValue("$cycleCount", normalizedCycleCount);
                updateCommand.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                updateCommand.Parameters.AddWithValue("$id", templateId);
                updateCommand.ExecuteNonQuery();
            }
            else
            {
                using var insertCommand = connection.CreateCommand();
                insertCommand.Transaction = transaction;
                insertCommand.CommandText =
                    """
                    INSERT INTO focus_plan_templates(name, cycle_count, created_at, updated_at)
                    VALUES($name, $cycleCount, $createdAt, $updatedAt);
                    SELECT last_insert_rowid();
                    """;
                insertCommand.Parameters.AddWithValue("$name", name);
                insertCommand.Parameters.AddWithValue("$cycleCount", normalizedCycleCount);
                insertCommand.Parameters.AddWithValue("$createdAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                insertCommand.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                templateId = Convert.ToInt64(insertCommand.ExecuteScalar() ?? 0L, CultureInfo.InvariantCulture);
            }

            using (var deleteStepsCommand = connection.CreateCommand())
            {
                deleteStepsCommand.Transaction = transaction;
                deleteStepsCommand.CommandText = "DELETE FROM focus_plan_template_steps WHERE template_id = $templateId;";
                deleteStepsCommand.Parameters.AddWithValue("$templateId", templateId);
                deleteStepsCommand.ExecuteNonQuery();
            }

            var orderedSteps = steps
                .OrderBy(step => step.StepOrder)
                .ToList();

            for (var i = 0; i < orderedSteps.Count; i++)
            {
                var step = orderedSteps[i];
                using var insertStepCommand = connection.CreateCommand();
                insertStepCommand.Transaction = transaction;
                insertStepCommand.CommandText =
                    """
                    INSERT INTO focus_plan_template_steps(template_id, step_order, focus_item_id, duration_minutes)
                    VALUES($templateId, $stepOrder, $focusItemId, $durationMinutes);
                    """;
                insertStepCommand.Parameters.AddWithValue("$templateId", templateId);
                insertStepCommand.Parameters.AddWithValue("$stepOrder", i + 1);
                insertStepCommand.Parameters.AddWithValue("$focusItemId", step.FocusItemId);
                insertStepCommand.Parameters.AddWithValue("$durationMinutes", Math.Clamp(step.DurationMinutes, 1, 240));
                insertStepCommand.ExecuteNonQuery();
            }

            transaction.Commit();
            return templateId;
        }
    }

    public FocusPlanTemplateDetail? GetFocusPlanTemplateDetail(long templateId)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();

            string? name = null;
            var cycleCount = 0;
            using (var command = connection.CreateCommand())
            {
                command.CommandText =
                    """
                    SELECT name, cycle_count
                    FROM focus_plan_templates
                    WHERE id = $id
                    LIMIT 1;
                    """;
                command.Parameters.AddWithValue("$id", templateId);
                using var reader = command.ExecuteReader();
                if (!reader.Read())
                {
                    return null;
                }

                name = reader.GetString(0);
                cycleCount = reader.GetInt32(1);
            }

            var steps = new List<FocusPlanTemplateStepRecord>();
            using (var stepCommand = connection.CreateCommand())
            {
                stepCommand.CommandText =
                    """
                    SELECT step_order, focus_item_id, duration_minutes
                    FROM focus_plan_template_steps
                    WHERE template_id = $templateId
                    ORDER BY step_order ASC, id ASC;
                    """;
                stepCommand.Parameters.AddWithValue("$templateId", templateId);
                using var stepReader = stepCommand.ExecuteReader();
                while (stepReader.Read())
                {
                    steps.Add(new FocusPlanTemplateStepRecord
                    {
                        StepOrder = stepReader.GetInt32(0),
                        FocusItemId = stepReader.GetInt64(1),
                        DurationMinutes = stepReader.GetInt32(2)
                    });
                }
            }

            return new FocusPlanTemplateDetail
            {
                TemplateId = templateId,
                Name = name,
                CycleCount = cycleCount,
                Steps = steps
            };
        }
    }

    public void DeleteFocusPlanTemplate(long templateId)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM focus_plan_templates WHERE id = $id;";
            command.Parameters.AddWithValue("$id", templateId);
            command.ExecuteNonQuery();
        }
    }

    public IReadOnlyList<TodoTask> GetActiveTodoTasks()
    {
        return GetTodoTasks(isArchived: false);
    }

    public IReadOnlyList<TodoTask> GetReminderTodoTasks()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT id, title, task_type, repeat_mode, weekly_days, monthly_days, custom_pattern,
                       reminder_enabled, reminder_year, reminder_month, reminder_day,
                       reminder_hour, reminder_minute, reminder_second, current_insight,
                       last_reminder_stamp, is_archived, created_at, updated_at, completed_at
                FROM todo_tasks
                WHERE is_archived = 0 AND reminder_enabled = 1;
                """;
            using var reader = command.ExecuteReader();

            var result = new List<TodoTask>();
            while (reader.Read())
            {
                result.Add(ReadTodoTask(reader));
            }

            return result;
        }
    }

    public IReadOnlyList<TodoArchiveGroup> GetArchivedTodoGroups()
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT ar.task_id,
                       ar.title,
                       COUNT(*) AS completed_count,
                       MAX(ar.completed_at) AS last_completed_at,
                       EXISTS(
                           SELECT 1
                           FROM todo_tasks t
                           WHERE t.id = ar.task_id AND t.is_archived = 0
                       ) AS task_still_active
                FROM todo_archive_records ar
                GROUP BY ar.task_id, ar.title
                ORDER BY MAX(ar.completed_at) DESC;
                """;
            using var reader = command.ExecuteReader();

            var result = new List<TodoArchiveGroup>();
            while (reader.Read())
            {
                result.Add(new TodoArchiveGroup
                {
                    TaskId = reader.GetInt64(0),
                    Title = reader.GetString(1),
                    CompletedCount = reader.GetInt32(2),
                    LastCompletedAtUtc = ParseUtc(reader.GetString(3)),
                    TaskStillActive = reader.GetInt64(4) == 1
                });
            }

            return result;
        }
    }

    public IReadOnlyList<TodoArchiveRecord> GetArchiveRecords(long taskId)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT id, task_id, title, insight, completed_at, task_snapshot_json
                FROM todo_archive_records
                WHERE task_id = $taskId
                ORDER BY completed_at DESC;
                """;
            command.Parameters.AddWithValue("$taskId", taskId);
            using var reader = command.ExecuteReader();

            var result = new List<TodoArchiveRecord>();
            while (reader.Read())
            {
                result.Add(new TodoArchiveRecord
                {
                    Id = reader.GetInt64(0),
                    TaskId = reader.GetInt64(1),
                    Title = reader.GetString(2),
                    Insight = reader.GetString(3),
                    CompletedAtUtc = ParseUtc(reader.GetString(4)),
                    TaskSnapshotJson = reader.GetString(5)
                });
            }

            return result;
        }
    }

    public TodoTask CreateTodoTask(TodoTask task)
    {
        var nowUtc = DateTime.UtcNow;

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO todo_tasks(
                    title, task_type, repeat_mode, weekly_days, monthly_days, custom_pattern,
                    reminder_enabled, reminder_year, reminder_month, reminder_day,
                    reminder_hour, reminder_minute, reminder_second, current_insight, last_reminder_stamp,
                    is_archived, created_at, updated_at, completed_at)
                VALUES(
                    $title, $taskType, $repeatMode, $weeklyDays, $monthlyDays, $customPattern,
                    $reminderEnabled, $reminderYear, $reminderMonth, $reminderDay,
                    $reminderHour, $reminderMinute, $reminderSecond, $currentInsight, $lastReminderStamp,
                    0, $createdAt, $updatedAt, NULL);
                SELECT last_insert_rowid();
                """;
            BindTodoTaskCommonParameters(command, task, nowUtc);
            var id = (long)(command.ExecuteScalar() ?? 0L);
            task.Id = id;
            task.CreatedAtUtc = nowUtc;
            task.UpdatedAtUtc = nowUtc;
            task.IsArchived = false;
            task.CompletedAtUtc = null;
            return task;
        }
    }

    public void UpdateTodoTask(TodoTask task)
    {
        var nowUtc = DateTime.UtcNow;

        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                UPDATE todo_tasks
                SET title = $title,
                    task_type = $taskType,
                    repeat_mode = $repeatMode,
                    weekly_days = $weeklyDays,
                    monthly_days = $monthlyDays,
                    custom_pattern = $customPattern,
                    reminder_enabled = $reminderEnabled,
                    reminder_year = $reminderYear,
                    reminder_month = $reminderMonth,
                    reminder_day = $reminderDay,
                    reminder_hour = $reminderHour,
                    reminder_minute = $reminderMinute,
                    reminder_second = $reminderSecond,
                    current_insight = $currentInsight,
                    last_reminder_stamp = $lastReminderStamp,
                    updated_at = $updatedAt
                WHERE id = $id;
                """;
            BindTodoTaskCommonParameters(command, task, nowUtc);
            command.Parameters.AddWithValue("$id", task.Id);
            command.ExecuteNonQuery();
            task.UpdatedAtUtc = nowUtc;
        }
    }

    public void UpdateTodoTaskInsight(long taskId, string insight)
    {
        var nowUtc = DateTime.UtcNow;
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                UPDATE todo_tasks
                SET current_insight = $insight, updated_at = $updatedAt
                WHERE id = $id;
                """;
            command.Parameters.AddWithValue("$insight", insight);
            command.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("$id", taskId);
            command.ExecuteNonQuery();
        }
    }

    public void UpdateTodoReminderStamp(long taskId, string stamp)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                UPDATE todo_tasks
                SET last_reminder_stamp = $stamp
                WHERE id = $id;
                """;
            command.Parameters.AddWithValue("$stamp", stamp);
            command.Parameters.AddWithValue("$id", taskId);
            command.ExecuteNonQuery();
        }
    }

    public void CompleteTodoTask(long taskId)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();

            TodoTask? task;
            using (var readCommand = connection.CreateCommand())
            {
                readCommand.Transaction = transaction;
                readCommand.CommandText =
                    """
                    SELECT id, title, task_type, repeat_mode, weekly_days, monthly_days, custom_pattern,
                           reminder_enabled, reminder_year, reminder_month, reminder_day,
                           reminder_hour, reminder_minute, reminder_second, current_insight,
                           last_reminder_stamp, is_archived, created_at, updated_at, completed_at
                    FROM todo_tasks
                    WHERE id = $id;
                    """;
                readCommand.Parameters.AddWithValue("$id", taskId);
                using var reader = readCommand.ExecuteReader();
                task = reader.Read() ? ReadTodoTask(reader) : null;
            }

            if (task is null)
            {
                transaction.Rollback();
                return;
            }

            var nowUtc = DateTime.UtcNow;
            var snapshotJson = JsonSerializer.Serialize(
                new
                {
                    task.Id,
                    task.Title,
                    task.TaskType,
                    task.RepeatMode,
                    task.WeeklyDays,
                    task.MonthlyDays,
                    task.CustomPattern,
                    task.ReminderEnabled,
                    task.ReminderYear,
                    task.ReminderMonth,
                    task.ReminderDay,
                    task.ReminderHour,
                    task.ReminderMinute,
                    task.ReminderSecond
                });

            using (var archiveCommand = connection.CreateCommand())
            {
                archiveCommand.Transaction = transaction;
                archiveCommand.CommandText =
                    """
                    INSERT INTO todo_archive_records(task_id, title, insight, completed_at, task_snapshot_json)
                    VALUES($taskId, $title, $insight, $completedAt, $snapshot);
                    """;
                archiveCommand.Parameters.AddWithValue("$taskId", task.Id);
                archiveCommand.Parameters.AddWithValue("$title", task.Title);
                archiveCommand.Parameters.AddWithValue("$insight", task.CurrentInsight ?? string.Empty);
                archiveCommand.Parameters.AddWithValue("$completedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                archiveCommand.Parameters.AddWithValue("$snapshot", snapshotJson);
                archiveCommand.ExecuteNonQuery();
            }

            using (var updateCommand = connection.CreateCommand())
            {
                updateCommand.Transaction = transaction;
                if (string.Equals(task.TaskType, TodoTaskType.OneTime, StringComparison.OrdinalIgnoreCase))
                {
                    updateCommand.CommandText =
                        """
                        UPDATE todo_tasks
                        SET is_archived = 1,
                            completed_at = $completedAt,
                            current_insight = '',
                            updated_at = $updatedAt
                        WHERE id = $id;
                        """;
                    updateCommand.Parameters.AddWithValue("$completedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                }
                else
                {
                    updateCommand.CommandText =
                        """
                        UPDATE todo_tasks
                        SET current_insight = '',
                            updated_at = $updatedAt
                        WHERE id = $id;
                        """;
                }

                updateCommand.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
                updateCommand.Parameters.AddWithValue("$id", task.Id);
                updateCommand.ExecuteNonQuery();
            }

            transaction.Commit();
        }
    }

    public void DeleteArchiveGroup(long taskId)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var transaction = connection.BeginTransaction();

            using (var deleteArchiveRecords = connection.CreateCommand())
            {
                deleteArchiveRecords.Transaction = transaction;
                deleteArchiveRecords.CommandText = "DELETE FROM todo_archive_records WHERE task_id = $taskId;";
                deleteArchiveRecords.Parameters.AddWithValue("$taskId", taskId);
                deleteArchiveRecords.ExecuteNonQuery();
            }

            using (var deleteArchivedTask = connection.CreateCommand())
            {
                deleteArchivedTask.Transaction = transaction;
                deleteArchivedTask.CommandText = "DELETE FROM todo_tasks WHERE id = $taskId AND is_archived = 1;";
                deleteArchivedTask.Parameters.AddWithValue("$taskId", taskId);
                deleteArchivedTask.ExecuteNonQuery();
            }

            transaction.Commit();
        }
    }

    private IReadOnlyList<TodoTask> GetTodoTasks(bool isArchived)
    {
        lock (_syncRoot)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                SELECT id, title, task_type, repeat_mode, weekly_days, monthly_days, custom_pattern,
                       reminder_enabled, reminder_year, reminder_month, reminder_day,
                       reminder_hour, reminder_minute, reminder_second, current_insight,
                       last_reminder_stamp, is_archived, created_at, updated_at, completed_at
                FROM todo_tasks
                WHERE is_archived = $isArchived
                ORDER BY updated_at DESC, id DESC;
                """;
            command.Parameters.AddWithValue("$isArchived", isArchived ? 1 : 0);
            using var reader = command.ExecuteReader();

            var result = new List<TodoTask>();
            while (reader.Read())
            {
                result.Add(ReadTodoTask(reader));
            }

            return result;
        }
    }

    private static TodoTask ReadTodoTask(SqliteDataReader reader)
    {
        return new TodoTask
        {
            Id = reader.GetInt64(0),
            Title = reader.GetString(1),
            TaskType = TodoTaskType.Normalize(reader.GetString(2)),
            RepeatMode = TodoRepeatMode.Normalize(reader.GetString(3)),
            WeeklyDays = reader.GetString(4),
            MonthlyDays = reader.GetString(5),
            CustomPattern = reader.GetString(6),
            ReminderEnabled = reader.GetInt64(7) == 1,
            ReminderYear = GetNullableInt(reader, 8),
            ReminderMonth = GetNullableInt(reader, 9),
            ReminderDay = GetNullableInt(reader, 10),
            ReminderHour = reader.GetInt32(11),
            ReminderMinute = reader.GetInt32(12),
            ReminderSecond = reader.GetInt32(13),
            CurrentInsight = reader.GetString(14),
            LastReminderStamp = reader.GetString(15),
            IsArchived = reader.GetInt64(16) == 1,
            CreatedAtUtc = ParseUtc(reader.GetString(17)),
            UpdatedAtUtc = ParseUtc(reader.GetString(18)),
            CompletedAtUtc = reader.IsDBNull(19) ? null : ParseUtc(reader.GetString(19))
        };
    }

    private static int? GetNullableInt(SqliteDataReader reader, int ordinal)
    {
        return reader.IsDBNull(ordinal) ? null : reader.GetInt32(ordinal);
    }

    private static void BindTodoTaskCommonParameters(SqliteCommand command, TodoTask task, DateTime nowUtc)
    {
        command.Parameters.AddWithValue("$title", task.Title);
        command.Parameters.AddWithValue("$taskType", task.TaskType);
        command.Parameters.AddWithValue("$repeatMode", task.RepeatMode);
        command.Parameters.AddWithValue("$weeklyDays", task.WeeklyDays ?? string.Empty);
        command.Parameters.AddWithValue("$monthlyDays", task.MonthlyDays ?? string.Empty);
        command.Parameters.AddWithValue("$customPattern", task.CustomPattern ?? string.Empty);
        command.Parameters.AddWithValue("$reminderEnabled", task.ReminderEnabled ? 1 : 0);
        command.Parameters.AddWithValue("$reminderYear", (object?)task.ReminderYear ?? DBNull.Value);
        command.Parameters.AddWithValue("$reminderMonth", (object?)task.ReminderMonth ?? DBNull.Value);
        command.Parameters.AddWithValue("$reminderDay", (object?)task.ReminderDay ?? DBNull.Value);
        command.Parameters.AddWithValue("$reminderHour", task.ReminderHour);
        command.Parameters.AddWithValue("$reminderMinute", task.ReminderMinute);
        command.Parameters.AddWithValue("$reminderSecond", task.ReminderSecond);
        command.Parameters.AddWithValue("$currentInsight", task.CurrentInsight ?? string.Empty);
        command.Parameters.AddWithValue("$lastReminderStamp", task.LastReminderStamp ?? string.Empty);
        command.Parameters.AddWithValue("$createdAt", task.CreatedAtUtc == default
            ? nowUtc.ToString("O", CultureInfo.InvariantCulture)
            : task.CreatedAtUtc.ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$updatedAt", nowUtc.ToString("O", CultureInfo.InvariantCulture));
    }

    private static string SerializeWindowKeys(IReadOnlyCollection<string> windowKeys)
    {
        var distinctKeys = windowKeys
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return JsonSerializer.Serialize(distinctKeys);
    }

    private static IReadOnlyList<string> ParseWindowKeyJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            var deserialized = JsonSerializer.Deserialize<List<string>>(json);
            if (deserialized is null)
            {
                return [];
            }

            return deserialized
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    private void MigrateLegacyTodos(SqliteConnection connection)
    {
        using var countCommand = connection.CreateCommand();
        countCommand.CommandText = "SELECT COUNT(*) FROM todo_tasks;";
        var currentCount = Convert.ToInt64(countCommand.ExecuteScalar() ?? 0L, CultureInfo.InvariantCulture);
        if (currentCount > 0)
        {
            return;
        }

        using var existsCommand = connection.CreateCommand();
        existsCommand.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'todos';";
        var hasLegacyTodoTable = Convert.ToInt64(existsCommand.ExecuteScalar() ?? 0L, CultureInfo.InvariantCulture) > 0;
        if (!hasLegacyTodoTable)
        {
            return;
        }

        using var migrateCommand = connection.CreateCommand();
        migrateCommand.CommandText =
            """
            INSERT INTO todo_tasks(
                title, task_type, repeat_mode, weekly_days, monthly_days, custom_pattern,
                reminder_enabled, reminder_year, reminder_month, reminder_day,
                reminder_hour, reminder_minute, reminder_second, current_insight, last_reminder_stamp,
                is_archived, created_at, updated_at, completed_at)
            SELECT content, '一次性', '每日', '', '', '',
                   0, NULL, NULL, NULL,
                   9, 0, 0, '', '',
                   is_done, created_at, updated_at,
                   CASE WHEN is_done = 1 THEN updated_at ELSE NULL END
            FROM todos;
            """;
        migrateCommand.ExecuteNonQuery();

        using var archiveCommand = connection.CreateCommand();
        archiveCommand.CommandText =
            """
            INSERT INTO todo_archive_records(task_id, title, insight, completed_at, task_snapshot_json)
            SELECT t.id, t.title, '', t.updated_at, '{}'
            FROM todo_tasks t
            WHERE t.is_archived = 1;
            """;
        archiveCommand.ExecuteNonQuery();
    }

    private static void EnsureDefaultProcessCategories(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT OR IGNORE INTO process_categories(process_name, category)
            VALUES($processName, $category);
            """;
        command.Parameters.AddWithValue("$processName", WindowCategory.DesktopProcess);
        command.Parameters.AddWithValue("$category", WindowCategory.Rest);
        command.ExecuteNonQuery();
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={_databasePath}");
        connection.Open();
        return connection;
    }

    private static DateTime ParseUtc(string value)
    {
        return DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();
    }
}
