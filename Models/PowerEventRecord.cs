namespace WindowMonitorApp.Models;

public sealed class PowerEventRecord
{
    public required string EventType { get; init; }

    public DateTime OccurredAtUtc { get; init; }

    public string Detail { get; init; } = string.Empty;

    public string OccurredAtLocalText => OccurredAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");

    public string EventTypeDisplay => EventType switch
    {
        "MonitorStarted" or "监测启动" => "监测启动",
        "MonitorStopped" or "监测停止" => "监测停止",
        "SystemSuspend" or "系统挂起" => "系统挂起",
        "SystemResume" or "系统恢复" => "系统恢复",
        "PowerStatusChange" or "电源状态变化" => "电源状态变化",
        "SessionLock" or "会话锁定" => "会话锁定",
        "SessionUnlock" or "会话解锁" => "会话解锁",
        "SessionLogon" or "会话登录" => "会话登录",
        "SessionLogoff" or "会话注销" => "会话注销",
        "ConsoleConnect" or "本地控制台连接" => "本地控制台连接",
        "ConsoleDisconnect" or "本地控制台断开" => "本地控制台断开",
        "RemoteConnect" or "远程连接" => "远程连接",
        "RemoteDisconnect" or "远程断开" => "远程断开",
        "SystemStart(EventLog)" or "系统启动（事件日志）" => "系统启动（事件日志）",
        "SystemShutdown(EventLog)" or "系统关机（事件日志）" => "系统关机（事件日志）",
        "UnexpectedShutdown(EventLog)" or "异常关机（事件日志）" => "异常关机（事件日志）",
        "PlannedShutdownOrRestart(EventLog)" or "计划关机或重启（事件日志）" => "计划关机或重启（事件日志）",
        "SystemLogReadError" or "系统日志读取失败" => "系统日志读取失败",
        _ => EventType
    };
}
