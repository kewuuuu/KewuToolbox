using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using WindowMonitorApp.Models;

namespace WindowMonitorApp.Services;

public static class WindowNativeMethods
{
    private static readonly HashSet<string> BrowserProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome",
        "msedge",
        "firefox",
        "brave",
        "opera",
        "iexplore"
    };

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public static IReadOnlyList<TrackedWindow> GetVisibleTopLevelWindows(int excludedProcessId)
    {
        var windows = new Dictionary<string, TrackedWindow>(StringComparer.Ordinal);

        EnumWindows(
            (hWnd, _) =>
            {
                var window = TryBuildTrackedWindow(hWnd, excludedProcessId, includeBrowserTabDetails: false);
                if (window is null)
                {
                    return true;
                }

                windows.TryAdd(window.WindowKey, window);
                return true;
            },
            IntPtr.Zero);

        return windows.Values.ToList();
    }

    public static TrackedWindow? GetForegroundWindowInfo(int excludedProcessId)
    {
        var hWnd = GetForegroundWindow();
        if (hWnd == IntPtr.Zero)
        {
            return BuildDesktopTrackedWindow();
        }

        if (IsDesktopWindow(hWnd))
        {
            return BuildDesktopTrackedWindow();
        }

        return TryBuildTrackedWindow(hWnd, excludedProcessId, includeBrowserTabDetails: true);
    }

    private static TrackedWindow? TryBuildTrackedWindow(IntPtr hWnd, int excludedProcessId, bool includeBrowserTabDetails)
    {
        if (!IsWindowVisible(hWnd))
        {
            return null;
        }

        _ = GetWindowThreadProcessId(hWnd, out var processIdRaw);
        if (processIdRaw == 0)
        {
            return null;
        }

        var processId = (int)processIdRaw;
        if (processId == excludedProcessId)
        {
            return null;
        }

        string processName;
        try
        {
            processName = Process.GetProcessById(processId).ProcessName;
        }
        catch
        {
            return null;
        }

        var title = GetWindowTitle(hWnd);
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        if (title.Equals("Program Manager", StringComparison.OrdinalIgnoreCase))
        {
            return BuildDesktopTrackedWindow();
        }

        if (includeBrowserTabDetails && BrowserProcesses.Contains(processName))
        {
            var tabTitle = TryGetBrowserTabTitle(hWnd);
            if (!string.IsNullOrWhiteSpace(tabTitle))
            {
                title = tabTitle.Trim();
            }
        }

        var windowKey = $"{processName}|{title}";
        return new TrackedWindow
        {
            WindowKey = windowKey,
            ProcessName = processName,
            Title = title
        };
    }

    private static string GetWindowTitle(IntPtr hWnd)
    {
        var titleLength = GetWindowTextLength(hWnd);
        if (titleLength <= 0)
        {
            return string.Empty;
        }

        var titleBuilder = new StringBuilder(titleLength + 1);
        _ = GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
        return titleBuilder.ToString().Trim();
    }

    private static bool IsDesktopWindow(IntPtr hWnd)
    {
        var classNameBuilder = new StringBuilder(128);
        _ = GetClassName(hWnd, classNameBuilder, classNameBuilder.Capacity);
        var className = classNameBuilder.ToString();
        if (className.Equals("Progman", StringComparison.OrdinalIgnoreCase) ||
            className.Equals("WorkerW", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var title = GetWindowTitle(hWnd);
        return title.Equals("Program Manager", StringComparison.OrdinalIgnoreCase);
    }

    private static TrackedWindow BuildDesktopTrackedWindow()
    {
        return new TrackedWindow
        {
            WindowKey = $"{WindowCategory.DesktopProcess}|Desktop",
            ProcessName = WindowCategory.DesktopProcess,
            Title = "Desktop"
        };
    }

    private static string? TryGetBrowserTabTitle(IntPtr hWnd)
    {
        try
        {
            var root = AutomationElement.FromHandle(hWnd);
            if (root is null)
            {
                return null;
            }

            var tabItems = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));

            foreach (AutomationElement tab in tabItems)
            {
                if (!tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var patternObject))
                {
                    continue;
                }

                if (patternObject is not SelectionItemPattern selectionPattern || !selectionPattern.Current.IsSelected)
                {
                    continue;
                }

                var tabName = tab.Current.Name?.Trim();
                if (!string.IsNullOrWhiteSpace(tabName))
                {
                    return tabName;
                }
            }
        }
        catch
        {
            return null;
        }

        return null;
    }
}
