namespace WindowMonitorApp.Models;

public sealed class FocusPlanTemplateDetail
{
    public long TemplateId { get; init; }

    public required string Name { get; init; }

    public int CycleCount { get; init; }

    public required IReadOnlyList<FocusPlanTemplateStepRecord> Steps { get; init; }
}

public sealed class FocusPlanTemplateStepRecord
{
    public int StepOrder { get; init; }

    public long FocusItemId { get; init; }

    public int DurationMinutes { get; init; }
}
