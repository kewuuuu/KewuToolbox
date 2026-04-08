using System.Diagnostics;
using System.Windows.Threading;
using WindowMonitorApp.Data;
using WindowMonitorApp.Models;

namespace WindowMonitorApp.Services;

public sealed class WindowTrackingService : IDisposable
{
    private readonly AppDatabase _database;
    private readonly DispatcherTimer _sampleTimer;
    private readonly int _excludedProcessId;

    private bool _isRunning;
    private string? _currentFocusWindowKey;
    private string? _currentFocusProcessName;
    private string? _currentFocusTitle;
    private DateTime _currentFocusStartedAtUtc;

    public WindowTrackingService(AppDatabase database)
    {
        _database = database;
        _excludedProcessId = Process.GetCurrentProcess().Id;
        _sampleTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(1)
        };
        _sampleTimer.Tick += OnSampleTick;
    }

    public void Start()
    {
        if (_isRunning)
        {
            return;
        }

        _isRunning = true;
        _sampleTimer.Start();
    }

    public void Stop()
    {
        if (!_isRunning)
        {
            return;
        }

        _sampleTimer.Stop();
        FlushFocusSession(DateTime.UtcNow);
        _isRunning = false;
    }

    public void Dispose()
    {
        Stop();
        _sampleTimer.Tick -= OnSampleTick;
    }

    private void OnSampleTick(object? sender, EventArgs e)
    {
        var nowUtc = DateTime.UtcNow;
        var visibleWindows = WindowNativeMethods.GetVisibleTopLevelWindows(_excludedProcessId);
        var focusedWindow = WindowNativeMethods.GetForegroundWindowInfo(_excludedProcessId);
        _database.UpsertWindowSamples(visibleWindows, focusedWindow, nowUtc);
        TrackFocusTransition(focusedWindow, nowUtc);
    }

    private void TrackFocusTransition(TrackedWindow? focusedWindow, DateTime nowUtc)
    {
        var nextWindowKey = focusedWindow?.WindowKey;
        if (string.Equals(_currentFocusWindowKey, nextWindowKey, StringComparison.Ordinal))
        {
            return;
        }

        FlushFocusSession(nowUtc);

        if (focusedWindow is null)
        {
            return;
        }

        _currentFocusWindowKey = focusedWindow.WindowKey;
        _currentFocusProcessName = focusedWindow.ProcessName;
        _currentFocusTitle = focusedWindow.Title;
        _currentFocusStartedAtUtc = nowUtc;
    }

    private void FlushFocusSession(DateTime endedAtUtc)
    {
        if (_currentFocusWindowKey is null || _currentFocusProcessName is null || _currentFocusTitle is null)
        {
            return;
        }

        var durationSeconds = (long)Math.Floor((endedAtUtc - _currentFocusStartedAtUtc).TotalSeconds);
        if (durationSeconds > 0)
        {
            _database.AddFocusSession(
                _currentFocusWindowKey,
                _currentFocusProcessName,
                _currentFocusTitle,
                _currentFocusStartedAtUtc,
                endedAtUtc,
                durationSeconds);
        }

        _currentFocusWindowKey = null;
        _currentFocusProcessName = null;
        _currentFocusTitle = null;
    }
}
