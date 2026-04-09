import { NavLink } from 'react-router-dom';
import { Timer, Target, BarChart3, ListTodo, Archive, Monitor } from 'lucide-react';

const navItems = [
  { to: '/pomodoro', icon: Timer, label: '番茄钟' },
  { to: '/focus-subjects', icon: Target, label: '专注事项' },
  { to: '/analytics', icon: BarChart3, label: '数据统计' },
  { to: '/todos', icon: ListTodo, label: '待办列表' },
  { to: '/archives', icon: Archive, label: '归档列表' },
  { to: '/monitoring', icon: Monitor, label: '原始监控' },
];

export function AppSidebar() {
  return (
    <aside className="w-52 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
      <div className="h-12 flex items-center px-4 border-b border-sidebar-border">
        <span className="text-sm font-bold text-sidebar-primary">⚡ 个人效率助手</span>
      </div>
      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground">v1.0 原型</p>
      </div>
    </aside>
  );
}
