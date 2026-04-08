namespace WindowMonitorApp.Models;

public static class WindowCategory
{
    public const string Study = "学习";
    public const string Entertainment = "娱乐";
    public const string Social = "社交";
    public const string Rest = "休息";
    public const string Other = "其他";

    public static readonly IReadOnlyList<string> All =
    [
        Study,
        Entertainment,
        Social,
        Rest,
        Other
    ];

    public const string DesktopProcess = "Desktop";

    public const string DesktopDisplayName = "桌面";

    public static string Normalize(string? category)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            return Other;
        }

        return category.Trim().ToLowerInvariant() switch
        {
            "study" or "学习" => Study,
            "entertainment" or "娱乐" => Entertainment,
            "social" or "社交" => Social,
            "rest" or "休息" => Rest,
            "other" or "其他" => Other,
            _ => Other
        };
    }
}
