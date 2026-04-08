namespace WindowMonitorApp.Models;

public sealed class TodoArchiveRecord
{
    public long Id { get; init; }

    public long TaskId { get; init; }

    public string Title { get; init; } = string.Empty;

    public string Insight { get; init; } = string.Empty;

    public DateTime CompletedAtUtc { get; init; }

    public string TaskSnapshotJson { get; init; } = string.Empty;

    public string CompletedAtLocalText => CompletedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}
