using System.Diagnostics.Eventing.Reader;
using Microsoft.Win32;
using WindowMonitorApp.Data;

namespace WindowMonitorApp.Services;

public sealed class PowerEventMonitor : IDisposable
{
    private readonly AppDatabase _database;
    private bool _isStarted;

    public PowerEventMonitor(AppDatabase database)
    {
        _database = database;
    }

    public void Start()
    {
        if (_isStarted)
        {
            return;
        }

        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.SessionEnding += OnSessionEnding;
        _isStarted = true;

        ImportRecentSystemPowerEvents();
        _database.AddPowerEvent("监测启动", DateTime.UtcNow, "开始监听电源与会话事件");
    }

    public void Stop()
    {
        if (!_isStarted)
        {
            return;
        }

        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.SessionEnding -= OnSessionEnding;
        _database.AddPowerEvent("监测停止", DateTime.UtcNow, "已停止监听电源与会话事件");
        _isStarted = false;
    }

    public void Dispose()
    {
        Stop();
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        var eventType = e.Mode switch
        {
            PowerModes.Suspend => "系统挂起",
            PowerModes.Resume => "系统恢复",
            PowerModes.StatusChange => "电源状态变化",
            _ => $"电源模式（{e.Mode}）"
        };

        _database.AddPowerEvent(eventType, DateTime.UtcNow);
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        var eventType = e.Reason switch
        {
            SessionSwitchReason.SessionLock => "会话锁定",
            SessionSwitchReason.SessionUnlock => "会话解锁",
            SessionSwitchReason.SessionLogon => "会话登录",
            SessionSwitchReason.SessionLogoff => "会话注销",
            SessionSwitchReason.ConsoleConnect => "本地控制台连接",
            SessionSwitchReason.ConsoleDisconnect => "本地控制台断开",
            SessionSwitchReason.RemoteConnect => "远程连接",
            SessionSwitchReason.RemoteDisconnect => "远程断开",
            _ => $"会话事件（{e.Reason}）"
        };

        _database.AddPowerEvent(eventType, DateTime.UtcNow);
    }

    private void OnSessionEnding(object sender, SessionEndingEventArgs e)
    {
        _database.AddPowerEvent($"会话结束（{e.Reason}）", DateTime.UtcNow, "系统即将关机或注销");
    }

    private void ImportRecentSystemPowerEvents()
    {
        try
        {
            var query = new EventLogQuery(
                "System",
                PathType.LogName,
                "*[System[(EventID=6005 or EventID=6006 or EventID=6008 or EventID=1074)]]")
            {
                ReverseDirection = true
            };

            using var reader = new EventLogReader(query);
            for (var i = 0; i < 80; i++)
            {
                using var record = reader.ReadEvent();
                if (record is null)
                {
                    break;
                }

                var eventType = MapSystemLogEvent(record.Id);
                if (eventType is null || record.TimeCreated is null)
                {
                    continue;
                }

                var detail = GetDescription(record);
                _database.AddPowerEvent(eventType, record.TimeCreated.Value.ToUniversalTime(), detail);
            }
        }
        catch (Exception ex)
        {
            _database.AddPowerEvent("系统日志读取失败", DateTime.UtcNow, ex.Message);
        }
    }

    private static string? MapSystemLogEvent(int eventId)
    {
        return eventId switch
        {
            6005 => "系统启动（事件日志）",
            6006 => "系统关机（事件日志）",
            6008 => "异常关机（事件日志）",
            1074 => "计划关机或重启（事件日志）",
            _ => null
        };
    }

    private static string GetDescription(EventRecord record)
    {
        try
        {
            var description = record.FormatDescription() ?? string.Empty;
            return description.Length <= 400 ? description : description[..400];
        }
        catch
        {
            return string.Empty;
        }
    }
}
