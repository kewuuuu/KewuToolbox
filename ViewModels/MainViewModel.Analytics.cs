using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using OxyPlot;
using OxyPlot.Axes;
using OxyPlot.Series;
using WindowMonitorApp.Models;

namespace WindowMonitorApp.ViewModels;

public sealed partial class MainViewModel
{
    private static readonly string[] DefaultWindowMetricOptions =
    [
        "桌面：桌面",
        "无数据"
    ];

    private static readonly Dictionary<string, OxyColor> CategoryColorMap = new(StringComparer.OrdinalIgnoreCase)
    {
        [WindowCategory.Study] = OxyColor.Parse("#2563EB"),
        [WindowCategory.Entertainment] = OxyColor.Parse("#EA580C"),
        [WindowCategory.Social] = OxyColor.Parse("#DB2777"),
        [WindowCategory.Rest] = OxyColor.Parse("#16A34A"),
        [WindowCategory.Other] = OxyColor.Parse("#64748B")
    };

    private void ToggleAnalyticsMode()
    {
        UseCategorySummary = !UseCategorySummary;
    }

    private void ShiftAnalyticsDate(int deltaDays)
    {
        AnalyticsDateLocal = AnalyticsDateLocal.AddDays(deltaDays);
    }

    private void ApplyTimelineRange()
    {
        RefreshAnalyticsData();
    }

    private void LoadProcessCategories()
    {
        foreach (var item in ProcessCategoryItems)
        {
            item.PropertyChanged -= OnProcessCategoryItemChanged;
        }

        var knownProcesses = _database.GetKnownProcesses()
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var categoryMap = _database.GetProcessCategoryMap();
        var items = new List<ProcessCategoryItem>();
        foreach (var processName in knownProcesses)
        {
            var category = categoryMap.TryGetValue(processName, out var mapped)
                ? WindowCategory.Normalize(mapped)
                : WindowCategory.Other;
            if (processName.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase))
            {
                category = WindowCategory.Rest;
            }

            if (!categoryMap.ContainsKey(processName))
            {
                _database.UpsertProcessCategory(processName, category);
            }

            var item = new ProcessCategoryItem
            {
                ProcessName = processName,
                Category = category
            };
            item.PropertyChanged += OnProcessCategoryItemChanged;
            items.Add(item);
        }

        ReplaceCollection(ProcessCategoryItems, items);
    }

    private void OnProcessCategoryItemChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ProcessCategoryItem.Category) || sender is not ProcessCategoryItem item)
        {
            return;
        }

        var normalized = WindowCategory.Normalize(item.Category);
        if (!string.Equals(normalized, item.Category, StringComparison.Ordinal))
        {
            item.Category = normalized;
        }

        _database.UpsertProcessCategory(item.ProcessName, item.Category);
        RefreshAnalyticsData();
    }

    private void UpdateHeatmapMetricOptions()
    {
        List<string> options;
        if (UseCategorySummary)
        {
            options = WindowCategory.All.ToList();
        }
        else
        {
            var endUtc = DateTime.UtcNow;
            var startUtc = endUtc.AddDays(-90);
            options = _database.GetFocusSessionsInRange(startUtc, endUtc)
                .Select(BuildWindowLabel)
                .Where(label => !string.IsNullOrWhiteSpace(label))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(40)
                .ToList();

            if (options.Count == 0)
            {
                options = DefaultWindowMetricOptions.ToList();
            }
        }

        var previous = SelectedHeatmapMetric;
        ReplaceCollection(HeatmapMetricOptions, options);
        if (options.Contains(previous, StringComparer.OrdinalIgnoreCase))
        {
            _selectedHeatmapMetric = previous;
            OnPropertyChanged(nameof(SelectedHeatmapMetric));
        }
        else
        {
            SelectedHeatmapMetric = options.First();
        }
    }

    private void RefreshAnalyticsData()
    {
        if (ProcessCategoryItems.Count == 0)
        {
            LoadProcessCategories();
        }

        if (HeatmapMetricOptions.Count == 0 ||
            (UseCategorySummary && !WindowCategory.All.Contains(SelectedHeatmapMetric, StringComparer.OrdinalIgnoreCase)) ||
            (!UseCategorySummary && !HeatmapMetricOptions.Contains(SelectedHeatmapMetric, StringComparer.OrdinalIgnoreCase)))
        {
            UpdateHeatmapMetricOptions();
        }

        BuildPieChart();
        BuildBarChart();
        BuildTimelineEntries();
        BuildHeatmapChart();
    }

    private void BuildPieChart()
    {
        var dayStartLocal = AnalyticsDateLocal.Date;
        var dayEndLocal = dayStartLocal.AddDays(1);
        var sessions = _database.GetFocusSessionsInRange(dayStartLocal.ToUniversalTime(), dayEndLocal.ToUniversalTime());
        var grouped = AggregateSessions(sessions, dayStartLocal.ToUniversalTime(), dayEndLocal.ToUniversalTime(), UseCategorySummary);

        var model = new PlotModel { Title = $"专注分布（{dayStartLocal:yyyy-MM-dd}）" };
        var pieSeries = new PieSeries
        {
            StrokeThickness = 1,
            InsideLabelPosition = 0.75,
            AngleSpan = 360,
            StartAngle = 0
        };

        if (grouped.Count == 0)
        {
            pieSeries.Slices.Add(new PieSlice("无数据", 1) { Fill = OxyColors.LightGray });
        }
        else
        {
            var palette = OxyPalettes.HueDistinct(grouped.Count + 2).Colors;
            for (var i = 0; i < grouped.Count; i++)
            {
                var (label, seconds) = grouped[i];
                var fill = UseCategorySummary
                    ? GetCategoryColor(label)
                    : palette[i % palette.Count];
                pieSeries.Slices.Add(new PieSlice(label, seconds) { Fill = fill });
            }
        }

        model.Series.Add(pieSeries);
        PieChartModel = model;
    }

    private void BuildBarChart()
    {
        var dayStartLocal = AnalyticsDateLocal.Date;
        var dayEndLocal = dayStartLocal.AddDays(1);
        var sessions = _database.GetFocusSessionsInRange(dayStartLocal.ToUniversalTime(), dayEndLocal.ToUniversalTime());
        var grouped = AggregateSessions(sessions, dayStartLocal.ToUniversalTime(), dayEndLocal.ToUniversalTime(), UseCategorySummary);

        var model = new PlotModel { Title = "专注时长排行" };
        var categoryAxis = new CategoryAxis
        {
            Position = AxisPosition.Left,
            GapWidth = 0.2
        };
        var valueAxis = new LinearAxis
        {
            Position = AxisPosition.Bottom,
            Title = "分钟",
            MinimumPadding = 0
        };
        var series = new BarSeries
        {
            LabelPlacement = LabelPlacement.Outside,
            LabelFormatString = "{0:0}"
        };

        foreach (var item in grouped)
        {
            categoryAxis.Labels.Add(item.Label);
            series.Items.Add(new BarItem(item.Seconds / 60d));
        }

        model.Axes.Add(categoryAxis);
        model.Axes.Add(valueAxis);
        model.Series.Add(series);
        BarChartModel = model;
    }

    private void BuildTimelineEntries()
    {
        if (!TryParseTimelineRange(out var startLocal, out var endLocal))
        {
            startLocal = DateTime.Now.AddHours(-12);
            endLocal = DateTime.Now;
            TimelineStartText = startLocal.ToString("yyyy-MM-dd HH:mm");
            TimelineEndText = endLocal.ToString("yyyy-MM-dd HH:mm");
        }

        var startUtc = startLocal.ToUniversalTime();
        var endUtc = endLocal.ToUniversalTime();
        var sessions = _database.GetFocusSessionsInRange(startUtc, endUtc);
        var powerEvents = _database.GetPowerEventsInRange(startUtc, endUtc);

        var rows = new List<TimelineEntry>();
        foreach (var session in sessions)
        {
            var clippedStartUtc = session.StartedAtUtc < startUtc ? startUtc : session.StartedAtUtc;
            var clippedEndUtc = session.EndedAtUtc > endUtc ? endUtc : session.EndedAtUtc;
            if (clippedEndUtc <= clippedStartUtc)
            {
                continue;
            }

            var label = UseCategorySummary
                ? ResolveCategoryByProcess(session.ProcessName)
                : BuildWindowLabel(session);
            rows.Add(new TimelineEntry
            {
                TimeLocal = clippedStartUtc.ToLocalTime(),
                EndTimeLocalText = clippedEndUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"),
                Label = label,
                IsPowerEvent = false,
                Marker = "\u25CF",
                MarkerColorHex = UseCategorySummary ? GetCategoryColorHex(label) : "#475569"
            });
        }

        foreach (var evt in powerEvents)
        {
            var isPowerUp = IsPowerUpEvent(evt.EventType);
            rows.Add(new TimelineEntry
            {
                TimeLocal = evt.OccurredAtUtc.ToLocalTime(),
                EndTimeLocalText = "无",
                Label = evt.EventTypeDisplay,
                IsPowerEvent = true,
                Marker = "\u25CF",
                MarkerColorHex = isPowerUp ? "#16A34A" : "#DC2626"
            });
        }

        ReplaceCollection(TimelineEntries, rows.OrderBy(row => row.TimeLocal));
    }

    private void BuildHeatmapChart()
    {
        var endDate = AnalyticsDateLocal.Date;
        var startDate = endDate.AddDays(-180);
        var startUtc = startDate.ToUniversalTime();
        var endUtc = endDate.AddDays(1).ToUniversalTime();
        var sessions = _database.GetFocusSessionsInRange(startUtc, endUtc);

        var normalizedStart = AlignToMonday(startDate);
        var normalizedEnd = endDate;
        var weeks = ((normalizedEnd - normalizedStart).Days / 7) + 1;
        var values = new double[weeks, 7];

        var dailyTotals = BuildDailyMetricTotals(sessions, normalizedStart, normalizedEnd);
        var maxValue = 0d;
        foreach (var pair in dailyTotals)
        {
            var x = (pair.Key.Date - normalizedStart.Date).Days / 7;
            var y = ToMondayIndex(pair.Key.DayOfWeek);
            if (x < 0 || x >= weeks || y < 0 || y > 6)
            {
                continue;
            }

            var minutes = pair.Value / 60d;
            values[x, y] = minutes;
            if (minutes > maxValue)
            {
                maxValue = minutes;
            }
        }

        var model = new PlotModel { Title = $"热力图（{SelectedHeatmapMetric}）" };
        model.Axes.Add(new LinearColorAxis
        {
            Position = AxisPosition.Right,
            Minimum = 0,
            Maximum = Math.Max(maxValue, 1),
            Palette = OxyPalettes.BlueWhiteRed(100)
        });
        model.Axes.Add(new CategoryAxis
        {
            Position = AxisPosition.Left,
            Labels = { "周一", "周二", "周三", "周四", "周五", "周六", "周日" }
        });
        model.Axes.Add(new LinearAxis
        {
            Position = AxisPosition.Bottom,
            Minimum = 0,
            Maximum = Math.Max(weeks, 1),
            IsAxisVisible = false
        });
        model.Series.Add(new HeatMapSeries
        {
            X0 = 0,
            X1 = Math.Max(weeks, 1),
            Y0 = 0,
            Y1 = 7,
            Interpolate = false,
            RenderMethod = HeatMapRenderMethod.Rectangles,
            Data = values
        });

        HeatmapChartModel = model;
    }

    private Dictionary<DateTime, long> BuildDailyMetricTotals(
        IReadOnlyList<FocusSessionRecord> sessions,
        DateTime startDateLocal,
        DateTime endDateLocal)
    {
        var totals = new Dictionary<DateTime, long>();
        var startUtc = startDateLocal.ToUniversalTime();
        var endUtc = endDateLocal.AddDays(1).ToUniversalTime();
        foreach (var session in sessions)
        {
            var label = UseCategorySummary ? ResolveCategoryByProcess(session.ProcessName) : BuildWindowLabel(session);
            if (!string.Equals(label, SelectedHeatmapMetric, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var clippedStartUtc = session.StartedAtUtc < startUtc ? startUtc : session.StartedAtUtc;
            var clippedEndUtc = session.EndedAtUtc > endUtc ? endUtc : session.EndedAtUtc;
            if (clippedEndUtc <= clippedStartUtc)
            {
                continue;
            }

            var dayCursor = clippedStartUtc.ToLocalTime().Date;
            var endLocal = clippedEndUtc.ToLocalTime();
            while (dayCursor <= endLocal.Date)
            {
                var segmentStart = dayCursor == clippedStartUtc.ToLocalTime().Date ? clippedStartUtc.ToLocalTime() : dayCursor;
                var segmentEnd = dayCursor == endLocal.Date ? endLocal : dayCursor.AddDays(1);
                var seconds = (long)Math.Max(0, (segmentEnd - segmentStart).TotalSeconds);
                if (seconds > 0)
                {
                    totals[dayCursor] = totals.TryGetValue(dayCursor, out var current) ? current + seconds : seconds;
                }

                dayCursor = dayCursor.AddDays(1);
            }
        }

        return totals;
    }

    private List<(string Label, long Seconds)> AggregateSessions(
        IReadOnlyList<FocusSessionRecord> sessions,
        DateTime rangeStartUtc,
        DateTime rangeEndUtc,
        bool groupByCategory)
    {
        var grouped = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        foreach (var session in sessions)
        {
            var clippedStart = session.StartedAtUtc < rangeStartUtc ? rangeStartUtc : session.StartedAtUtc;
            var clippedEnd = session.EndedAtUtc > rangeEndUtc ? rangeEndUtc : session.EndedAtUtc;
            if (clippedEnd <= clippedStart)
            {
                continue;
            }

            var seconds = (long)Math.Max(0, (clippedEnd - clippedStart).TotalSeconds);
            if (seconds <= 0)
            {
                continue;
            }

            var key = groupByCategory ? ResolveCategoryByProcess(session.ProcessName) : BuildWindowLabel(session);
            grouped[key] = grouped.TryGetValue(key, out var current) ? current + seconds : seconds;
        }

        return grouped
            .OrderByDescending(pair => pair.Value)
            .Take(30)
            .Select(pair => (pair.Key, pair.Value))
            .ToList();
    }

    private bool TryParseTimelineRange(out DateTime startLocal, out DateTime endLocal)
    {
        if (!DateTime.TryParseExact(
                TimelineStartText.Trim(),
                "yyyy-MM-dd HH:mm",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out startLocal))
        {
            endLocal = default;
            return false;
        }

        if (!DateTime.TryParseExact(
                TimelineEndText.Trim(),
                "yyyy-MM-dd HH:mm",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out endLocal))
        {
            return false;
        }

        if (endLocal <= startLocal)
        {
            return false;
        }

        return true;
    }

    private string ResolveCategoryByProcess(string processName)
    {
        var match = ProcessCategoryItems.FirstOrDefault(item =>
            item.ProcessName.Equals(processName, StringComparison.OrdinalIgnoreCase));
        if (match is null)
        {
            if (processName.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase))
            {
                return WindowCategory.Rest;
            }

            return WindowCategory.Other;
        }

        return match.Category;
    }

    private static string BuildWindowLabel(FocusSessionRecord session)
    {
        var processName = session.ProcessName.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase)
            ? WindowCategory.DesktopDisplayName
            : session.ProcessName;
        var title = session.Title.Equals("Desktop", StringComparison.OrdinalIgnoreCase)
            ? WindowCategory.DesktopDisplayName
            : session.Title;
        return $"{processName}：{title}";
    }

    private static DateTime AlignToMonday(DateTime date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-diff).Date;
    }

    private static int ToMondayIndex(DayOfWeek dayOfWeek)
    {
        return ((int)dayOfWeek + 6) % 7;
    }

    private static bool IsPowerUpEvent(string eventType)
    {
        var text = eventType.ToLowerInvariant();
        return text.Contains("start") ||
               text.Contains("logon") ||
               text.Contains("resume") ||
               text.Contains("unlock") ||
               eventType.Contains("启动", StringComparison.Ordinal) ||
               eventType.Contains("登录", StringComparison.Ordinal) ||
               eventType.Contains("恢复", StringComparison.Ordinal) ||
               eventType.Contains("解锁", StringComparison.Ordinal);
    }

    private static OxyColor GetCategoryColor(string category)
    {
        return CategoryColorMap.TryGetValue(category, out var color)
            ? color
            : CategoryColorMap[WindowCategory.Other];
    }

    private static string GetCategoryColorHex(string category)
    {
        var color = GetCategoryColor(category);
        return $"#{color.R:X2}{color.G:X2}{color.B:X2}";
    }
}
