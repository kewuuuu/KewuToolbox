using WindowMonitorApp.Infrastructure;
using WindowMonitorApp.Utilities;

namespace WindowMonitorApp.Models;

public sealed class FocusItem : ObservableObject
{
    private string _title = string.Empty;
    private int _defaultMinutes = 25;
    private List<string> _windowKeys = [];
    private long _totalFocusSeconds;

    public long Id { get; set; }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    public int DefaultMinutes
    {
        get => _defaultMinutes;
        set => SetProperty(ref _defaultMinutes, value);
    }

    public IReadOnlyList<string> WindowKeys => _windowKeys;

    public long TotalFocusSeconds
    {
        get => _totalFocusSeconds;
        set
        {
            if (!SetProperty(ref _totalFocusSeconds, value))
            {
                return;
            }

            OnPropertyChanged(nameof(TotalFocusDurationText));
        }
    }

    public string TotalFocusDurationText => DurationFormatter.Format(TotalFocusSeconds);

    public string WindowSummaryText
    {
        get
        {
            if (_windowKeys.Count == 0)
            {
                return "未选择窗口";
            }

            var labels = _windowKeys
                .Select(BuildWindowLabel)
                .Take(3)
                .ToList();
            var suffix = _windowKeys.Count > 3 ? " 等" : string.Empty;
            return string.Join("、", labels) + suffix;
        }
    }

    public void SetWindowKeys(IEnumerable<string> keys)
    {
        _windowKeys = keys
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        OnPropertyChanged(nameof(WindowKeys));
        OnPropertyChanged(nameof(WindowSummaryText));
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
