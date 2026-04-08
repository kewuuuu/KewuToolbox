using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class FocusPlanStep : ObservableObject
{
    private string _durationMinutesInput = "25";

    public required long FocusItemId { get; init; }

    public required string Title { get; init; }

    public required IReadOnlyList<string> WindowKeys { get; init; }

    public string DurationMinutesInput
    {
        get => _durationMinutesInput;
        set
        {
            if (!SetProperty(ref _durationMinutesInput, value))
            {
                return;
            }

            OnPropertyChanged(nameof(DurationMinutes));
        }
    }

    public int DurationMinutes
    {
        get
        {
            return int.TryParse(DurationMinutesInput, out var parsed)
                ? Math.Clamp(parsed, 1, 240)
                : 25;
        }
    }

    public string WindowSummaryText
    {
        get
        {
            if (WindowKeys.Count == 0)
            {
                return "未选择窗口";
            }

            var labels = WindowKeys
                .Select(BuildWindowLabel)
                .Take(3)
                .ToList();
            var suffix = WindowKeys.Count > 3 ? " 等" : string.Empty;
            return string.Join("、", labels) + suffix;
        }
    }

    private static string BuildWindowLabel(string windowKey)
    {
        var splitIndex = windowKey.IndexOf('|');
        if (splitIndex <= 0 || splitIndex >= windowKey.Length - 1)
        {
            return windowKey;
        }

        var process = windowKey[..splitIndex];
        var title = windowKey[(splitIndex + 1)..];
        if (process.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase))
        {
            return WindowCategory.DesktopDisplayName;
        }

        if (title.Equals("Desktop", StringComparison.OrdinalIgnoreCase))
        {
            title = WindowCategory.DesktopDisplayName;
        }

        return $"{process} - {title}";
    }
}
