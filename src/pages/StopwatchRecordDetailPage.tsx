import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppState } from '@/store/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowLeft, Copy } from 'lucide-react';
import { toast } from 'sonner';

function pad(num: number, width = 2) {
  return Math.max(0, Math.floor(num)).toString().padStart(width, '0');
}

function formatElapsedMs(ms: number) {
  const clamped = Math.max(0, Math.floor(ms));
  const centiseconds = Math.floor((clamped % 1000) / 10);
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

type StopwatchRecordLike = {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  totalElapsedMs: number;
  laps: Array<{ id: string; elapsedMs: number; splitMs: number; note: string }>;
};

function normalizeNote(note: string) {
  return note.trim();
}

function buildPlainText(record: StopwatchRecordLike) {
  const headerLines = [
    `记录名称：${record.name}`,
    `开始时间：${formatDateTime(record.startedAt)}`,
    `结束时间：${formatDateTime(record.endedAt)}`,
    `总时长：${formatElapsedMs(record.totalElapsedMs)}`,
    '',
    '断点列表：',
  ];

  if (record.laps.length === 0) {
    return [...headerLines, '（无断点）'].join('\n');
  }

  const lapLines = record.laps.map((lap, index) => {
    const note = normalizeNote(lap.note);
    return `#${index + 1}  断点时刻：${formatElapsedMs(lap.elapsedMs)}  相对上一条：+${formatElapsedMs(lap.splitMs)}  备注：${note}`;
  });
  return [...headerLines, ...lapLines].join('\n');
}

function buildMarkdownTable(record: StopwatchRecordLike) {
  const metadata = [
    `**记录名称**：${record.name}`,
    `**开始时间**：${formatDateTime(record.startedAt)}`,
    `**结束时间**：${formatDateTime(record.endedAt)}`,
    `**总时长**：${formatElapsedMs(record.totalElapsedMs)}`,
    '',
  ];

  const tableHeader = [
    '| 序号 | 断点时刻 | 相对上一条增加 | 备注 |',
    '| --- | --- | --- | --- |',
  ];

  const rows =
    record.laps.length > 0
      ? record.laps.map((lap, index) => `| ${index + 1} | ${formatElapsedMs(lap.elapsedMs)} | +${formatElapsedMs(lap.splitMs)} | ${escapeMarkdownCell(normalizeNote(lap.note))} |`)
      : ['| - | - | - |  |'];

  return [...metadata, ...tableHeader, ...rows].join('\n');
}

function buildTabbedTable(record: StopwatchRecordLike) {
  const lines = [
    '记录名称\t开始时间\t结束时间\t总时长',
    `${record.name}\t${formatDateTime(record.startedAt)}\t${formatDateTime(record.endedAt)}\t${formatElapsedMs(record.totalElapsedMs)}`,
    '断点时刻\t相对上一条\t备注',
  ];

  for (const lap of record.laps) {
    lines.push(`${formatElapsedMs(lap.elapsedMs)}\t+${formatElapsedMs(lap.splitMs)}\t${normalizeNote(lap.note)}`);
  }

  return lines.join('\n');
}
export default function StopwatchRecordDetailPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const { state, setStopwatchRecords } = useAppState();

  const record = useMemo(
    () => state.stopwatchRecords.find(item => item.id === recordId),
    [recordId, state.stopwatchRecords],
  );

  if (!record) {
    return (
      <DashboardLayout pageTitle="秒表记录详情">
        <div className="max-w-4xl mx-auto">
          <Card className="p-6 bg-card border-border text-center space-y-3">
            <p className="text-sm text-muted-foreground">记录不存在或已被删除。</p>
            <Button variant="outline" onClick={() => navigate('/clock?tab=records')}>返回秒表记录</Button>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const updateRecord = (patch: Partial<typeof record>) => {
    const now = new Date().toISOString();
    setStopwatchRecords(
      state.stopwatchRecords.map(item =>
        item.id === record.id
          ? { ...item, ...patch, updatedAt: now }
          : item,
      ),
    );
  };

  const copyText = async (text: string, successText: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast.success(successText);
    } catch {
      toast.error('复制失败，请检查剪贴板权限');
    }
  };

  return (
    <DashboardLayout pageTitle="秒表记录详情">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('/clock?tab=records')}>
            <ArrowLeft className="w-4 h-4" />
            返回秒表记录
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Copy className="w-4 h-4" />
                复制
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => void copyText(buildPlainText(record), '已复制纯文本')}>
                复制纯文本
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copyText(buildMarkdownTable(record), '已复制 Markdown 格式')}>
                复制 Markdown 格式
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copyText(buildTabbedTable(record), '已复制表格格式')}>
                复制表格格式（制表符）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Card className="p-4 bg-card border-border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">记录名称</label>
              <Input
                value={record.name}
                onChange={event => updateRecord({ name: event.target.value })}
                className="h-8 mt-1"
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>开始时间：{formatDateTime(record.startedAt)}</p>
              <p>结束时间：{formatDateTime(record.endedAt)}</p>
              <p>总时长：<span className="font-mono text-foreground">{formatElapsedMs(record.totalElapsedMs)}</span></p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-card border-border space-y-2">
          <h3 className="text-sm font-semibold text-foreground">断点列表</h3>
          {record.laps.length === 0 ? (
            <p className="text-xs text-muted-foreground">该记录没有断点。</p>
          ) : (
            record.laps.map((lap, index) => (
              <div key={lap.id} className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1.8fr] gap-2 items-center p-2 rounded-lg border border-border/70">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                <span className="text-sm font-mono text-foreground">{formatElapsedMs(lap.elapsedMs)}</span>
                <span className="text-sm font-mono text-muted-foreground">+{formatElapsedMs(lap.splitMs)}</span>
                <Input
                  value={lap.note}
                  onChange={event =>
                    updateRecord({
                      laps: record.laps.map(item =>
                        item.id === lap.id
                          ? { ...item, note: event.target.value }
                          : item,
                      ),
                    })
                  }
                  placeholder="备注"
                  className="h-8"
                />
              </div>
            ))
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
