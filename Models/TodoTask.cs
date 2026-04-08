using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class TodoTask : ObservableObject
{
    private string _title = string.Empty;
    private string _taskType = TodoTaskType.OneTime;
    private string _repeatMode = TodoRepeatMode.Daily;
    private string _weeklyDays = string.Empty;
    private string _monthlyDays = string.Empty;
    private string _customPattern = string.Empty;
    private bool _reminderEnabled;
    private int? _reminderYear;
    private int? _reminderMonth;
    private int? _reminderDay;
    private int _reminderHour;
    private int _reminderMinute;
    private int _reminderSecond;
    private string _currentInsight = string.Empty;
    private string _lastReminderStamp = string.Empty;
    private bool _isArchived;
    private DateTime _updatedAtUtc;

    public long Id { get; set; }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    public string TaskType
    {
        get => _taskType;
        set => SetProperty(ref _taskType, value);
    }

    public string RepeatMode
    {
        get => _repeatMode;
        set => SetProperty(ref _repeatMode, value);
    }

    public string WeeklyDays
    {
        get => _weeklyDays;
        set => SetProperty(ref _weeklyDays, value);
    }

    public string MonthlyDays
    {
        get => _monthlyDays;
        set => SetProperty(ref _monthlyDays, value);
    }

    public string CustomPattern
    {
        get => _customPattern;
        set => SetProperty(ref _customPattern, value);
    }

    public bool ReminderEnabled
    {
        get => _reminderEnabled;
        set => SetProperty(ref _reminderEnabled, value);
    }

    public int? ReminderYear
    {
        get => _reminderYear;
        set => SetProperty(ref _reminderYear, value);
    }

    public int? ReminderMonth
    {
        get => _reminderMonth;
        set => SetProperty(ref _reminderMonth, value);
    }

    public int? ReminderDay
    {
        get => _reminderDay;
        set => SetProperty(ref _reminderDay, value);
    }

    public int ReminderHour
    {
        get => _reminderHour;
        set => SetProperty(ref _reminderHour, value);
    }

    public int ReminderMinute
    {
        get => _reminderMinute;
        set => SetProperty(ref _reminderMinute, value);
    }

    public int ReminderSecond
    {
        get => _reminderSecond;
        set => SetProperty(ref _reminderSecond, value);
    }

    public string CurrentInsight
    {
        get => _currentInsight;
        set => SetProperty(ref _currentInsight, value);
    }

    public string LastReminderStamp
    {
        get => _lastReminderStamp;
        set => SetProperty(ref _lastReminderStamp, value);
    }

    public bool IsArchived
    {
        get => _isArchived;
        set => SetProperty(ref _isArchived, value);
    }

    public DateTime CreatedAtUtc { get; set; }

    public DateTime UpdatedAtUtc
    {
        get => _updatedAtUtc;
        set => SetProperty(ref _updatedAtUtc, value);
    }

    public DateTime? CompletedAtUtc { get; set; }

    public string SummaryText => $"{TaskType} / {RepeatMode}";

    public string CreatedAtLocalText => CreatedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm");

    public string UpdatedAtLocalText => UpdatedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
}
