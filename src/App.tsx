import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppProvider } from '@/store/AppContext';

const PomodoroPage = lazy(() => import('./pages/PomodoroPage'));
const FocusSubjectsPage = lazy(() => import('./pages/FocusSubjectsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const TodoListPage = lazy(() => import('./pages/TodoListPage'));
const TodoDetailPage = lazy(() => import('./pages/TodoDetailPage'));
const ArchiveListPage = lazy(() => import('./pages/ArchiveListPage'));
const ArchiveDetailPage = lazy(() => import('./pages/ArchiveDetailPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClockPage = lazy(() => import('./pages/ClockPage'));
const StopwatchRecordDetailPage = lazy(() => import('./pages/StopwatchRecordDetailPage'));
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'));
const ClipboardPage = lazy(() => import('./pages/ClipboardPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen bg-background text-foreground flex items-center justify-center text-sm text-muted-foreground">
    正在加载...
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <HashRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/focus" replace />} />
              <Route path="/focus" element={<Navigate to="/pomodoro" replace />} />
              <Route path="/pomodoro" element={<PomodoroPage />} />
              <Route path="/focus-subjects" element={<FocusSubjectsPage />} />
              <Route path="/clock" element={<ClockPage />} />
              <Route path="/clock/records/:recordId" element={<StopwatchRecordDetailPage />} />
              <Route path="/calculator" element={<CalculatorPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/input-activity" element={<Navigate to="/analytics" replace />} />
              <Route path="/todos" element={<TodoListPage />} />
              <Route path="/todos/:id" element={<TodoDetailPage />} />
              <Route path="/archives" element={<ArchiveListPage />} />
              <Route path="/archives/:taskId" element={<ArchiveDetailPage />} />
              <Route path="/monitoring" element={<MonitoringPage />} />
              <Route path="/clipboard" element={<ClipboardPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
