using WindowMonitorApp.Utilities;

namespace WindowMonitorApp.Models;

public sealed class WindowUsageStat
{
    public required string WindowKey { get; init; }

    public required string ProcessName { get; init; }

    public required string Title { get; init; }

    public long TotalSeconds { get; init; }

    public long FocusSeconds { get; init; }

    public DateTime LastSeenAtUtc { get; init; }

    public string TotalDurationText => DurationFormatter.Format(TotalSeconds);

    public string FocusDurationText => DurationFormatter.Format(FocusSeconds);

    public string LastSeenLocalText => LastSeenAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}
