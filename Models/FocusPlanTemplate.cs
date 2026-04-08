namespace WindowMonitorApp.Models;

public sealed class FocusPlanTemplate
{
    public long Id { get; init; }

    public required string Name { get; init; }

    public int CycleCount { get; init; }

    public int StepCount { get; init; }

    public DateTime UpdatedAtUtc { get; init; }

    public string UpdatedAtLocalText => UpdatedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm");

    public string SummaryText => $"步骤数：{StepCount}，循环：{CycleCount}";
}
