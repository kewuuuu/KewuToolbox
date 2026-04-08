using System.Globalization;
using WindowMonitorApp.Models;

namespace WindowMonitorApp.ViewModels;

public sealed partial class MainViewModel
{
    private static bool TryParseReminder(
        string yearText,
        string monthText,
        string dayText,
        string hourText,
        string minuteText,
        string secondText,
        out int? year,
        out int? month,
        out int? day,
        out int hour,
        out int minute,
        out int second)
    {
        year = null;
        month = null;
        day = null;
        hour = 0;
        minute = 0;
        second = 0;

        if (!TryParseNullableRangedInt(yearText, 1, 9999, out year))
        {
            return false;
        }

        if (!TryParseNullableRangedInt(monthText, 1, 12, out month))
        {
            return false;
        }

        if (!TryParseNullableRangedInt(dayText, 1, 31, out day))
        {
            return false;
        }

        if (!TryParseRequiredRangedInt(hourText, 0, 23, out hour))
        {
            return false;
        }

        if (!TryParseRequiredRangedInt(minuteText, 0, 59, out minute))
        {
            return false;
        }

        if (!TryParseRequiredRangedInt(secondText, 0, 59, out second))
        {
            return false;
        }

        return true;
    }

    private static bool TryParseNullableRangedInt(string text, int min, int max, out int? value)
    {
        value = null;
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return false;
        }

        if (parsed < min || parsed > max)
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static bool TryParseRequiredRangedInt(string text, int min, int max, out int value)
    {
        value = 0;
        if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return false;
        }

        if (parsed < min || parsed > max)
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static void ClearDaySelection(IEnumerable<DaySelectionItem> source)
    {
        foreach (var item in source)
        {
            item.IsSelected = false;
        }
    }

    private static string BuildDayCsv(IEnumerable<DaySelectionItem> source)
    {
        return string.Join(
            ",",
            source
                .Where(item => item.IsSelected)
                .Select(item => item.Day)
                .OrderBy(day => day));
    }

    private static void ApplyDayCsv(string csv, IEnumerable<DaySelectionItem> source)
    {
        var selected = csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(token => int.TryParse(token, out var day) ? day : -1)
            .Where(day => day > 0)
            .ToHashSet();

        foreach (var item in source)
        {
            item.IsSelected = selected.Contains(item.Day);
        }
    }
}
