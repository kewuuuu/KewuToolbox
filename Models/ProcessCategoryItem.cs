using WindowMonitorApp.Infrastructure;

namespace WindowMonitorApp.Models;

public sealed class ProcessCategoryItem : ObservableObject
{
    private string _category = WindowCategory.Other;

    public required string ProcessName { get; init; }

    public string Category
    {
        get => _category;
        set => SetProperty(ref _category, value);
    }
}
