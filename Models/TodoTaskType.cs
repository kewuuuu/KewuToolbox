namespace WindowMonitorApp.Models;

public static class TodoTaskType
{
    public const string OneTime = "一次性";
    public const string Repeat = "重复";

    public static readonly IReadOnlyList<string> All =
    [
        OneTime,
        Repeat
    ];

    public static string Normalize(string? taskType)
    {
        if (string.IsNullOrWhiteSpace(taskType))
        {
            return OneTime;
        }

        return taskType.Trim().ToLowerInvariant() switch
        {
            "onetime" or "一次性" => OneTime,
            "repeat" or "重复" => Repeat,
            _ => OneTime
        };
    }
}
