using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using WindowMonitorApp.Infrastructure;
using WindowMonitorApp.Models;
using WindowMonitorApp.Services;
using WindowMonitorApp.Utilities;
using WpfMessageBox = System.Windows.MessageBox;

namespace WindowMonitorApp.ViewModels;

public sealed partial class MainViewModel
{
    private void MovePage(int offset)
    {
        SelectedPageIndex += offset;
    }

    private void GoToPage(object? parameter)
    {
        if (parameter is null)
        {
            return;
        }

        if (!int.TryParse(parameter.ToString(), out var pageIndex))
        {
            return;
        }

        SelectedPageIndex = pageIndex;
    }

    private void TogglePomodoro()
    {
        ApplyTimerSettings();

        if (_isPomodoroRunning)
        {
            _isPomodoroRunning = false;
            _pomodoroTimer.Stop();
            DistractionStatusText = _isBreakMode ? "休息已暂停" : "专注已暂停";
            RaisePomodoroDisplayChanged();
            RaisePlanCommandCanExecuteChanged();
            return;
        }

        if (_isBreakMode)
        {
            if (_remainingPomodoroTime <= TimeSpan.Zero)
            {
                _remainingPomodoroTime = TimeSpan.FromMinutes(_breakMinutesValue);
            }
        }
        else if (_focusCycleNeedsInitialize || _remainingPomodoroTime <= TimeSpan.Zero)
        {
            BeginFocusCycle();
        }

        _isPomodoroRunning = true;
        _pomodoroTimer.Start();
        RaisePomodoroDisplayChanged();
        RaisePlanCommandCanExecuteChanged();
    }

    private void ResetPomodoro()
    {
        ApplyTimerSettings();
        _isPomodoroRunning = false;
        _pomodoroTimer.Stop();

        if (_isBreakMode)
        {
            _remainingPomodoroTime = TimeSpan.FromMinutes(_breakMinutesValue);
            ResetDistractionCounters();
            DistractionStatusText = "休息准备就绪";
            _focusCycleNeedsInitialize = true;
        }
        else
        {
            ResetPlanExecution();
            _remainingPomodoroTime = TimeSpan.FromMinutes(GetPreviewFocusMinutes());
            ResetDistractionCounters();
            DistractionStatusText = "专注准备就绪";
        }

        RaisePomodoroDisplayChanged();
        RaisePlanCommandCanExecuteChanged();
    }

    private void SwitchPomodoroMode()
    {
        ApplyTimerSettings();
        _isBreakMode = !_isBreakMode;

        if (_isBreakMode)
        {
            _remainingPomodoroTime = TimeSpan.FromMinutes(_breakMinutesValue);
            ResetDistractionCounters();
            DistractionStatusText = "休息模式，已关闭提醒";
            _focusCycleNeedsInitialize = true;
        }
        else
        {
            BeginFocusCycle();
        }

        RaisePomodoroDisplayChanged();
    }

    private void OnPomodoroTick()
    {
        if (_remainingPomodoroTime > TimeSpan.Zero)
        {
            _remainingPomodoroTime -= TimeSpan.FromSeconds(1);
            if (_remainingPomodoroTime < TimeSpan.Zero)
            {
                _remainingPomodoroTime = TimeSpan.Zero;
            }
        }
        else if (_isBreakMode)
        {
            _isBreakMode = false;
            BeginFocusCycle();
        }
        else
        {
            var hasNextFocusStep = AdvancePlanAfterFocusCycle();
            if (!hasNextFocusStep)
            {
                CompleteFocusPlan();
                return;
            }

            _isBreakMode = true;
            _remainingPomodoroTime = TimeSpan.FromMinutes(_breakMinutesValue);
            ResetDistractionCounters();
            DistractionStatusText = "已切换到休息模式";
            _focusCycleNeedsInitialize = true;
        }

        RaisePomodoroDisplayChanged();
        UpdateForegroundWindow();
        if (_isPomodoroRunning && !_isBreakMode)
        {
            EvaluateDistractionRule();
        }
    }

    private void BeginFocusCycle()
    {
        EnsurePlanExecutionState();
        SelectedPageIndex = FocusPageIndex;
        ResetDistractionCounters();

        var focusMinutes = GetCurrentFocusMinutes();
        _remainingPomodoroTime = TimeSpan.FromMinutes(focusMinutes);
        _focusCycleNeedsInitialize = false;

        if (TryGetActivePlanStep(out var activeStep) && activeStep is not null)
        {
            DistractionStatusText = $"专注开始：{activeStep.Title}（{focusMinutes} 分钟）";
        }
        else
        {
            DistractionStatusText = "专注开始";
        }
    }

    private void ResetDistractionCounters()
    {
        _offTargetContinuous = TimeSpan.Zero;
        _offTargetCumulative = TimeSpan.Zero;
        _offTargetAlertSent = false;
    }

    private void EvaluateDistractionRule()
    {
        var allowedKeys = BuildAllowedWindowKeySet();
        if (allowedKeys.Count == 0)
        {
            DistractionStatusText = "未选择允许专注的窗口";
            return;
        }

        var currentWindow = WindowNativeMethods.GetForegroundWindowInfo(_excludedProcessId);
        var isAllowed = currentWindow is not null && allowedKeys.Contains(currentWindow.WindowKey);
        if (isAllowed)
        {
            _offTargetContinuous = TimeSpan.Zero;
            if (IsContinuousMode())
            {
                _offTargetAlertSent = false;
            }

            DistractionStatusText = "当前窗口在允许范围内";
            return;
        }

        _offTargetContinuous += TimeSpan.FromSeconds(1);
        _offTargetCumulative += TimeSpan.FromSeconds(1);

        var threshold = TimeSpan.FromMinutes(_alertThresholdMinutesValue);
        if (threshold <= TimeSpan.Zero)
        {
            threshold = TimeSpan.FromMinutes(1);
        }

        var tracked = IsContinuousMode() ? _offTargetContinuous : _offTargetCumulative;
        var modeText = IsContinuousMode() ? "连续" : "累计";
        DistractionStatusText =
            $"偏离{modeText}时长：{DurationFormatter.Format((long)tracked.TotalSeconds)} / {DurationFormatter.Format((long)threshold.TotalSeconds)}";

        if (tracked >= threshold && !_offTargetAlertSent)
        {
            _notificationService.Notify(
                "专注提醒",
                $"已在非指定窗口停留过久（{modeText}）。");
            _offTargetAlertSent = true;
        }
    }

    private bool IsContinuousMode()
    {
        return string.Equals(SelectedAlertMode, "连续", StringComparison.Ordinal);
    }

    private void ApplyTimerSettings()
    {
        _focusMinutesValue = ParseIntegerSetting(FocusMinutesInput, defaultValue: 25, min: 1, max: 240);
        _breakMinutesValue = ParseIntegerSetting(BreakMinutesInput, defaultValue: 5, min: 1, max: 120);
        _alertThresholdMinutesValue = ParseDoubleSetting(AlertThresholdMinutesInput, defaultValue: 1, min: 0.1, max: 240);
        _planCycleCountValue = ParseIntegerSetting(PlanCycleCountInput, defaultValue: 0, min: -100000, max: 100000);
    }

    private void RefreshAllData()
    {
        RefreshDataFromDatabase();
        RefreshOpenWindowsForSelection();
        UpdateForegroundWindow();
    }

    private void RefreshDataFromDatabase()
    {
        var selectedTaskId = SelectedActiveTask?.Id;
        var selectedArchiveTaskId = SelectedArchiveGroup?.TaskId;

        var stats = _database.GetWindowStats(600);
        ReplaceCollection(
            AllWindowStats,
            stats
                .OrderByDescending(item => item.TotalSeconds)
                .ThenByDescending(item => item.FocusSeconds));

        ReplaceCollection(
            FocusWindowStats,
            stats
                .Where(item => item.FocusSeconds > 0)
                .OrderByDescending(item => item.FocusSeconds)
                .ThenByDescending(item => item.TotalSeconds));

        ReplaceCollection(PowerEvents, _database.GetPowerEvents(200));
        RefreshFocusItems();
        RefreshFocusPlanTemplates();
        ReplaceCollection(ActiveTodoTasks, _database.GetActiveTodoTasks());
        ReplaceCollection(ArchivedTodoGroups, _database.GetArchivedTodoGroups());
        LoadProcessCategories();
        RefreshAnalyticsData();

        SelectedActiveTask = selectedTaskId is null
            ? ActiveTodoTasks.FirstOrDefault()
            : ActiveTodoTasks.FirstOrDefault(item => item.Id == selectedTaskId) ?? ActiveTodoTasks.FirstOrDefault();

        if (SelectedActiveTask is null)
        {
            SelectedArchiveGroup = selectedArchiveTaskId is null
                ? ArchivedTodoGroups.FirstOrDefault()
                : ArchivedTodoGroups.FirstOrDefault(item => item.TaskId == selectedArchiveTaskId) ?? ArchivedTodoGroups.FirstOrDefault();
        }
    }

    private void RefreshOpenWindowsForSelection()
    {
        var selectedKeys = FocusWindowOptions
            .Where(item => item.IsSelected)
            .Select(item => item.WindowKey)
            .ToHashSet(StringComparer.Ordinal);

        var focusItemDraftKeys = FocusItemWindowOptions
            .Where(item => item.IsSelected)
            .Select(item => item.WindowKey)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var option in FocusWindowOptions)
        {
            option.PropertyChanged -= OnFocusWindowOptionChanged;
        }

        foreach (var option in FocusItemWindowOptions)
        {
            option.PropertyChanged -= OnFocusItemWindowOptionChanged;
        }

        var windows = WindowNativeMethods.GetVisibleTopLevelWindows(_excludedProcessId)
            .OrderBy(item => item.ProcessName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Title, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var desktopWindowKey = $"{WindowCategory.DesktopProcess}|Desktop";
        if (windows.All(item => !item.WindowKey.Equals(desktopWindowKey, StringComparison.Ordinal)))
        {
            windows.Add(new TrackedWindow
            {
                WindowKey = desktopWindowKey,
                ProcessName = WindowCategory.DesktopProcess,
                Title = "Desktop"
            });
        }

        FocusWindowOptions.Clear();
        FocusItemWindowOptions.Clear();
        foreach (var window in windows)
        {
            var mainOption = new FocusWindowOption
            {
                WindowKey = window.WindowKey,
                ProcessName = window.ProcessName,
                Title = window.Title,
                IsSelected = selectedKeys.Contains(window.WindowKey)
            };
            mainOption.PropertyChanged += OnFocusWindowOptionChanged;
            FocusWindowOptions.Add(mainOption);

            var draftOption = new FocusWindowOption
            {
                WindowKey = window.WindowKey,
                ProcessName = window.ProcessName,
                Title = window.Title,
                IsSelected = focusItemDraftKeys.Contains(window.WindowKey)
            };
            draftOption.PropertyChanged += OnFocusItemWindowOptionChanged;
            FocusItemWindowOptions.Add(draftOption);
        }

        OnPropertyChanged(nameof(AllowedWindowCount));
        OnPropertyChanged(nameof(FocusItemWindowCount));
        RaisePlanCommandCanExecuteChanged();
    }

    private void SelectAllFocusWindows()
    {
        foreach (var option in FocusWindowOptions)
        {
            option.IsSelected = true;
        }
    }

    private void ClearFocusWindowSelection()
    {
        foreach (var option in FocusWindowOptions)
        {
            option.IsSelected = false;
        }
    }

    private void SelectAllFocusItemWindows()
    {
        foreach (var option in FocusItemWindowOptions)
        {
            option.IsSelected = true;
        }
    }

    private void ClearFocusItemWindowSelection()
    {
        foreach (var option in FocusItemWindowOptions)
        {
            option.IsSelected = false;
        }
    }

    private void OnFocusWindowOptionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(FocusWindowOption.IsSelected))
        {
            OnPropertyChanged(nameof(AllowedWindowCount));
            RaisePlanCommandCanExecuteChanged();
        }
    }

    private void OnFocusItemWindowOptionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(FocusWindowOption.IsSelected))
        {
            OnPropertyChanged(nameof(FocusItemWindowCount));
            RaisePlanCommandCanExecuteChanged();
        }
    }

    private bool CanCreateFocusItem()
    {
        if (_isPomodoroRunning)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(FocusItemDraftTitle))
        {
            return false;
        }

        return FocusItemWindowOptions.Any(item => item.IsSelected);
    }

    private bool CanAddFocusItemToPlan(object? parameter)
    {
        if (_isPomodoroRunning || parameter is not FocusItem item)
        {
            return false;
        }

        return FocusPlanSteps.All(step => step.FocusItemId != item.Id);
    }

    private bool CanRemovePlanStep(object? parameter)
    {
        return !_isPomodoroRunning &&
               parameter is FocusPlanStep step &&
               FocusPlanSteps.Contains(step);
    }

    private bool CanMovePlanStep(object? parameter, int offset)
    {
        if (_isPomodoroRunning || parameter is not FocusPlanStep step)
        {
            return false;
        }

        var index = FocusPlanSteps.IndexOf(step);
        if (index < 0)
        {
            return false;
        }

        var target = index + offset;
        return target >= 0 && target < FocusPlanSteps.Count;
    }

    private void CreateFocusItem()
    {
        if (string.IsNullOrWhiteSpace(FocusItemDraftTitle))
        {
            WpfMessageBox.Show("请输入专注事项标题。", "专注事项", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        var windowKeys = FocusItemWindowOptions
            .Where(item => item.IsSelected)
            .Select(item => item.WindowKey)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (windowKeys.Count == 0)
        {
            WpfMessageBox.Show("请至少选择一个窗口。", "专注事项", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        var defaultMinutes = ParseIntegerSetting(FocusItemDraftMinutesInput, defaultValue: 25, min: 1, max: 240);
        if (IsEditingFocusItem)
        {
            _database.UpdateFocusItem(_editingFocusItemId, FocusItemDraftTitle.Trim(), defaultMinutes, windowKeys);
        }
        else
        {
            _database.CreateFocusItem(FocusItemDraftTitle.Trim(), defaultMinutes, windowKeys);
        }

        CancelEditFocusItem();
        RefreshFocusItems();
    }

    private void StartEditFocusItem(object? parameter)
    {
        if (parameter is not FocusItem item)
        {
            return;
        }

        _editingFocusItemId = item.Id;
        FocusItemDraftTitle = item.Title;
        FocusItemDraftMinutesInput = item.DefaultMinutes.ToString();
        SelectedFocusItem = item;

        var keySet = item.WindowKeys.ToHashSet(StringComparer.Ordinal);
        foreach (var option in FocusItemWindowOptions)
        {
            option.IsSelected = keySet.Contains(option.WindowKey);
        }

        OnPropertyChanged(nameof(IsEditingFocusItem));
        OnPropertyChanged(nameof(FocusItemEditorButtonText));
        OnPropertyChanged(nameof(FocusItemEditorTitleText));
        RaisePlanCommandCanExecuteChanged();
    }

    private void CancelEditFocusItem()
    {
        _editingFocusItemId = 0;
        FocusItemDraftTitle = string.Empty;
        FocusItemDraftMinutesInput = "25";
        ClearFocusItemWindowSelection();

        OnPropertyChanged(nameof(IsEditingFocusItem));
        OnPropertyChanged(nameof(FocusItemEditorButtonText));
        OnPropertyChanged(nameof(FocusItemEditorTitleText));
        RaisePlanCommandCanExecuteChanged();
    }

    private void DeleteFocusItem(object? parameter)
    {
        if (parameter is not FocusItem item)
        {
            return;
        }

        var confirm = WpfMessageBox.Show(
            $"确认删除专注事项“{item.Title}”？",
            "删除专注事项",
            System.Windows.MessageBoxButton.YesNo,
            System.Windows.MessageBoxImage.Warning);
        if (confirm != System.Windows.MessageBoxResult.Yes)
        {
            return;
        }

        _database.DeleteFocusItem(item.Id);
        RemovePlanStepsByFocusItemId(item.Id);
        RefreshFocusItems();
    }

    private void RefreshFocusItems()
    {
        var previousSelectedId = SelectedFocusItem?.Id;
        var items = _database.GetFocusItems().ToList();
        foreach (var item in items)
        {
            item.TotalFocusSeconds = _database.GetTotalFocusSecondsForWindows(item.WindowKeys);
        }

        ReplaceCollection(FocusItems, items);
        SelectedFocusItem = previousSelectedId is null
            ? FocusItems.FirstOrDefault()
            : FocusItems.FirstOrDefault(item => item.Id == previousSelectedId.Value) ?? FocusItems.FirstOrDefault();

        if (IsEditingFocusItem && FocusItems.All(item => item.Id != _editingFocusItemId))
        {
            CancelEditFocusItem();
        }

        RemovePlanStepsWithoutFocusItem();
        OnPropertyChanged(nameof(FocusPlanSummaryText));
        RaisePlanCommandCanExecuteChanged();
    }

    private void AddFocusItemToPlan(object? parameter)
    {
        if (parameter is not FocusItem item)
        {
            return;
        }

        if (FocusPlanSteps.Any(step => step.FocusItemId == item.Id))
        {
            return;
        }

        var step = new FocusPlanStep
        {
            FocusItemId = item.Id,
            Title = item.Title,
            WindowKeys = item.WindowKeys.ToList(),
            DurationMinutesInput = item.DefaultMinutes.ToString()
        };
        step.PropertyChanged += OnFocusPlanStepChanged;
        FocusPlanSteps.Add(step);
        ResetPlanExecution();
    }

    private void RemovePlanStep(object? parameter)
    {
        if (parameter is not FocusPlanStep step)
        {
            return;
        }

        step.PropertyChanged -= OnFocusPlanStepChanged;
        FocusPlanSteps.Remove(step);
        ResetPlanExecution();
    }

    private void MovePlanStepUp(object? parameter)
    {
        MovePlanStep(parameter, -1);
    }

    private void MovePlanStepDown(object? parameter)
    {
        MovePlanStep(parameter, 1);
    }

    private void MovePlanStep(object? parameter, int offset)
    {
        if (parameter is not FocusPlanStep step)
        {
            return;
        }

        var index = FocusPlanSteps.IndexOf(step);
        if (index < 0)
        {
            return;
        }

        var target = index + offset;
        if (target < 0 || target >= FocusPlanSteps.Count)
        {
            return;
        }

        FocusPlanSteps.Move(index, target);
        ResetPlanExecution();
    }

    private void ClearPlanSteps()
    {
        foreach (var step in FocusPlanSteps)
        {
            step.PropertyChanged -= OnFocusPlanStepChanged;
        }

        FocusPlanSteps.Clear();
        ResetPlanExecution();
    }

    private void SaveFocusPlanTemplate()
    {
        var name = PlanTemplateDraftName.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            WpfMessageBox.Show("请输入模板名称。", "专注计划模板", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        if (FocusPlanSteps.Count == 0)
        {
            WpfMessageBox.Show("当前队列为空，请至少添加一个步骤后再保存。", "专注计划模板", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            return;
        }

        ApplyTimerSettings();
        var records = FocusPlanSteps
            .Select((step, index) => new FocusPlanTemplateStepRecord
            {
                StepOrder = index + 1,
                FocusItemId = step.FocusItemId,
                DurationMinutes = step.DurationMinutes
            })
            .ToList();

        var templateId = _database.SaveFocusPlanTemplate(name, _planCycleCountValue, records);
        RefreshFocusPlanTemplates();
        SelectedPlanTemplate = FocusPlanTemplates.FirstOrDefault(item => item.Id == templateId);
    }

    private void LoadSelectedFocusPlanTemplate()
    {
        var template = SelectedPlanTemplate;
        if (template is null)
        {
            return;
        }

        var detail = _database.GetFocusPlanTemplateDetail(template.Id);
        if (detail is null)
        {
            RefreshFocusPlanTemplates();
            return;
        }

        var focusItemMap = FocusItems.ToDictionary(item => item.Id);
        var loaded = new List<FocusPlanStep>();
        var skippedCount = 0;
        foreach (var record in detail.Steps.OrderBy(step => step.StepOrder))
        {
            if (!focusItemMap.TryGetValue(record.FocusItemId, out var item))
            {
                skippedCount++;
                continue;
            }

            var step = new FocusPlanStep
            {
                FocusItemId = item.Id,
                Title = item.Title,
                WindowKeys = item.WindowKeys.ToList(),
                DurationMinutesInput = record.DurationMinutes.ToString()
            };
            step.PropertyChanged += OnFocusPlanStepChanged;
            loaded.Add(step);
        }

        foreach (var step in FocusPlanSteps)
        {
            step.PropertyChanged -= OnFocusPlanStepChanged;
        }

        ReplaceCollection(FocusPlanSteps, loaded);
        PlanCycleCountInput = detail.CycleCount.ToString();
        PlanTemplateDraftName = detail.Name;
        ResetPlanExecution();

        if (skippedCount > 0)
        {
            DistractionStatusText = $"模板已加载，跳过 {skippedCount} 个不存在的专注事项";
        }
        else
        {
            DistractionStatusText = "模板已加载";
        }
    }

    private void DeleteSelectedFocusPlanTemplate()
    {
        var template = SelectedPlanTemplate;
        if (template is null)
        {
            return;
        }

        var confirm = WpfMessageBox.Show(
            $"确认删除计划模板“{template.Name}”？",
            "删除计划模板",
            System.Windows.MessageBoxButton.YesNo,
            System.Windows.MessageBoxImage.Warning);
        if (confirm != System.Windows.MessageBoxResult.Yes)
        {
            return;
        }

        _database.DeleteFocusPlanTemplate(template.Id);
        RefreshFocusPlanTemplates();
    }

    private void RefreshFocusPlanTemplates()
    {
        var previousSelectedId = SelectedPlanTemplate?.Id;
        var templates = _database.GetFocusPlanTemplates();
        ReplaceCollection(FocusPlanTemplates, templates);
        SelectedPlanTemplate = previousSelectedId is null
            ? FocusPlanTemplates.FirstOrDefault()
            : FocusPlanTemplates.FirstOrDefault(item => item.Id == previousSelectedId.Value) ?? FocusPlanTemplates.FirstOrDefault();
        RaisePlanCommandCanExecuteChanged();
    }

    private void OnFocusPlanStepChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(FocusPlanStep.DurationMinutesInput))
        {
            return;
        }

        if (!_isPomodoroRunning && !_isBreakMode)
        {
            _remainingPomodoroTime = TimeSpan.FromMinutes(GetPreviewFocusMinutes());
        }

        OnPropertyChanged(nameof(FocusPlanSummaryText));
        RaisePomodoroDisplayChanged();
        RaisePlanCommandCanExecuteChanged();
    }

    private void UpdateForegroundWindow()
    {
        var foregroundWindow = WindowNativeMethods.GetForegroundWindowInfo(_excludedProcessId);
        CurrentForegroundWindowText = foregroundWindow is null
            ? "暂无前台窗口"
            : BuildWindowDisplayText(foregroundWindow.ProcessName, foregroundWindow.Title);
    }

    private void RaisePomodoroDisplayChanged()
    {
        OnPropertyChanged(nameof(PomodoroDisplay));
        OnPropertyChanged(nameof(PomodoroModeText));
        OnPropertyChanged(nameof(PomodoroButtonText));
        OnPropertyChanged(nameof(FocusPlanSummaryText));
    }

    private static int ParseIntegerSetting(string input, int defaultValue, int min, int max)
    {
        return int.TryParse(input, out var parsed)
            ? Math.Clamp(parsed, min, max)
            : defaultValue;
    }

    private static double ParseDoubleSetting(string input, double defaultValue, double min, double max)
    {
        return double.TryParse(input, out var parsed)
            ? Math.Clamp(parsed, min, max)
            : defaultValue;
    }

    private static void ReplaceCollection<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        target.Clear();
        foreach (var value in values)
        {
            target.Add(value);
        }
    }

    private void RaisePlanCommandCanExecuteChanged()
    {
        (CreateFocusItemCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (AddFocusItemToPlanCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (RemovePlanStepCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (MovePlanStepUpCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (MovePlanStepDownCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (ClearPlanStepsCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (StartEditFocusItemCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (CancelEditFocusItemCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (DeleteFocusItemCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (SaveFocusPlanTemplateCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (LoadFocusPlanTemplateCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (DeleteFocusPlanTemplateCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (AdjustFocusSettingCommand as RelayCommand)?.RaiseCanExecuteChanged();
    }

    private void ResetPlanExecution()
    {
        _activePlanStepIndex = -1;
        _completedPlanCycles = 0;
        _focusCycleNeedsInitialize = true;

        if (!_isPomodoroRunning && !_isBreakMode)
        {
            _remainingPomodoroTime = TimeSpan.FromMinutes(GetPreviewFocusMinutes());
        }

        OnPropertyChanged(nameof(FocusPlanSummaryText));
        RaisePomodoroDisplayChanged();
    }

    private void EnsurePlanExecutionState()
    {
        if (FocusPlanSteps.Count == 0)
        {
            _activePlanStepIndex = -1;
            _completedPlanCycles = 0;
            return;
        }

        if (_activePlanStepIndex < 0 || _activePlanStepIndex >= FocusPlanSteps.Count)
        {
            _activePlanStepIndex = 0;
        }
    }

    private int GetPreviewFocusMinutes()
    {
        if (FocusPlanSteps.Count == 0)
        {
            return _focusMinutesValue;
        }

        return FocusPlanSteps[0].DurationMinutes;
    }

    private int GetCurrentFocusMinutes()
    {
        if (TryGetActivePlanStep(out var step) && step is not null)
        {
            return step.DurationMinutes;
        }

        return _focusMinutesValue;
    }

    private bool TryGetActivePlanStep(out FocusPlanStep? step)
    {
        if (_activePlanStepIndex >= 0 && _activePlanStepIndex < FocusPlanSteps.Count)
        {
            step = FocusPlanSteps[_activePlanStepIndex];
            return true;
        }

        step = null;
        return false;
    }

    private bool AdvancePlanAfterFocusCycle()
    {
        if (FocusPlanSteps.Count == 0)
        {
            return true;
        }

        EnsurePlanExecutionState();
        if (_activePlanStepIndex < FocusPlanSteps.Count - 1)
        {
            _activePlanStepIndex++;
            OnPropertyChanged(nameof(FocusPlanSummaryText));
            return true;
        }

        _activePlanStepIndex = 0;
        _completedPlanCycles++;
        OnPropertyChanged(nameof(FocusPlanSummaryText));

        return _planCycleCountValue <= 0 || _completedPlanCycles < _planCycleCountValue;
    }

    private void CompleteFocusPlan()
    {
        _isPomodoroRunning = false;
        _pomodoroTimer.Stop();
        _isBreakMode = false;
        _focusCycleNeedsInitialize = true;
        ResetDistractionCounters();
        _activePlanStepIndex = -1;
        _remainingPomodoroTime = TimeSpan.FromMinutes(GetPreviewFocusMinutes());
        DistractionStatusText = "专注计划已完成";
        _notificationService.Notify("专注计划已完成", "所有计划步骤已执行完毕。");
        RaisePomodoroDisplayChanged();
        RaisePlanCommandCanExecuteChanged();
    }

    private HashSet<string> BuildAllowedWindowKeySet()
    {
        var allowedKeys = FocusWindowOptions
            .Where(option => option.IsSelected)
            .Select(option => option.WindowKey)
            .ToHashSet(StringComparer.Ordinal);

        if (TryGetActivePlanStep(out var step) && step is not null)
        {
            foreach (var key in step.WindowKeys)
            {
                allowedKeys.Add(key);
            }
        }

        return allowedKeys;
    }

    private void RemovePlanStepsByFocusItemId(long focusItemId)
    {
        var toRemove = FocusPlanSteps
            .Where(step => step.FocusItemId == focusItemId)
            .ToList();
        foreach (var step in toRemove)
        {
            step.PropertyChanged -= OnFocusPlanStepChanged;
            FocusPlanSteps.Remove(step);
        }

        ResetPlanExecution();
    }

    private void RemovePlanStepsWithoutFocusItem()
    {
        var existingIds = FocusItems
            .Select(item => item.Id)
            .ToHashSet();

        var toRemove = FocusPlanSteps
            .Where(step => !existingIds.Contains(step.FocusItemId))
            .ToList();
        foreach (var step in toRemove)
        {
            step.PropertyChanged -= OnFocusPlanStepChanged;
            FocusPlanSteps.Remove(step);
        }

        if (toRemove.Count > 0)
        {
            ResetPlanExecution();
        }
    }

    private void AdjustFocusSetting(object? parameter)
    {
        var token = parameter as string;
        if (string.IsNullOrWhiteSpace(token))
        {
            return;
        }

        var parts = token.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != 2)
        {
            return;
        }

        var field = parts[0].ToLowerInvariant();
        switch (field)
        {
            case "focus":
                if (int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var focusDelta))
                {
                    FocusMinutesInput = AdjustIntegerSettingText(FocusMinutesInput, focusDelta, 1, 240, 25);
                }

                break;
            case "break":
                if (int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var breakDelta))
                {
                    BreakMinutesInput = AdjustIntegerSettingText(BreakMinutesInput, breakDelta, 1, 120, 5);
                }

                break;
            case "threshold":
                if (double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var thresholdDelta))
                {
                    AlertThresholdMinutesInput = AdjustDoubleSettingText(AlertThresholdMinutesInput, thresholdDelta, 0.1, 240, 1);
                }

                break;
            case "cycle":
                if (int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var cycleDelta))
                {
                    PlanCycleCountInput = AdjustIntegerSettingText(PlanCycleCountInput, cycleDelta, -100000, 100000, 0);
                }

                break;
            case "item":
                if (int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var itemDelta))
                {
                    FocusItemDraftMinutesInput = AdjustIntegerSettingText(FocusItemDraftMinutesInput, itemDelta, 1, 240, 25);
                }

                break;
        }
    }

    private static string AdjustIntegerSettingText(string input, int delta, int min, int max, int fallback)
    {
        var current = int.TryParse(input, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;

        var next = Math.Clamp(current + delta, min, max);
        return next.ToString(CultureInfo.InvariantCulture);
    }

    private static string AdjustDoubleSettingText(string input, double delta, double min, double max, double fallback)
    {
        var current = double.TryParse(input, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;

        var next = Math.Clamp(current + delta, min, max);
        return next.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static string BuildWindowDisplayText(string processName, string title)
    {
        var displayProcess = processName.Equals(WindowCategory.DesktopProcess, StringComparison.OrdinalIgnoreCase)
            ? WindowCategory.DesktopDisplayName
            : processName;
        var displayTitle = title.Equals("Desktop", StringComparison.OrdinalIgnoreCase)
            ? WindowCategory.DesktopDisplayName
            : title;

        return $"{displayProcess} - {displayTitle}";
    }
}
