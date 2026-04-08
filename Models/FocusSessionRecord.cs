namespace WindowMonitorApp.Models;

public sealed class FocusSessionRecord
{
    public required string WindowKey { get; init; }

    public required string ProcessName { get; init; }

    public required string Title { get; init; }

    public DateTime StartedAtUtc { get; init; }

    public DateTime EndedAtUtc { get; init; }

    public long DurationSeconds { get; init; }
}
