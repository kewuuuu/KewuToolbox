import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { useState, useEffect } from 'react';
import { Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface TopBarProps {
  pageTitle: string;
}

export function TopBar({ pageTitle }: TopBarProps) {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fw = state.currentFocusedWindow;
  const catColor = fw ? getCategoryColor(fw.category) : '#6b7280';

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
        {fw && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: catColor }} />
            <span className="max-w-[200px] truncate">{fw.displayName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: catColor + '22', color: catColor }}>
              {fw.category}
            </span>
          </div>
        )}
        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary">
          {state.displayMode}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate('/pomodoro')}>
          <Play className="w-3 h-3" /> 开始专注
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate('/todos')}>
          <Plus className="w-3 h-3" /> 新建待办
        </Button>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {time.toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
