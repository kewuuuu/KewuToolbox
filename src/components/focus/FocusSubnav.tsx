import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type FocusTab = 'pomodoro' | 'subjects';

function getCurrentTab(pathname: string): FocusTab {
  if (pathname.startsWith('/focus-subjects')) {
    return 'subjects';
  }
  return 'pomodoro';
}

export function FocusSubnav() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = getCurrentTab(location.pathname);

  const handleChange = (value: string) => {
    if (value === 'subjects') {
      navigate('/focus-subjects');
      return;
    }
    navigate('/pomodoro');
  };

  return (
    <Tabs value={currentTab} onValueChange={handleChange}>
      <TabsList className="bg-secondary">
        <TabsTrigger value="pomodoro">番茄钟</TabsTrigger>
        <TabsTrigger value="subjects">专注事项</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
