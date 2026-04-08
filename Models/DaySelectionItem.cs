using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class DaySelectionItem : ObservableObject
{
    private bool _isSelected;

    public required int Day { get; init; }

    public string Label => Day.ToString();

    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}
