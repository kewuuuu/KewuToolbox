import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppProvider } from '@/store/AppContext';
import PomodoroPage from './pages/PomodoroPage';
import FocusSubjectsPage from './pages/FocusSubjectsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TodoListPage from './pages/TodoListPage';
import TodoDetailPage from './pages/TodoDetailPage';
import ArchiveListPage from './pages/ArchiveListPage';
import ArchiveDetailPage from './pages/ArchiveDetailPage';
import MonitoringPage from './pages/MonitoringPage';
import SettingsPage from './pages/SettingsPage';
import ClockPage from './pages/ClockPage';
import StopwatchRecordDetailPage from './pages/StopwatchRecordDetailPage';
import CalculatorPage from './pages/CalculatorPage';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/focus" replace />} />
            <Route path="/focus" element={<Navigate to="/pomodoro" replace />} />
            <Route path="/pomodoro" element={<PomodoroPage />} />
            <Route path="/focus-subjects" element={<FocusSubjectsPage />} />
            <Route path="/clock" element={<ClockPage />} />
            <Route path="/clock/records/:recordId" element={<StopwatchRecordDetailPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/todos" element={<TodoListPage />} />
            <Route path="/todos/:id" element={<TodoDetailPage />} />
            <Route path="/archives" element={<ArchiveListPage />} />
            <Route path="/archives/:taskId" element={<ArchiveDetailPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
