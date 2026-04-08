namespace WindowMonitorApp.Models;

public sealed class TrackedWindow
{
    public required string WindowKey { get; init; }

    public required string ProcessName { get; init; }

    public required string Title { get; init; }
}
