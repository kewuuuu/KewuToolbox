namespace WindowMonitorApp.Models;

public static class TodoRepeatMode
{
    public const string Daily = "每日";
    public const string Weekly = "每周";
    public const string Monthly = "每月";
    public const string Custom = "自定义";

    public static readonly IReadOnlyList<string> All =
    [
        Daily,
        Weekly,
        Monthly,
        Custom
    ];

    public static string Normalize(string? repeatMode)
    {
        if (string.IsNullOrWhiteSpace(repeatMode))
        {
            return Daily;
        }

        return repeatMode.Trim().ToLowerInvariant() switch
        {
            "daily" or "每日" => Daily,
            "weekly" or "每周" => Weekly,
            "monthly" or "每月" => Monthly,
            "custom" or "自定义" => Custom,
            _ => Daily
        };
    }
}
