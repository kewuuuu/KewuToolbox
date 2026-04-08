using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class TodoItem : ObservableObject
{
    private bool _isDone;
    private string _content = string.Empty;
    private DateTime _updatedAtUtc;

    public long Id { get; init; }

    public string Content
    {
        get => _content;
        set => SetProperty(ref _content, value);
    }

    public bool IsDone
    {
        get => _isDone;
        set => SetProperty(ref _isDone, value);
    }

    public DateTime CreatedAtUtc { get; init; }

    public DateTime UpdatedAtUtc
    {
        get => _updatedAtUtc;
        set => SetProperty(ref _updatedAtUtc, value);
    }

    public string CreatedAtLocalText => CreatedAtUtc.ToLocalTime().ToString("MM-dd HH:mm");
}
