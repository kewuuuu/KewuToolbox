import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/store/AppContext";
import PomodoroPage from "./pages/PomodoroPage";
import FocusSubjectsPage from "./pages/FocusSubjectsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TodoListPage from "./pages/TodoListPage";
import TodoDetailPage from "./pages/TodoDetailPage";
import ArchiveListPage from "./pages/ArchiveListPage";
import ArchiveDetailPage from "./pages/ArchiveDetailPage";
import MonitoringPage from "./pages/MonitoringPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/pomodoro" replace />} />
            <Route path="/pomodoro" element={<PomodoroPage />} />
            <Route path="/focus-subjects" element={<FocusSubjectsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/todos" element={<TodoListPage />} />
            <Route path="/todos/:id" element={<TodoDetailPage />} />
            <Route path="/archives" element={<ArchiveListPage />} />
            <Route path="/archives/:taskId" element={<ArchiveDetailPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
