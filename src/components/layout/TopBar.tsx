import { useAppState } from '@/store/AppContext';
import { getCategoryColor } from '@/lib/categories';
import { useEffect, useState } from 'react';

interface TopBarProps {
  pageTitle: string;
}

export function TopBar({ pageTitle }: TopBarProps) {
  const { state } = useAppState();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const focusedWindow = state.currentFocusedWindow;
  const categoryColor = focusedWindow ? getCategoryColor(focusedWindow.category) : '#6b7280';

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-foreground">{pageTitle}</h1>
        {focusedWindow && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: categoryColor }} />
            <span className="max-w-[240px] truncate">{focusedWindow.displayName}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {time.toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      </div>
    </header>
  );
}
