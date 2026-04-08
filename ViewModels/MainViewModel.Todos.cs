using System.Globalization;
using WindowMonitorApp.Infrastructure;
using WindowMonitorApp.Models;
using WpfMessageBox = System.Windows.MessageBox;

namespace WindowMonitorApp.ViewModels;

public sealed partial class MainViewModel
{
    private bool CanCreateTodoTask()
    {
        return !string.IsNullOrWhiteSpace(DraftTitle);
    }

    private bool CanSaveSelectedTodoTask()
    {
        return SelectedActiveTask is not null && !string.IsNullOrWhiteSpace(EditTitle);
    }

    private bool CanDeleteArchiveGroup(object? parameter)
    {
        return parameter is TodoArchiveGroup || SelectedArchiveGroup is not null;
    }

    private void RaiseTodoCommandCanExecuteChanged()
    {
        (CreateTodoCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (SaveSelectedTodoCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (DeleteArchiveGroupCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (AdjustDraftReminderValueCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (AdjustEditReminderValueCommand as RelayCommand)?.RaiseCanExecuteChanged();
    }

    private void SetDefaultDraftReminderTime()
    {
        var now = DateTime.Now;
        DraftReminderHour = now.Hour.ToString(CultureInfo.InvariantCulture);
        DraftReminderMinute = now.Minute.ToString(CultureInfo.InvariantCulture);
        DraftReminderSecond = now.Second.ToString(CultureInfo.InvariantCulture);
    }

    private void CreateTodoTask()
    {
        if (string.IsNullOrWhiteSpace(DraftTitle))
        {
            WpfMessageBox.Show("标题不能为空。", "创建待办", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        if (!TryParseReminder(
                DraftReminderYear,
                DraftReminderMonth,
                DraftReminderDay,
                DraftReminderHour,
                DraftReminderMinute,
                DraftReminderSecond,
                out var reminderYear,
                out var reminderMonth,
                out var reminderDay,
                out var reminderHour,
                out var reminderMinute,
                out var reminderSecond))
        {
            WpfMessageBox.Show("提醒时间输入无效。", "创建待办", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        var task = new TodoTask
        {
            Title = DraftTitle.Trim(),
            TaskType = DraftTaskType,
            RepeatMode = DraftRepeatMode,
            WeeklyDays = BuildDayCsv(DraftWeeklyDays),
            MonthlyDays = BuildDayCsv(DraftMonthlyDays),
            CustomPattern = DraftCustomPattern.Trim(),
            ReminderEnabled = DraftReminderEnabled,
            ReminderYear = reminderYear,
            ReminderMonth = reminderMonth,
            ReminderDay = reminderDay,
            ReminderHour = reminderHour,
            ReminderMinute = reminderMinute,
            ReminderSecond = reminderSecond,
            CurrentInsight = string.Empty,
            LastReminderStamp = string.Empty
        };

        _database.CreateTodoTask(task);
        TodoStatusText = $"已创建待办：{task.Title}";
        ResetDraftForm();
        RefreshDataFromDatabase();
        SelectedActiveTask = ActiveTodoTasks.FirstOrDefault(item => item.Id == task.Id);
    }

    private void ResetDraftForm()
    {
        DraftTitle = string.Empty;
        DraftTaskType = TodoTaskType.OneTime;
        DraftRepeatMode = TodoRepeatMode.Daily;
        DraftCustomPattern = string.Empty;
        DraftReminderEnabled = false;
        DraftReminderYear = string.Empty;
        DraftReminderMonth = string.Empty;
        DraftReminderDay = string.Empty;
        SetDefaultDraftReminderTime();
        ClearDaySelection(DraftWeeklyDays);
        ClearDaySelection(DraftMonthlyDays);
        IsCreateTodoPanelExpanded = false;
    }

    private void CompleteTodoTask(object? parameter)
    {
        if (parameter is not TodoTask task)
        {
            return;
        }

        _database.CompleteTodoTask(task.Id);
        TodoStatusText = $"已完成待办：{task.Title}";
        RefreshDataFromDatabase();
    }

    private void SaveSelectedTaskSettings()
    {
        var task = SelectedActiveTask;
        if (task is null)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(EditTitle))
        {
            WpfMessageBox.Show("标题不能为空。", "保存待办", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        if (!TryParseReminder(
                EditReminderYear,
                EditReminderMonth,
                EditReminderDay,
                EditReminderHour,
                EditReminderMinute,
                EditReminderSecond,
                out var reminderYear,
                out var reminderMonth,
                out var reminderDay,
                out var reminderHour,
                out var reminderMinute,
                out var reminderSecond))
        {
            WpfMessageBox.Show("提醒时间输入无效。", "保存待办", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        task.Title = EditTitle.Trim();
        task.TaskType = EditTaskType;
        task.RepeatMode = EditRepeatMode;
        task.WeeklyDays = BuildDayCsv(EditWeeklyDays);
        task.MonthlyDays = BuildDayCsv(EditMonthlyDays);
        task.CustomPattern = EditCustomPattern.Trim();
        task.ReminderEnabled = EditReminderEnabled;
        task.ReminderYear = reminderYear;
        task.ReminderMonth = reminderMonth;
        task.ReminderDay = reminderDay;
        task.ReminderHour = reminderHour;
        task.ReminderMinute = reminderMinute;
        task.ReminderSecond = reminderSecond;
        task.CurrentInsight = EditInsight;

        _database.UpdateTodoTask(task);
        TodoStatusText = $"已更新待办：{task.Title}";
        RefreshDataFromDatabase();
    }

    private void LoadSelectedTaskEditor(TodoTask task)
    {
        _isLoadingEditor = true;
        EditTitle = task.Title;
        EditTaskType = task.TaskType;
        EditRepeatMode = task.RepeatMode;
        EditCustomPattern = task.CustomPattern;
        EditReminderEnabled = task.ReminderEnabled;
        EditReminderYear = task.ReminderYear?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
        EditReminderMonth = task.ReminderMonth?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
        EditReminderDay = task.ReminderDay?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
        EditReminderHour = task.ReminderHour.ToString(CultureInfo.InvariantCulture);
        EditReminderMinute = task.ReminderMinute.ToString(CultureInfo.InvariantCulture);
        EditReminderSecond = task.ReminderSecond.ToString(CultureInfo.InvariantCulture);
        EditInsight = task.CurrentInsight;
        ApplyDayCsv(task.WeeklyDays, EditWeeklyDays);
        ApplyDayCsv(task.MonthlyDays, EditMonthlyDays);
        _isLoadingEditor = false;
    }

    private void AutoSaveSelectedInsight()
    {
        _insightAutoSaveTimer.Stop();
        if (!_hasPendingInsightSave || SelectedActiveTask is null)
        {
            return;
        }

        _hasPendingInsightSave = false;
        SelectedActiveTask.CurrentInsight = EditInsight;
        _database.UpdateTodoTaskInsight(SelectedActiveTask.Id, EditInsight);
        TodoStatusText = $"心得已自动保存：{DateTime.Now:HH:mm:ss}";
    }

    private void LoadArchiveRecords(long taskId)
    {
        ReplaceCollection(SelectedArchiveRecords, _database.GetArchiveRecords(taskId));
    }

    private void DeleteArchiveGroup(object? parameter)
    {
        var group = parameter as TodoArchiveGroup ?? SelectedArchiveGroup;
        if (group is null)
        {
            return;
        }

        var firstConfirm = WpfMessageBox.Show(
            $"确认删除归档组“{group.Title}”？",
            "删除归档",
            System.Windows.MessageBoxButton.YesNo,
            System.Windows.MessageBoxImage.Warning);
        if (firstConfirm != System.Windows.MessageBoxResult.Yes)
        {
            return;
        }

        var secondConfirm = WpfMessageBox.Show(
            "该操作不可撤销，确认删除？",
            "删除归档",
            System.Windows.MessageBoxButton.YesNo,
            System.Windows.MessageBoxImage.Warning);
        if (secondConfirm != System.Windows.MessageBoxResult.Yes)
        {
            return;
        }

        _database.DeleteArchiveGroup(group.TaskId);
        TodoStatusText = $"已删除归档：{group.Title}";
        RefreshDataFromDatabase();
    }

    private void AdjustDraftReminderValue(object? parameter)
    {
        AdjustReminderValue(parameter, isDraft: true);
    }

    private void AdjustEditReminderValue(object? parameter)
    {
        AdjustReminderValue(parameter, isDraft: false);
    }

    private void AdjustReminderValue(object? parameter, bool isDraft)
    {
        var token = parameter as string;
        if (string.IsNullOrWhiteSpace(token))
        {
            return;
        }

        var parts = token.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || !int.TryParse(parts[1], out var delta))
        {
            return;
        }

        var field = parts[0].ToLowerInvariant();
        if (isDraft)
        {
            switch (field)
            {
                case "year":
                    DraftReminderYear = AdjustNumericText(DraftReminderYear, delta, 1, 9999, allowEmpty: true);
                    break;
                case "month":
                    DraftReminderMonth = AdjustNumericText(DraftReminderMonth, delta, 1, 12, allowEmpty: true);
                    break;
                case "day":
                    DraftReminderDay = AdjustNumericText(DraftReminderDay, delta, 1, 31, allowEmpty: true);
                    break;
                case "hour":
                    DraftReminderHour = AdjustNumericText(DraftReminderHour, delta, 0, 23, allowEmpty: false);
                    break;
                case "minute":
                    DraftReminderMinute = AdjustNumericText(DraftReminderMinute, delta, 0, 59, allowEmpty: false);
                    break;
                case "second":
                    DraftReminderSecond = AdjustNumericText(DraftReminderSecond, delta, 0, 59, allowEmpty: false);
                    break;
            }
        }
        else
        {
            switch (field)
            {
                case "year":
                    EditReminderYear = AdjustNumericText(EditReminderYear, delta, 1, 9999, allowEmpty: true);
                    break;
                case "month":
                    EditReminderMonth = AdjustNumericText(EditReminderMonth, delta, 1, 12, allowEmpty: true);
                    break;
                case "day":
                    EditReminderDay = AdjustNumericText(EditReminderDay, delta, 1, 31, allowEmpty: true);
                    break;
                case "hour":
                    EditReminderHour = AdjustNumericText(EditReminderHour, delta, 0, 23, allowEmpty: false);
                    break;
                case "minute":
                    EditReminderMinute = AdjustNumericText(EditReminderMinute, delta, 0, 59, allowEmpty: false);
                    break;
                case "second":
                    EditReminderSecond = AdjustNumericText(EditReminderSecond, delta, 0, 59, allowEmpty: false);
                    break;
            }
        }
    }

    private static string AdjustNumericText(string input, int delta, int min, int max, bool allowEmpty)
    {
        if (!int.TryParse(input, NumberStyles.Integer, CultureInfo.InvariantCulture, out var current))
        {
            if (allowEmpty && string.IsNullOrWhiteSpace(input) && delta < 0)
            {
                return string.Empty;
            }

            current = min;
        }

        var next = Math.Clamp(current + delta, min, max);
        return next.ToString(CultureInfo.InvariantCulture);
    }

    private void EvaluateTodoReminders()
    {
        var now = DateTime.Now;
        foreach (var task in ActiveTodoTasks)
        {
            if (!task.ReminderEnabled)
            {
                continue;
            }

            if (!IsReminderMatched(task, now))
            {
                continue;
            }

            var stamp = now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
            if (string.Equals(task.LastReminderStamp, stamp, StringComparison.Ordinal))
            {
                continue;
            }

            _notificationService.Notify("待办提醒", task.Title);
            task.LastReminderStamp = stamp;
            _database.UpdateTodoReminderStamp(task.Id, stamp);
            TodoStatusText = $"提醒触发：{task.Title}";
        }
    }

    private static bool IsReminderMatched(TodoTask task, DateTime now)
    {
        if (task.ReminderYear.HasValue && task.ReminderYear.Value != now.Year)
        {
            return false;
        }

        if (task.ReminderMonth.HasValue && task.ReminderMonth.Value != now.Month)
        {
            return false;
        }

        if (task.ReminderDay.HasValue && task.ReminderDay.Value != now.Day)
        {
            return false;
        }

        return task.ReminderHour == now.Hour &&
               task.ReminderMinute == now.Minute &&
               task.ReminderSecond == now.Second;
    }
}
