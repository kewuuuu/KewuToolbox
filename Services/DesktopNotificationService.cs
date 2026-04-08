using System.Drawing;
using System.Media;
using System.Windows.Forms;

namespace WindowMonitorApp.Services;

public sealed class DesktopNotificationService : IDisposable
{
    private readonly NotifyIcon _notifyIcon;

    public DesktopNotificationService()
    {
        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Information,
            Visible = true,
            Text = "专注助手"
        };
    }

    public void Notify(string title, string message)
    {
        _notifyIcon.BalloonTipTitle = title;
        _notifyIcon.BalloonTipText = message;
        _notifyIcon.ShowBalloonTip(5000);
        SystemSounds.Exclamation.Play();
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
