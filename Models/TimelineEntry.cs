namespace WindowMonitorApp.Models;

public sealed class TimelineEntry
{
    public required DateTime TimeLocal { get; init; }

    public string EndTimeLocalText { get; init; } = string.Empty;

    public required string Label { get; init; }

    public bool IsPowerEvent { get; init; }

    public string Marker { get; init; } = string.Empty;

    public string MarkerColorHex { get; init; } = "#64748B";

    public string TimeLocalText => TimeLocal.ToString("yyyy-MM-dd HH:mm:ss");
}
