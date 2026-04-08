using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows.Input;
using System.Windows.Threading;
using OxyPlot;
using WindowMonitorApp.Data;
using WindowMonitorApp.Infrastructure;
using WindowMonitorApp.Models;
using WindowMonitorApp.Services;

namespace WindowMonitorApp.ViewModels;

public sealed partial class MainViewModel : ObservableObject, IDisposable
{
    private static readonly string[] PageNames =
    [
        "番茄钟",
        "数据统计",
        "窗口时长",
        "焦点排行",
        "开关机事件",
        "待办事项"
    ];

    private readonly AppDatabase _database;
    private readonly WindowTrackingService _windowTrackingService;
    private readonly PowerEventMonitor _powerEventMonitor;
    private readonly DesktopNotificationService _notificationService;
    private readonly DispatcherTimer _refreshTimer;
    private readonly DispatcherTimer _clockTimer;
    private readonly DispatcherTimer _pomodoroTimer;
    private readonly DispatcherTimer _windowSelectionRefreshTimer;
    private readonly DispatcherTimer _todoReminderTimer;
    private readonly DispatcherTimer _insightAutoSaveTimer;
    private readonly int _excludedProcessId;

    private int _selectedPageIndex;
    private int _focusPageIndex;
    private string _currentTimeText = string.Empty;
    private string _currentForegroundWindowText = "暂无前台窗口";
    private string _distractionStatusText = "提醒待命";
    private string _focusMinutesInput = "25";
    private string _breakMinutesInput = "5";
    private string _alertThresholdMinutesInput = "1";
    private string _selectedAlertMode = "连续";
    private bool _isPomodoroRunning;
    private bool _isBreakMode;
    private int _focusMinutesValue = 25;
    private int _breakMinutesValue = 5;
    private double _alertThresholdMinutesValue = 1;
    private TimeSpan _remainingPomodoroTime = TimeSpan.FromMinutes(25);
    private TimeSpan _offTargetContinuous = TimeSpan.Zero;
    private TimeSpan _offTargetCumulative = TimeSpan.Zero;
    private bool _offTargetAlertSent;
    private string _focusItemDraftTitle = string.Empty;
    private string _focusItemDraftMinutesInput = "25";
    private long _editingFocusItemId;
    private FocusItem? _selectedFocusItem;
    private string _planCycleCountInput = "0";
    private int _planCycleCountValue;
    private int _activePlanStepIndex = -1;
    private int _completedPlanCycles;
    private bool _focusCycleNeedsInitialize = true;
    private string _planTemplateDraftName = "默认模板";
    private FocusPlanTemplate? _selectedPlanTemplate;

    private string _todoStatusText = string.Empty;
    private bool _isCreateTodoPanelExpanded;
    private string _draftTitle = string.Empty;
    private string _draftTaskType = TodoTaskType.OneTime;
    private string _draftRepeatMode = TodoRepeatMode.Daily;
    private string _draftCustomPattern = string.Empty;
    private bool _draftReminderEnabled;
    private string _draftReminderYear = string.Empty;
    private string _draftReminderMonth = string.Empty;
    private string _draftReminderDay = string.Empty;
    private string _draftReminderHour = string.Empty;
    private string _draftReminderMinute = string.Empty;
    private string _draftReminderSecond = string.Empty;
    private TodoTask? _selectedActiveTask;
    private TodoArchiveGroup? _selectedArchiveGroup;
    private string _editTitle = string.Empty;
    private string _editTaskType = TodoTaskType.OneTime;
    private string _editRepeatMode = TodoRepeatMode.Daily;
    private string _editCustomPattern = string.Empty;
    private bool _editReminderEnabled;
    private string _editReminderYear = string.Empty;
    private string _editReminderMonth = string.Empty;
    private string _editReminderDay = string.Empty;
    private string _editReminderHour = string.Empty;
    private string _editReminderMinute = string.Empty;
    private string _editReminderSecond = string.Empty;
    private string _editInsight = string.Empty;
    private bool _isLoadingEditor;
    private bool _hasPendingInsightSave;
    private bool _useCategorySummary = true;
    private DateTime _analyticsDateLocal = DateTime.Today;
    private string _timelineStartText = DateTime.Now.AddHours(-12).ToString("yyyy-MM-dd HH:mm");
    private string _timelineEndText = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
    private string _selectedHeatmapMetric = WindowCategory.Study;
    private PlotModel _pieChartModel = new();
    private PlotModel _barChartModel = new();
    private PlotModel _heatmapChartModel = new();

    public MainViewModel()
    {
        _excludedProcessId = Process.GetCurrentProcess().Id;

        PageOptions = new ObservableCollection<PageOption>(
        [
            new PageOption { Index = 0, Name = "番茄钟" },
            new PageOption { Index = 1, Name = "数据统计" },
            new PageOption { Index = 2, Name = "窗口时长" },
            new PageOption { Index = 3, Name = "焦点排行" },
            new PageOption { Index = 4, Name = "开关机事件" },
            new PageOption { Index = 5, Name = "待办事项" }
        ]);
        AlertModes = new ObservableCollection<string>(["连续", "累计"]);
        TaskTypeOptions = new ObservableCollection<string>(TodoTaskType.All);
        RepeatModeOptions = new ObservableCollection<string>(TodoRepeatMode.All);
        CategoryOptions = new ObservableCollection<string>(WindowCategory.All);

        AllWindowStats = new ObservableCollection<WindowUsageStat>();
        FocusWindowStats = new ObservableCollection<WindowUsageStat>();
        PowerEvents = new ObservableCollection<PowerEventRecord>();
        FocusWindowOptions = new ObservableCollection<FocusWindowOption>();
        FocusItemWindowOptions = new ObservableCollection<FocusWindowOption>();
        FocusItems = new ObservableCollection<FocusItem>();
        FocusPlanSteps = new ObservableCollection<FocusPlanStep>();
        FocusPlanTemplates = new ObservableCollection<FocusPlanTemplate>();
        ActiveTodoTasks = new ObservableCollection<TodoTask>();
        ArchivedTodoGroups = new ObservableCollection<TodoArchiveGroup>();
        SelectedArchiveRecords = new ObservableCollection<TodoArchiveRecord>();
        ProcessCategoryItems = new ObservableCollection<ProcessCategoryItem>();
        TimelineEntries = new ObservableCollection<TimelineEntry>();
        HeatmapMetricOptions = new ObservableCollection<string>(WindowCategory.All);
        DraftWeeklyDays = BuildDaySelection(7);
        DraftMonthlyDays = BuildDaySelection(31);
        EditWeeklyDays = BuildDaySelection(7);
        EditMonthlyDays = BuildDaySelection(31);

        PreviousPageCommand = new RelayCommand(_ => MovePage(-1));
        NextPageCommand = new RelayCommand(_ => MovePage(1));
        GoToPageCommand = new RelayCommand(GoToPage);
        StartPausePomodoroCommand = new RelayCommand(_ => TogglePomodoro());
        ResetPomodoroCommand = new RelayCommand(_ => ResetPomodoro());
        SwitchPomodoroModeCommand = new RelayCommand(_ => SwitchPomodoroMode());
        RefreshOpenWindowsCommand = new RelayCommand(_ => RefreshOpenWindowsForSelection());
        SelectAllFocusWindowsCommand = new RelayCommand(_ => SelectAllFocusWindows());
        ClearFocusWindowsCommand = new RelayCommand(_ => ClearFocusWindowSelection());
        SelectAllFocusItemWindowsCommand = new RelayCommand(_ => SelectAllFocusItemWindows());
        ClearFocusItemWindowsCommand = new RelayCommand(_ => ClearFocusItemWindowSelection());
        CreateFocusItemCommand = new RelayCommand(_ => CreateFocusItem(), _ => CanCreateFocusItem());
        StartEditFocusItemCommand = new RelayCommand(StartEditFocusItem, _ => !_isPomodoroRunning);
        CancelEditFocusItemCommand = new RelayCommand(_ => CancelEditFocusItem(), _ => !_isPomodoroRunning && IsEditingFocusItem);
        DeleteFocusItemCommand = new RelayCommand(DeleteFocusItem, parameter => !_isPomodoroRunning && parameter is FocusItem);
        AddFocusItemToPlanCommand = new RelayCommand(AddFocusItemToPlan, CanAddFocusItemToPlan);
        RemovePlanStepCommand = new RelayCommand(RemovePlanStep, CanRemovePlanStep);
        MovePlanStepUpCommand = new RelayCommand(parameter => MovePlanStep(parameter, -1), parameter => CanMovePlanStep(parameter, -1));
        MovePlanStepDownCommand = new RelayCommand(parameter => MovePlanStep(parameter, 1), parameter => CanMovePlanStep(parameter, 1));
        ClearPlanStepsCommand = new RelayCommand(_ => ClearPlanSteps(), _ => !_isPomodoroRunning && FocusPlanSteps.Count > 0);
        SaveFocusPlanTemplateCommand = new RelayCommand(_ => SaveFocusPlanTemplate(), _ => !_isPomodoroRunning && FocusPlanSteps.Count > 0 && !string.IsNullOrWhiteSpace(PlanTemplateDraftName));
        LoadFocusPlanTemplateCommand = new RelayCommand(_ => LoadSelectedFocusPlanTemplate(), _ => !_isPomodoroRunning && SelectedPlanTemplate is not null);
        DeleteFocusPlanTemplateCommand = new RelayCommand(_ => DeleteSelectedFocusPlanTemplate(), _ => !_isPomodoroRunning && SelectedPlanTemplate is not null);
        AdjustFocusSettingCommand = new RelayCommand(AdjustFocusSetting, _ => !_isPomodoroRunning);
        RefreshCommand = new RelayCommand(_ => RefreshAllData());
        ToggleCreateTodoPanelCommand = new RelayCommand(_ => IsCreateTodoPanelExpanded = !IsCreateTodoPanelExpanded);
        CreateTodoCommand = new RelayCommand(_ => CreateTodoTask(), _ => CanCreateTodoTask());
        CompleteTodoCommand = new RelayCommand(CompleteTodoTask);
        SaveSelectedTodoCommand = new RelayCommand(_ => SaveSelectedTaskSettings(), _ => CanSaveSelectedTodoTask());
        DeleteArchiveGroupCommand = new RelayCommand(DeleteArchiveGroup, CanDeleteArchiveGroup);
        AdjustDraftReminderValueCommand = new RelayCommand(AdjustDraftReminderValue, _ => DraftReminderEnabled);
        AdjustEditReminderValueCommand = new RelayCommand(AdjustEditReminderValue, _ => EditReminderEnabled && SelectedActiveTask is not null);
        ToggleAnalyticsModeCommand = new RelayCommand(_ => ToggleAnalyticsMode());
        PreviousAnalyticsDateCommand = new RelayCommand(_ => ShiftAnalyticsDate(-1));
        NextAnalyticsDateCommand = new RelayCommand(_ => ShiftAnalyticsDate(1));
        ApplyTimelineRangeCommand = new RelayCommand(_ => ApplyTimelineRange());

        _database = new AppDatabase();
        _database.Initialize();

        _powerEventMonitor = new PowerEventMonitor(_database);
        _powerEventMonitor.Start();

        _windowTrackingService = new WindowTrackingService(_database);
        _windowTrackingService.Start();

        _notificationService = new DesktopNotificationService();

        _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _refreshTimer.Tick += (_, _) => RefreshDataFromDatabase();
        _refreshTimer.Start();

        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _clockTimer.Tick += (_, _) => CurrentTimeText = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        _clockTimer.Start();

        _pomodoroTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _pomodoroTimer.Tick += (_, _) => OnPomodoroTick();

        _windowSelectionRefreshTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _windowSelectionRefreshTimer.Tick += (_, _) => RefreshOpenWindowsForSelection();
        _windowSelectionRefreshTimer.Start();

        _todoReminderTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _todoReminderTimer.Tick += (_, _) => EvaluateTodoReminders();
        _todoReminderTimer.Start();

        _insightAutoSaveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
        _insightAutoSaveTimer.Tick += (_, _) => AutoSaveSelectedInsight();

        SetDefaultDraftReminderTime();
        CurrentTimeText = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        TodoStatusText = $"数据库：{_database.DatabasePath}";
        RefreshAllData();
        RaisePomodoroDisplayChanged();
        RaisePlanCommandCanExecuteChanged();
        RaiseTodoCommandCanExecuteChanged();
    }

    public ObservableCollection<PageOption> PageOptions { get; }

    public ObservableCollection<string> AlertModes { get; }

    public ObservableCollection<string> TaskTypeOptions { get; }

    public ObservableCollection<string> RepeatModeOptions { get; }

    public ObservableCollection<string> CategoryOptions { get; }

    public ObservableCollection<WindowUsageStat> AllWindowStats { get; }

    public ObservableCollection<WindowUsageStat> FocusWindowStats { get; }

    public ObservableCollection<PowerEventRecord> PowerEvents { get; }

    public ObservableCollection<FocusWindowOption> FocusWindowOptions { get; }

    public ObservableCollection<FocusWindowOption> FocusItemWindowOptions { get; }

    public ObservableCollection<FocusItem> FocusItems { get; }

    public ObservableCollection<FocusPlanStep> FocusPlanSteps { get; }

    public ObservableCollection<FocusPlanTemplate> FocusPlanTemplates { get; }

    public ObservableCollection<TodoTask> ActiveTodoTasks { get; }

    public ObservableCollection<TodoArchiveGroup> ArchivedTodoGroups { get; }

    public ObservableCollection<TodoArchiveRecord> SelectedArchiveRecords { get; }

    public ObservableCollection<ProcessCategoryItem> ProcessCategoryItems { get; }

    public ObservableCollection<TimelineEntry> TimelineEntries { get; }

    public ObservableCollection<string> HeatmapMetricOptions { get; }

    public ObservableCollection<DaySelectionItem> DraftWeeklyDays { get; }

    public ObservableCollection<DaySelectionItem> DraftMonthlyDays { get; }

    public ObservableCollection<DaySelectionItem> EditWeeklyDays { get; }

    public ObservableCollection<DaySelectionItem> EditMonthlyDays { get; }

    public ICommand PreviousPageCommand { get; }

    public ICommand NextPageCommand { get; }

    public ICommand GoToPageCommand { get; }

    public ICommand StartPausePomodoroCommand { get; }

    public ICommand ResetPomodoroCommand { get; }

    public ICommand SwitchPomodoroModeCommand { get; }

    public ICommand RefreshOpenWindowsCommand { get; }

    public ICommand SelectAllFocusWindowsCommand { get; }

    public ICommand ClearFocusWindowsCommand { get; }

    public ICommand SelectAllFocusItemWindowsCommand { get; }

    public ICommand ClearFocusItemWindowsCommand { get; }

    public ICommand CreateFocusItemCommand { get; }

    public ICommand StartEditFocusItemCommand { get; }

    public ICommand CancelEditFocusItemCommand { get; }

    public ICommand DeleteFocusItemCommand { get; }

    public ICommand AddFocusItemToPlanCommand { get; }

    public ICommand RemovePlanStepCommand { get; }

    public ICommand MovePlanStepUpCommand { get; }

    public ICommand MovePlanStepDownCommand { get; }

    public ICommand ClearPlanStepsCommand { get; }

    public ICommand SaveFocusPlanTemplateCommand { get; }

    public ICommand LoadFocusPlanTemplateCommand { get; }

    public ICommand DeleteFocusPlanTemplateCommand { get; }

    public ICommand AdjustFocusSettingCommand { get; }

    public ICommand RefreshCommand { get; }

    public ICommand ToggleCreateTodoPanelCommand { get; }

    public ICommand CreateTodoCommand { get; }

    public ICommand CompleteTodoCommand { get; }

    public ICommand SaveSelectedTodoCommand { get; }

    public ICommand DeleteArchiveGroupCommand { get; }

    public ICommand AdjustDraftReminderValueCommand { get; }

    public ICommand AdjustEditReminderValueCommand { get; }

    public ICommand ToggleAnalyticsModeCommand { get; }

    public ICommand PreviousAnalyticsDateCommand { get; }

    public ICommand NextAnalyticsDateCommand { get; }

    public ICommand ApplyTimelineRangeCommand { get; }

    public int SelectedPageIndex
    {
        get => _selectedPageIndex;
        set
        {
            var clamped = Math.Clamp(value, 0, PageNames.Length - 1);
            if (SetProperty(ref _selectedPageIndex, clamped))
            {
                OnPropertyChanged(nameof(PageIndicatorText));
            }
        }
    }

    public int FocusPageIndex
    {
        get => _focusPageIndex;
        set => SetProperty(ref _focusPageIndex, Math.Clamp(value, 0, PageNames.Length - 1));
    }

    public string PageIndicatorText => $"第 {SelectedPageIndex + 1}/{PageNames.Length} 页：{PageNames[SelectedPageIndex]}";

    public string CurrentTimeText
    {
        get => _currentTimeText;
        private set => SetProperty(ref _currentTimeText, value);
    }

    public string CurrentForegroundWindowText
    {
        get => _currentForegroundWindowText;
        private set => SetProperty(ref _currentForegroundWindowText, value);
    }

    public string DistractionStatusText
    {
        get => _distractionStatusText;
        private set => SetProperty(ref _distractionStatusText, value);
    }

    public string FocusMinutesInput
    {
        get => _focusMinutesInput;
        set => SetProperty(ref _focusMinutesInput, value);
    }

    public string BreakMinutesInput
    {
        get => _breakMinutesInput;
        set => SetProperty(ref _breakMinutesInput, value);
    }

    public string AlertThresholdMinutesInput
    {
        get => _alertThresholdMinutesInput;
        set => SetProperty(ref _alertThresholdMinutesInput, value);
    }

    public string SelectedAlertMode
    {
        get => _selectedAlertMode;
        set => SetProperty(ref _selectedAlertMode, value);
    }

    public string PomodoroDisplay => $"{(int)_remainingPomodoroTime.TotalMinutes:00}:{_remainingPomodoroTime.Seconds:00}";

    public string PomodoroModeText => _isBreakMode ? "休息中" : "专注中";

    public string PomodoroButtonText => _isPomodoroRunning ? "暂停" : "开始";

    public int AllowedWindowCount => FocusWindowOptions.Count(x => x.IsSelected);

    public int FocusItemWindowCount => FocusItemWindowOptions.Count(x => x.IsSelected);

    public string FocusItemDraftTitle
    {
        get => _focusItemDraftTitle;
        set
        {
            if (SetProperty(ref _focusItemDraftTitle, value))
            {
                RaisePlanCommandCanExecuteChanged();
            }
        }
    }

    public string FocusItemDraftMinutesInput
    {
        get => _focusItemDraftMinutesInput;
        set
        {
            if (SetProperty(ref _focusItemDraftMinutesInput, value))
            {
                RaisePlanCommandCanExecuteChanged();
            }
        }
    }

    public FocusItem? SelectedFocusItem
    {
        get => _selectedFocusItem;
        set => SetProperty(ref _selectedFocusItem, value);
    }

    public bool IsEditingFocusItem => _editingFocusItemId > 0;

    public string FocusItemEditorButtonText => IsEditingFocusItem ? "保存事项" : "创建事项";

    public string FocusItemEditorTitleText => IsEditingFocusItem ? "编辑专注事项" : "新建专注事项";

    public string PlanTemplateDraftName
    {
        get => _planTemplateDraftName;
        set
        {
            if (SetProperty(ref _planTemplateDraftName, value))
            {
                RaisePlanCommandCanExecuteChanged();
            }
        }
    }

    public FocusPlanTemplate? SelectedPlanTemplate
    {
        get => _selectedPlanTemplate;
        set
        {
            if (!SetProperty(ref _selectedPlanTemplate, value))
            {
                return;
            }

            RaisePlanCommandCanExecuteChanged();
        }
    }

    public string PlanCycleCountInput
    {
        get => _planCycleCountInput;
        set
        {
            if (!SetProperty(ref _planCycleCountInput, value))
            {
                return;
            }

            OnPropertyChanged(nameof(FocusPlanSummaryText));
        }
    }

    public string FocusPlanSummaryText
    {
        get
        {
            var cycleCount = int.TryParse(PlanCycleCountInput, out var parsedCycle)
                ? parsedCycle
                : _planCycleCountValue;

            if (FocusPlanSteps.Count == 0)
            {
                return "当前计划：仅使用手动专注";
            }

            var cycleText = cycleCount <= 0
                ? "无限循环"
                : $"{Math.Max(0, _completedPlanCycles)}/{cycleCount}";

            if (_activePlanStepIndex < 0 || _activePlanStepIndex >= FocusPlanSteps.Count)
            {
                return $"当前计划：共 {FocusPlanSteps.Count} 步，循环 {cycleText}";
            }

            var step = FocusPlanSteps[_activePlanStepIndex];
            return $"当前步骤：{_activePlanStepIndex + 1}/{FocusPlanSteps.Count}，{step.Title}（{step.DurationMinutes} 分钟），循环 {cycleText}";
        }
    }

    public string TodoStatusText
    {
        get => _todoStatusText;
        private set => SetProperty(ref _todoStatusText, value);
    }

    public bool IsCreateTodoPanelExpanded
    {
        get => _isCreateTodoPanelExpanded;
        set => SetProperty(ref _isCreateTodoPanelExpanded, value);
    }

    public string DraftTitle
    {
        get => _draftTitle;
        set
        {
            if (SetProperty(ref _draftTitle, value))
            {
                RaiseTodoCommandCanExecuteChanged();
            }
        }
    }

    public string DraftTaskType
    {
        get => _draftTaskType;
        set
        {
            if (SetProperty(ref _draftTaskType, value))
            {
                OnPropertyChanged(nameof(IsDraftRepeatTask));
            }
        }
    }

    public bool IsDraftRepeatTask => string.Equals(DraftTaskType, TodoTaskType.Repeat, StringComparison.Ordinal);

    public string DraftRepeatMode
    {
        get => _draftRepeatMode;
        set
        {
            if (SetProperty(ref _draftRepeatMode, value))
            {
                OnPropertyChanged(nameof(IsDraftWeekly));
                OnPropertyChanged(nameof(IsDraftMonthly));
                OnPropertyChanged(nameof(IsDraftCustom));
            }
        }
    }

    public bool IsDraftWeekly => string.Equals(DraftRepeatMode, TodoRepeatMode.Weekly, StringComparison.Ordinal);

    public bool IsDraftMonthly => string.Equals(DraftRepeatMode, TodoRepeatMode.Monthly, StringComparison.Ordinal);

    public bool IsDraftCustom => string.Equals(DraftRepeatMode, TodoRepeatMode.Custom, StringComparison.Ordinal);

    public string DraftCustomPattern
    {
        get => _draftCustomPattern;
        set => SetProperty(ref _draftCustomPattern, value);
    }

    public bool DraftReminderEnabled
    {
        get => _draftReminderEnabled;
        set
        {
            if (SetProperty(ref _draftReminderEnabled, value))
            {
                RaiseTodoCommandCanExecuteChanged();
            }
        }
    }

    public string DraftReminderYear
    {
        get => _draftReminderYear;
        set => SetProperty(ref _draftReminderYear, value);
    }

    public string DraftReminderMonth
    {
        get => _draftReminderMonth;
        set => SetProperty(ref _draftReminderMonth, value);
    }

    public string DraftReminderDay
    {
        get => _draftReminderDay;
        set => SetProperty(ref _draftReminderDay, value);
    }

    public string DraftReminderHour
    {
        get => _draftReminderHour;
        set => SetProperty(ref _draftReminderHour, value);
    }

    public string DraftReminderMinute
    {
        get => _draftReminderMinute;
        set => SetProperty(ref _draftReminderMinute, value);
    }

    public string DraftReminderSecond
    {
        get => _draftReminderSecond;
        set => SetProperty(ref _draftReminderSecond, value);
    }

    public TodoTask? SelectedActiveTask
    {
        get => _selectedActiveTask;
        set
        {
            if (!SetProperty(ref _selectedActiveTask, value))
            {
                return;
            }

            if (value is not null)
            {
                if (_selectedArchiveGroup is not null)
                {
                    _selectedArchiveGroup = null;
                    OnPropertyChanged(nameof(SelectedArchiveGroup));
                    SelectedArchiveRecords.Clear();
                    OnPropertyChanged(nameof(HasSelectedArchiveGroup));
                }

                LoadSelectedTaskEditor(value);
            }

            OnPropertyChanged(nameof(HasSelectedActiveTask));
            RaiseTodoCommandCanExecuteChanged();
        }
    }

    public TodoArchiveGroup? SelectedArchiveGroup
    {
        get => _selectedArchiveGroup;
        set
        {
            if (!SetProperty(ref _selectedArchiveGroup, value))
            {
                return;
            }

            if (value is not null)
            {
                if (_selectedActiveTask is not null)
                {
                    _selectedActiveTask = null;
                    OnPropertyChanged(nameof(SelectedActiveTask));
                    OnPropertyChanged(nameof(HasSelectedActiveTask));
                }

                LoadArchiveRecords(value.TaskId);
            }
            else
            {
                SelectedArchiveRecords.Clear();
            }

            OnPropertyChanged(nameof(HasSelectedArchiveGroup));
            RaiseTodoCommandCanExecuteChanged();
        }
    }

    public string EditTitle
    {
        get => _editTitle;
        set
        {
            if (SetProperty(ref _editTitle, value))
            {
                RaiseTodoCommandCanExecuteChanged();
            }
        }
    }

    public string EditTaskType
    {
        get => _editTaskType;
        set
        {
            if (SetProperty(ref _editTaskType, value))
            {
                OnPropertyChanged(nameof(IsEditRepeatTask));
            }
        }
    }

    public bool IsEditRepeatTask => string.Equals(EditTaskType, TodoTaskType.Repeat, StringComparison.Ordinal);

    public string EditRepeatMode
    {
        get => _editRepeatMode;
        set
        {
            if (SetProperty(ref _editRepeatMode, value))
            {
                OnPropertyChanged(nameof(IsEditWeekly));
                OnPropertyChanged(nameof(IsEditMonthly));
                OnPropertyChanged(nameof(IsEditCustom));
            }
        }
    }

    public bool IsEditWeekly => string.Equals(EditRepeatMode, TodoRepeatMode.Weekly, StringComparison.Ordinal);

    public bool IsEditMonthly => string.Equals(EditRepeatMode, TodoRepeatMode.Monthly, StringComparison.Ordinal);

    public bool IsEditCustom => string.Equals(EditRepeatMode, TodoRepeatMode.Custom, StringComparison.Ordinal);

    public string EditCustomPattern
    {
        get => _editCustomPattern;
        set => SetProperty(ref _editCustomPattern, value);
    }

    public bool EditReminderEnabled
    {
        get => _editReminderEnabled;
        set
        {
            if (SetProperty(ref _editReminderEnabled, value))
            {
                RaiseTodoCommandCanExecuteChanged();
            }
        }
    }

    public string EditReminderYear
    {
        get => _editReminderYear;
        set => SetProperty(ref _editReminderYear, value);
    }

    public string EditReminderMonth
    {
        get => _editReminderMonth;
        set => SetProperty(ref _editReminderMonth, value);
    }

    public string EditReminderDay
    {
        get => _editReminderDay;
        set => SetProperty(ref _editReminderDay, value);
    }

    public string EditReminderHour
    {
        get => _editReminderHour;
        set => SetProperty(ref _editReminderHour, value);
    }

    public string EditReminderMinute
    {
        get => _editReminderMinute;
        set => SetProperty(ref _editReminderMinute, value);
    }

    public string EditReminderSecond
    {
        get => _editReminderSecond;
        set => SetProperty(ref _editReminderSecond, value);
    }

    public string EditInsight
    {
        get => _editInsight;
        set
        {
            if (!SetProperty(ref _editInsight, value))
            {
                return;
            }

            if (_isLoadingEditor || SelectedActiveTask is null)
            {
                return;
            }

            _hasPendingInsightSave = true;
            _insightAutoSaveTimer.Stop();
            _insightAutoSaveTimer.Start();
        }
    }

    public bool HasSelectedActiveTask => SelectedActiveTask is not null;

    public bool HasSelectedArchiveGroup => SelectedArchiveGroup is not null;

    public bool UseCategorySummary
    {
        get => _useCategorySummary;
        set
        {
            if (!SetProperty(ref _useCategorySummary, value))
            {
                return;
            }

            UpdateHeatmapMetricOptions();
            RefreshAnalyticsData();
            OnPropertyChanged(nameof(AnalyticsModeText));
        }
    }

    public string AnalyticsModeText => UseCategorySummary ? "按性质" : "按窗口";

    public DateTime AnalyticsDateLocal
    {
        get => _analyticsDateLocal;
        set
        {
            if (SetProperty(ref _analyticsDateLocal, value.Date))
            {
                RefreshAnalyticsData();
            }
        }
    }

    public string TimelineStartText
    {
        get => _timelineStartText;
        set => SetProperty(ref _timelineStartText, value);
    }

    public string TimelineEndText
    {
        get => _timelineEndText;
        set => SetProperty(ref _timelineEndText, value);
    }

    public string SelectedHeatmapMetric
    {
        get => _selectedHeatmapMetric;
        set
        {
            if (SetProperty(ref _selectedHeatmapMetric, value))
            {
                RefreshAnalyticsData();
            }
        }
    }

    public PlotModel PieChartModel
    {
        get => _pieChartModel;
        private set => SetProperty(ref _pieChartModel, value);
    }

    public PlotModel BarChartModel
    {
        get => _barChartModel;
        private set => SetProperty(ref _barChartModel, value);
    }

    public PlotModel HeatmapChartModel
    {
        get => _heatmapChartModel;
        private set => SetProperty(ref _heatmapChartModel, value);
    }

    public void Dispose()
    {
        _refreshTimer.Stop();
        _clockTimer.Stop();
        _pomodoroTimer.Stop();
        _windowSelectionRefreshTimer.Stop();
        _todoReminderTimer.Stop();
        _insightAutoSaveTimer.Stop();

        foreach (var option in FocusWindowOptions)
        {
            option.PropertyChanged -= OnFocusWindowOptionChanged;
        }

        foreach (var option in FocusItemWindowOptions)
        {
            option.PropertyChanged -= OnFocusItemWindowOptionChanged;
        }

        foreach (var step in FocusPlanSteps)
        {
            step.PropertyChanged -= OnFocusPlanStepChanged;
        }

        foreach (var item in ProcessCategoryItems)
        {
            item.PropertyChanged -= OnProcessCategoryItemChanged;
        }

        _windowTrackingService.Dispose();
        _powerEventMonitor.Dispose();
        _notificationService.Dispose();
    }

    private static ObservableCollection<DaySelectionItem> BuildDaySelection(int count)
    {
        var items = new ObservableCollection<DaySelectionItem>();
        for (var i = 1; i <= count; i++)
        {
            items.Add(new DaySelectionItem { Day = i });
        }

        return items;
    }
}
