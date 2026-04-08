using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class FocusWindowOption : ObservableObject
{
    private bool _isSelected;

    public required string WindowKey { get; init; }

    public required string ProcessName { get; init; }

    public required string Title { get; init; }

    public string DisplayName
    {
        get
        {
            var process = ProcessName.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase)
                ? WindowCategory.DesktopDisplayName
                : ProcessName;
            var title = Title.Equals("Desktop", StringComparison.OrdinalIgnoreCase)
                ? WindowCategory.DesktopDisplayName
                : Title;
            return $"{process} - {title}";
        }
    }

    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}
