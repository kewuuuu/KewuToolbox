namespace WindowMonitorApp.Models;

public sealed class TodoArchiveGroup
{
    public long TaskId { get; init; }

    public string Title { get; init; } = string.Empty;

    public int CompletedCount { get; init; }

    public DateTime LastCompletedAtUtc { get; init; }

    public bool TaskStillActive { get; init; }

    public string LastCompletedAtLocalText => LastCompletedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}
