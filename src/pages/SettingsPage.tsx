import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { getSoundDisplayNameFromPath, playSoundById } from '@/lib/sound';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { FolderOpen, MoonStar, Play, Plus, Sun, Trash2 } from 'lucide-react';

type SettingsTab = 'general' | 'sounds';

function toFinite(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export default function SettingsPage() {
  const { state, updatePreferences, clearAllData, addSoundFile, updateSoundFile, deleteSoundFile } = useAppState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manualPath, setManualPath] = useState('');
  const [manualName, setManualName] = useState('');
  const [isClearingAllData, setIsClearingAllData] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(
    String(state.preferences.recordWindowThresholdSeconds),
  );
  const browserFilePickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setThresholdInput(String(state.preferences.recordWindowThresholdSeconds));
  }, [state.preferences.recordWindowThresholdSeconds]);

  const tabParam = searchParams.get('tab');
  const tab: SettingsTab = tabParam === 'sounds' ? 'sounds' : 'general';

  const sortedSoundFiles = useMemo(
    () =>
      [...state.soundFiles].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [state.soundFiles],
  );

  const handleTabChange = (nextTab: string) => {
    const normalized: SettingsTab = nextTab === 'sounds' ? 'sounds' : 'general';
    if (normalized === 'general') {
      setSearchParams({});
      return;
    }
    setSearchParams({ tab: normalized });
  };

  const commitThresholdInput = (rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setThresholdInput(String(state.preferences.recordWindowThresholdSeconds));
      toast.error('记录阈值必须是数字');
      return;
    }

    const normalized = Math.max(0, Math.floor(parsed));
    updatePreferences({ recordWindowThresholdSeconds: normalized });
    setThresholdInput(String(normalized));
  };

  const handleThresholdKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitThresholdInput(thresholdInput);
    }
  };

  const handleClearAllData = async () => {
    if (isClearingAllData) {
      return;
    }

    setIsClearingAllData(true);
    try {
      await clearAllData();
      toast.success('已清除所有数据');
    } catch {
      toast.error('清除失败，请重试');
    } finally {
      setIsClearingAllData(false);
    }
  };

  const handlePickAudioFile = async () => {
    if (!window.desktopApi?.isElectron) {
      toast.info('浏览器环境请手动输入路径或 URL');
      return;
    }
    const pickedPath = await window.desktopApi.selectAudioFile();
    if (!pickedPath) {
      return;
    }
    const defaultName = getSoundDisplayNameFromPath(pickedPath);
    const added = addSoundFile(defaultName, pickedPath, 1);
    if (added) {
      toast.success('已添加提示音文件');
    }
  };

  const handleManualAdd = () => {
    const filePath = manualPath.trim();
    if (!filePath) {
      toast.error('请输入提示音路径');
      return;
    }
    const name = manualName.trim() || getSoundDisplayNameFromPath(filePath);
    const added = addSoundFile(name, filePath, 1);
    if (!added) {
      toast.error('添加失败，请检查路径');
      return;
    }
    setManualPath('');
    setManualName('');
    toast.success('已添加提示音文件');
  };

  const handlePickPathForManualInput = async () => {
    if (!window.desktopApi?.isElectron) {
      browserFilePickerRef.current?.click();
      return;
    }
    const pickedPath = await window.desktopApi.selectAudioFile();
    if (!pickedPath) {
      return;
    }
    setManualPath(pickedPath);
    if (!manualName.trim()) {
      setManualName(getSoundDisplayNameFromPath(pickedPath));
    }
  };

  const handleBrowserFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        toast.error('读取文件失败');
        return;
      }
      setManualPath(dataUrl);
      if (!manualName.trim()) {
        setManualName(getSoundDisplayNameFromPath(file.name));
      }
      toast.info('已加载文件内容，可直接保存');
    };
    reader.onerror = () => {
      toast.error('读取文件失败');
    };
    reader.readAsDataURL(file);
  };

  const handlePreview = async (soundId: string) => {
    try {
      await playSoundById(state.soundFiles, {
        enabled: true,
        soundFileId: soundId,
        eventVolumeMultiplier: 1,
      });
    } catch {
      toast.error('试听失败，请检查音频文件');
    }
  };

  return (
    <DashboardLayout pageTitle="设置">
      <div className="max-w-5xl mx-auto">
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="general">通用配置</TabsTrigger>
            <TabsTrigger value="sounds">提示音管理</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">记录与界面</h3>
                <p className="text-xs text-muted-foreground">
                  只记录总可见时长达到阈值的窗口，主题会立即生效。
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">记录阈值（秒）</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={thresholdInput}
                    onChange={event => setThresholdInput(event.target.value)}
                    onBlur={() => commitThresholdInput(thresholdInput)}
                    onKeyDown={handleThresholdKeyDown}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">界面主题</label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={state.preferences.uiTheme === 'dark' ? 'default' : 'outline'}
                      className="gap-1.5"
                      onClick={() => updatePreferences({ uiTheme: 'dark' })}
                    >
                      <MoonStar className="w-4 h-4" />
                      暗色
                    </Button>
                    <Button
                      type="button"
                      variant={state.preferences.uiTheme === 'light' ? 'default' : 'outline'}
                      className="gap-1.5"
                      onClick={() => updatePreferences({ uiTheme: 'light' })}
                    >
                      <Sun className="w-4 h-4" />
                      亮色
                    </Button>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-border/70 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">危险操作</p>
                  <p className="text-xs text-muted-foreground">清空全部记录、专注计划、代办与设置，此操作不可撤销。</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="gap-1.5" disabled={isClearingAllData}>
                      <Trash2 className="w-4 h-4" />
                      清除所有数据
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认清除所有数据</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作会删除所有本地数据，且无法恢复。请再次确认是否继续。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={isClearingAllData}
                        onClick={() => void handleClearAllData()}
                      >
                        {isClearingAllData ? '清除中...' : '确认清除'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="sounds">
            <Card className="p-4 bg-card border-border space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">提示音文件列表</h3>
                <Button size="sm" onClick={() => void handlePickAudioFile()} className="gap-1">
                  <Plus className="w-3.5 h-3.5" />
                  添加文件
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground">路径或 URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      value={manualPath}
                      onChange={event => setManualPath(event.target.value)}
                      placeholder="例如 D:\\sounds\\alarm.wav"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 shrink-0"
                      onClick={() => void handlePickPathForManualInput()}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      选择
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">名称（可选）</label>
                  <Input
                    value={manualName}
                    onChange={event => setManualName(event.target.value)}
                    placeholder="不填则自动取文件名"
                    className="h-8 mt-1"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={handleManualAdd}>
                  保存
                </Button>
              </div>

              <input
                ref={browserFilePickerRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/*"
                className="hidden"
                onChange={event => handleBrowserFilePicked(event)}
              />

              <div className="space-y-2">
                {sortedSoundFiles.map(sound => (
                  <div
                    key={sound.id}
                    className="grid grid-cols-1 md:grid-cols-[220px_1fr_120px_auto_auto] gap-2 items-center p-2 rounded-lg border border-border hover:bg-secondary/20"
                    onClick={() => void handlePreview(sound.id)}
                  >
                    <Input
                      value={sound.name}
                      className="h-8"
                      onClick={event => event.stopPropagation()}
                      onChange={event => updateSoundFile({ ...sound, name: event.target.value })}
                    />
                    <Input
                      value={sound.filePath}
                      className="h-8 font-mono text-[11px]"
                      onClick={event => event.stopPropagation()}
                      onChange={event => updateSoundFile({ ...sound, filePath: event.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.1"
                      value={sound.defaultVolumeMultiplier}
                      className="h-8"
                      onClick={event => event.stopPropagation()}
                      onChange={event =>
                        updateSoundFile({
                          ...sound,
                          defaultVolumeMultiplier: toFinite(event.target.value, 1),
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={event => {
                        event.stopPropagation();
                        void handlePreview(sound.id);
                      }}
                    >
                      <Play className="w-3.5 h-3.5" />
                      试听
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={event => {
                        event.stopPropagation();
                        deleteSoundFile(sound.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {sortedSoundFiles.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">暂无提示音文件</p>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
