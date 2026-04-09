import { WindowClassificationProfile, FocusSession, FocusSubject, FocusQueueItem, PomodoroSettings, TodoTask, TodoArchiveRecord, PowerEventRecord, AppState, Category } from '@/types';

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const h = (hours: number, minutes = 0) => new Date(today.getTime() + hours * 3600000 + minutes * 60000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

let idCounter = 1;
const uid = () => `id-${idCounter++}`;

const profiles: WindowClassificationProfile[] = [
  { id: uid(), classificationKey: 'vscode', displayName: 'VS Code', objectType: 'AppWindow', processName: 'code.exe', normalizedTitle: 'Visual Studio Code', category: '学习', isBuiltIn: true, updatedAt: daysAgo(30) },
  { id: uid(), classificationKey: 'chrome-github', displayName: 'GitHub - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: 'GitHub', domain: 'github.com', category: '学习', isBuiltIn: false, updatedAt: daysAgo(5) },
  { id: uid(), classificationKey: 'chrome-bilibili', displayName: 'Bilibili - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: 'bilibili', domain: 'bilibili.com', category: '娱乐', isBuiltIn: false, updatedAt: daysAgo(2) },
  { id: uid(), classificationKey: 'chrome-zhihu', displayName: '知乎 - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: '知乎', domain: 'zhihu.com', category: '学习', isBuiltIn: false, updatedAt: daysAgo(1) },
  { id: uid(), classificationKey: 'wechat', displayName: '微信', objectType: 'AppWindow', processName: 'WeChat.exe', normalizedTitle: '微信', category: '社交', isBuiltIn: true, updatedAt: daysAgo(30) },
  { id: uid(), classificationKey: 'notion', displayName: 'Notion', objectType: 'AppWindow', processName: 'Notion.exe', normalizedTitle: 'Notion', category: '学习', isBuiltIn: false, updatedAt: daysAgo(10) },
  { id: uid(), classificationKey: 'desktop', displayName: '桌面', objectType: 'Desktop', processName: 'explorer.exe', normalizedTitle: 'Desktop', category: '休息', isBuiltIn: true, updatedAt: daysAgo(30) },
  { id: uid(), classificationKey: 'terminal', displayName: 'Windows Terminal', objectType: 'AppWindow', processName: 'WindowsTerminal.exe', normalizedTitle: 'Windows Terminal', category: '学习', isBuiltIn: false, updatedAt: daysAgo(7) },
  { id: uid(), classificationKey: 'chrome-youtube', displayName: 'YouTube - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: 'YouTube', domain: 'youtube.com', category: '娱乐', isBuiltIn: false, updatedAt: daysAgo(3) },
  { id: uid(), classificationKey: 'pdf-reader', displayName: 'PDF阅读器', objectType: 'AppWindow', processName: 'SumatraPDF.exe', normalizedTitle: 'SumatraPDF', category: '学习', isBuiltIn: false, updatedAt: daysAgo(15) },
  { id: uid(), classificationKey: 'qq', displayName: 'QQ', objectType: 'AppWindow', processName: 'QQ.exe', normalizedTitle: 'QQ', category: '社交', isBuiltIn: true, updatedAt: daysAgo(30) },
  { id: uid(), classificationKey: 'chrome-chatgpt', displayName: 'ChatGPT - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: 'ChatGPT', domain: 'chatgpt.com', category: '学习', isBuiltIn: false, updatedAt: daysAgo(1) },
  { id: uid(), classificationKey: 'explorer', displayName: '文件管理器', objectType: 'AppWindow', processName: 'explorer.exe', normalizedTitle: 'File Explorer', category: '其他', isBuiltIn: true, updatedAt: daysAgo(30) },
  { id: uid(), classificationKey: 'chrome-douyin', displayName: '抖音 - Chrome', objectType: 'BrowserTab', processName: 'chrome.exe', browserName: 'Chrome', normalizedTitle: '抖音', domain: 'douyin.com', category: '娱乐', isBuiltIn: false, updatedAt: daysAgo(4) },
];

function generateSessions(): FocusSession[] {
  const sessions: FocusSession[] = [];
  const windowPool = profiles.filter(p => p.classificationKey !== 'desktop');
  
  // Generate sessions for today and past 7 days
  for (let day = 0; day < 7; day++) {
    const dayStart = new Date(today.getTime() - day * 86400000);
    let cursor = new Date(dayStart.getTime() + 8 * 3600000); // Start at 8am
    const dayEnd = new Date(dayStart.getTime() + 22 * 3600000); // End at 10pm
    
    while (cursor < dayEnd) {
      const profile = windowPool[Math.floor(Math.random() * windowPool.length)];
      const dur = Math.floor(Math.random() * 1800) + 60; // 1-30 min
      const start = new Date(cursor);
      const end = new Date(cursor.getTime() + dur * 1000);
      
      if (end > dayEnd) break;
      
      sessions.push({
        id: uid(),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        durationSeconds: dur,
        classificationKey: profile.classificationKey,
        displayName: profile.displayName,
        objectType: profile.objectType,
        categoryAtThatTime: profile.category,
        processName: profile.processName,
        windowTitle: profile.normalizedTitle,
        browserTabTitle: profile.objectType === 'BrowserTab' ? profile.normalizedTitle : undefined,
        domain: profile.domain,
        isDesktop: profile.objectType === 'Desktop',
      });
      
      // Add small gap or desktop time
      cursor = new Date(end.getTime() + Math.floor(Math.random() * 300) * 1000);
    }
  }
  return sessions;
}

const subjects: FocusSubject[] = [
  { id: uid(), title: '编程学习', defaultMinutes: 45, windowGroup: [
    { classificationKey: 'vscode', displayName: 'VS Code', objectType: 'AppWindow' },
    { classificationKey: 'terminal', displayName: 'Windows Terminal', objectType: 'AppWindow' },
    { classificationKey: 'chrome-github', displayName: 'GitHub - Chrome', objectType: 'BrowserTab' },
  ], createdAt: daysAgo(20), updatedAt: daysAgo(1) },
  { id: uid(), title: '论文阅读', defaultMinutes: 30, windowGroup: [
    { classificationKey: 'pdf-reader', displayName: 'PDF阅读器', objectType: 'AppWindow' },
    { classificationKey: 'chrome-zhihu', displayName: '知乎 - Chrome', objectType: 'BrowserTab' },
  ], createdAt: daysAgo(15), updatedAt: daysAgo(3) },
  { id: uid(), title: 'AI学习', defaultMinutes: 25, windowGroup: [
    { classificationKey: 'chrome-chatgpt', displayName: 'ChatGPT - Chrome', objectType: 'BrowserTab' },
    { classificationKey: 'notion', displayName: 'Notion', objectType: 'AppWindow' },
  ], createdAt: daysAgo(10), updatedAt: daysAgo(2) },
  { id: uid(), title: '笔记整理', defaultMinutes: 20, windowGroup: [
    { classificationKey: 'notion', displayName: 'Notion', objectType: 'AppWindow' },
  ], createdAt: daysAgo(8), updatedAt: daysAgo(1) },
];

const queue: FocusQueueItem[] = [
  { id: uid(), itemType: 'Subject', title: '编程学习', durationMinutes: 45, windowGroup: subjects[0].windowGroup, sourceSubjectId: subjects[0].id, orderIndex: 0 },
  { id: uid(), itemType: 'Subject', title: '论文阅读', durationMinutes: 30, windowGroup: subjects[1].windowGroup, sourceSubjectId: subjects[1].id, orderIndex: 1 },
  { id: uid(), itemType: 'AdHocWindowGroup', title: '临时: VS Code + Terminal', durationMinutes: 25, windowGroup: [
    { classificationKey: 'vscode', displayName: 'VS Code', objectType: 'AppWindow' },
    { classificationKey: 'terminal', displayName: 'Windows Terminal', objectType: 'AppWindow' },
  ], orderIndex: 2 },
];

const pomodoroSettings: PomodoroSettings = {
  focusMinutes: 25,
  breakMinutes: 5,
  distractionThresholdMinutes: 3,
  distractionMode: '连续',
  notifyEnabled: true,
  soundEnabled: true,
  cycleCount: 4,
};

const todos: TodoTask[] = [
  { id: uid(), title: '完成React项目重构', taskType: '一次性', reminderEnabled: true, reminderHour: 14, reminderMinute: 0, reminderSecond: 0, currentInsight: '已完成组件拆分，下一步处理状态管理。\n\n需要注意：\n1. Context API vs Zustand\n2. 性能优化', lastReminderStamp: undefined, isArchived: false, createdAt: daysAgo(5), updatedAt: daysAgo(1) },
  { id: uid(), title: '每日代码复习', taskType: '重复', repeatMode: '每日', reminderEnabled: true, reminderHour: 9, reminderMinute: 0, reminderSecond: 0, currentInsight: '今天复习了TypeScript泛型。', isArchived: false, createdAt: daysAgo(30), updatedAt: daysAgo(0) },
  { id: uid(), title: '周报总结', taskType: '重复', repeatMode: '每周', weeklyDays: [5], reminderEnabled: true, reminderHour: 17, reminderMinute: 0, reminderSecond: 0, currentInsight: '', isArchived: false, createdAt: daysAgo(60), updatedAt: daysAgo(3) },
  { id: uid(), title: '阅读《深入理解计算机系统》', taskType: '一次性', reminderEnabled: false, currentInsight: '读到第3章，处理器架构。\n\n关键概念：流水线、分支预测。', isArchived: false, createdAt: daysAgo(20), updatedAt: daysAgo(2) },
  { id: uid(), title: '整理学习笔记', taskType: '重复', repeatMode: '每月', monthlyDays: [1, 15], reminderEnabled: true, reminderHour: 10, reminderMinute: 30, reminderSecond: 0, currentInsight: '上次整理了Notion中的编程笔记。', isArchived: false, createdAt: daysAgo(45), updatedAt: daysAgo(10) },
  { id: uid(), title: '准备技术分享PPT', taskType: '一次性', reminderEnabled: true, reminderYear: 2026, reminderMonth: 4, reminderDay: 15, reminderHour: 9, reminderMinute: 0, reminderSecond: 0, currentInsight: '', isArchived: false, createdAt: daysAgo(3), updatedAt: daysAgo(1) },
];

const archivedTodo: TodoTask = { id: uid(), title: '完成算法练习', taskType: '重复', repeatMode: '每日', reminderEnabled: false, currentInsight: '', isArchived: true, createdAt: daysAgo(90), updatedAt: daysAgo(30), completedAt: daysAgo(30) };

const archives: TodoArchiveRecord[] = [
  { id: uid(), taskId: archivedTodo.id, title: '完成算法练习', completedAt: daysAgo(31), insightSnapshot: '完成了两道动态规划题目。', taskSnapshotJson: JSON.stringify(archivedTodo), occurrenceIndex: 1 },
  { id: uid(), taskId: archivedTodo.id, title: '完成算法练习', completedAt: daysAgo(32), insightSnapshot: '做了三道二叉树相关题目。', taskSnapshotJson: JSON.stringify(archivedTodo), occurrenceIndex: 2 },
  { id: uid(), taskId: archivedTodo.id, title: '完成算法练习', completedAt: daysAgo(33), insightSnapshot: '复习了排序算法。', taskSnapshotJson: JSON.stringify(archivedTodo), occurrenceIndex: 3 },
  { id: uid(), taskId: todos[1].id, title: '每日代码复习', completedAt: daysAgo(1), insightSnapshot: '复习了Promise和async/await。', taskSnapshotJson: JSON.stringify(todos[1]), occurrenceIndex: 1 },
  { id: uid(), taskId: todos[1].id, title: '每日代码复习', completedAt: daysAgo(2), insightSnapshot: '复习了闭包和作用域。', taskSnapshotJson: JSON.stringify(todos[1]), occurrenceIndex: 2 },
];

const powerEvents: PowerEventRecord[] = [
  { id: uid(), eventType: '开机', occurredAt: h(7, 55), detail: '系统启动', markerColor: '#22c55e' },
  { id: uid(), eventType: '解锁', occurredAt: h(7, 56), detail: '用户登录', markerColor: '#3b82f6' },
  { id: uid(), eventType: '锁定', occurredAt: h(12, 0), detail: '用户锁定', markerColor: '#f59e0b' },
  { id: uid(), eventType: '解锁', occurredAt: h(13, 0), detail: '用户解锁', markerColor: '#3b82f6' },
  { id: uid(), eventType: '挂起', occurredAt: h(18, 30), detail: '系统挂起', markerColor: '#a855f7' },
  { id: uid(), eventType: '恢复', occurredAt: h(19, 0), detail: '系统恢复', markerColor: '#06b6d4' },
  // Past days
  { id: uid(), eventType: '开机', occurredAt: new Date(today.getTime() - 86400000 + 8 * 3600000).toISOString(), detail: '系统启动', markerColor: '#22c55e' },
  { id: uid(), eventType: '关机', occurredAt: new Date(today.getTime() - 86400000 + 23 * 3600000).toISOString(), detail: '系统关机', markerColor: '#ef4444' },
];

export function createInitialState(): AppState {
  return {
    profiles,
    sessions: generateSessions(),
    subjects,
    queue,
    pomodoroSettings,
    todos: [...todos, archivedTodo],
    archives,
    powerEvents,
    currentFocusedWindow: profiles[0], // VS Code
    displayMode: '显示性质',
  };
}
