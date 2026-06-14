import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, Copy, FileQuestion, History, Image as ImageIcon, Info, Pipette, Type as TypeIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

interface ColorInfo {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

interface MagnifierState {
  active: boolean;
  displayX: number;
  displayY: number;
  imageX: number;
  imageY: number;
}

function formatTime(value?: string) {
  if (!value) {
    return '-';
  }
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return '-';
  }
  return new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '-';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function countTextCharacters(text: string) {
  return Array.from(text).length;
}

function countTextWithoutPunctuation(text: string) {
  return Array.from(text.replace(/[\p{P}\s]/gu, '')).length;
}

function toHexByte(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case nr:
        h = (ng - nb) / delta + (ng < nb ? 6 : 0);
        break;
      case ng:
        h = (nb - nr) / delta + 2;
        break;
      default:
        h = (nr - ng) / delta + 4;
        break;
    }
    h /= 6;
  }

  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function getColorFormats(color: ColorInfo | null) {
  if (!color) {
    return [];
  }
  const alpha255 = Math.round(color.a * 255);
  const hex = `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
  const hexA = `${hex}${toHexByte(alpha255)}`;
  return [
    { label: 'RGB', value: `rgb(${color.r}, ${color.g}, ${color.b})` },
    { label: 'RGBA', value: `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})` },
    { label: 'HEX', value: hex },
    { label: 'HEX8', value: hexA },
    { label: '0xRRGGBBAA', value: `0x${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}${toHexByte(alpha255)}` },
    { label: 'HSL', value: rgbToHsl(color.r, color.g, color.b) },
  ];
}

async function copyPlainText(text: string) {
  if (window.desktopApi?.writeClipboardItem) {
    const result = await window.desktopApi.writeClipboardItem({ kind: 'text', text });
    if (!result.ok) {
      throw new Error(result.detail || result.error || '写入失败');
    }
    return;
  }
  await navigator.clipboard.writeText(text);
}

function getSnapshotSummary(snapshot: ClipboardSnapshot) {
  if (snapshot.kind === 'text') {
    return snapshot.text?.slice(0, 120).replace(/\s+/g, ' ') || '空文本';
  }
  if (snapshot.kind === 'image') {
    return `${snapshot.image?.width || 0} × ${snapshot.image?.height || 0} ${snapshot.image?.type?.toUpperCase() || 'IMAGE'}`;
  }
  return snapshot.formats?.join(' / ') || '未知剪贴板内容';
}

export default function ClipboardPage() {
  const [current, setCurrent] = useState<ClipboardSnapshot | null>(null);
  const [history, setHistory] = useState<ClipboardSnapshot[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [color, setColor] = useState<ColorInfo | null>(null);
  const [magnifier, setMagnifier] = useState<MagnifierState>({ active: false, displayX: 0, displayY: 0, imageX: 0, imageY: 0 });
  const [zoom, setZoom] = useState(8);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierActiveRef = useRef(false);

  const isElectron = Boolean(window.desktopApi?.isElectron);

  const refreshClipboard = async () => {
    if (!window.desktopApi?.getClipboardCurrent) {
      return;
    }
    try {
      const [nextCurrent, nextHistory] = await Promise.all([
        window.desktopApi.getClipboardCurrent(),
        window.desktopApi.getClipboardHistory?.() ?? Promise.resolve([]),
      ]);
      setCurrent(nextCurrent);
      setHistory(nextHistory);
    } catch (error) {
      toast.error('读取剪贴板失败', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    void refreshClipboard();
    const unsubscribe = window.desktopApi?.onClipboardChanged?.(payload => {
      if (payload.current) {
        setCurrent(payload.current);
      }
      if (Array.isArray(payload.history)) {
        setHistory(payload.history);
      }
    });
    const timer = window.setInterval(() => {
      void refreshClipboard();
    }, 1200);
    return () => {
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (current?.kind === 'text') {
      setTextDraft(current.text || '');
    }
    if (current?.kind !== 'image') {
      setColor(null);
      setMagnifier({ active: false, displayX: 0, displayY: 0, imageX: 0, imageY: 0 });
    }
  }, [current?.id, current?.kind, current?.text]);

  useEffect(() => {
    magnifierActiveRef.current = magnifier.active;
  }, [magnifier.active]);

  useEffect(() => {
    const viewport = imageViewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!magnifierActiveRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setZoom(prev => Math.max(2, Math.min(32, prev + (event.deltaY < 0 ? 1 : -1))));
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => {
      viewport.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [current?.id]);

  const textStats = useMemo(() => {
    const text = current?.kind === 'text' ? current.text || '' : '';
    return {
      total: countTextCharacters(text),
      noPunctuation: countTextWithoutPunctuation(text),
    };
  }, [current]);

  const colorFormats = useMemo(() => getColorFormats(color), [color]);

  const drawImageToCanvas = () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !current?.image) {
      return;
    }
    canvas.width = current.image.width;
    canvas.height = current.image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  };

  const readImageColorAtPointer = (event: React.PointerEvent<HTMLImageElement> | React.MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !current?.image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const displayX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const displayY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const imageX = Math.max(0, Math.min(current.image.width - 1, Math.floor((displayX / rect.width) * current.image.width)));
    const imageY = Math.max(0, Math.min(current.image.height - 1, Math.floor((displayY / rect.height) * current.image.height)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return;
    }
    const pixel = context.getImageData(imageX, imageY, 1, 1).data;
    setColor({
      x: imageX,
      y: imageY,
      r: pixel[0],
      g: pixel[1],
      b: pixel[2],
      a: Number((pixel[3] / 255).toFixed(3)),
    });
    setMagnifier({ active: true, displayX, displayY, imageX, imageY });
  };

  const handleImagePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    readImageColorAtPointer(event);
  };

  const handleImagePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!magnifier.active) {
      return;
    }
    readImageColorAtPointer(event);
  };

  const handleImagePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    readImageColorAtPointer(event);
    setMagnifier(prev => ({ ...prev, active: false }));
  };

  const copyCurrentText = async () => {
    setLoading(true);
    try {
      await copyPlainText(textDraft);
      toast.success('已复制修改后的文本');
      await refreshClipboard();
    } catch (error) {
      toast.error('复制失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  const copyColorValue = async (value: string) => {
    try {
      await copyPlainText(value);
      toast.success('颜色值已复制');
    } catch (error) {
      toast.error('复制失败', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const restoreHistoryItem = async (item: ClipboardSnapshot) => {
    if (!window.desktopApi?.writeClipboardItem) {
      toast.error('当前环境不支持写入剪贴板');
      return;
    }
    if (window.desktopApi.restoreClipboardHistoryItem) {
      const result = await window.desktopApi.restoreClipboardHistoryItem({ id: item.id });
      if (result.ok) {
        toast.success('已复制该历史项');
        await refreshClipboard();
        return;
      }
      toast.error('复制历史项失败', { description: result.detail || result.error });
      return;
    }
    const payload =
      item.kind === 'text'
        ? { kind: 'text' as const, text: item.text || '' }
        : item.kind === 'image'
          ? { kind: 'image' as const, dataUrl: item.image?.dataUrl || '' }
          : null;
    if (!payload) {
      toast.warning('该类型暂不支持重新复制');
      return;
    }
    const result = await window.desktopApi.writeClipboardItem(payload);
    if (result.ok) {
      toast.success('已复制该历史项');
      await refreshClipboard();
      return;
    }
    toast.error('复制历史项失败', { description: result.detail || result.error });
  };

  const renderCurrentContent = () => {
    if (!isElectron) {
      return (
        <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
          剪贴板读取需要在 Electron 桌面版中使用。
        </Card>
      );
    }

    if (!current) {
      return (
        <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
          正在读取剪贴板...
        </Card>
      );
    }

    if (current.kind === 'text') {
      return (
        <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
          <div className="grid grid-cols-2 xl:grid-cols-1 gap-3">
            <Card className="border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">文本总字数</p>
              <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">{textStats.total.toLocaleString('zh-CN')}</p>
            </Card>
            <Card className="border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">不含标点字数</p>
              <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">{textStats.noPunctuation.toLocaleString('zh-CN')}</p>
            </Card>
          </div>
          <Card className="border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">复制的文本内容</h3>
                <p className="mt-1 text-xs text-muted-foreground">可以直接修改，下方按钮会把修改后的文本重新写入剪贴板。</p>
              </div>
              <Button type="button" size="sm" onClick={copyCurrentText} disabled={loading}>
                <Copy className="mr-2 h-4 w-4" />
                复制修改内容
              </Button>
            </div>
            <Textarea
              value={textDraft}
              onChange={event => setTextDraft(event.target.value)}
              className="min-h-[420px] resize-y text-sm leading-6"
              placeholder="剪贴板文本为空"
            />
          </Card>
        </div>
      );
    }

    if (current.kind === 'image' && current.image) {
      const magnifierSize = 180;
      const magnifierLeft = magnifier.displayX + magnifierSize + 24 > (imageRef.current?.clientWidth || 0)
        ? Math.max(0, magnifier.displayX - magnifierSize - 18)
        : magnifier.displayX + 18;
      const magnifierTop = magnifier.displayY + magnifierSize + 24 > (imageRef.current?.clientHeight || 0)
        ? Math.max(0, magnifier.displayY - magnifierSize - 18)
        : magnifier.displayY + 18;
      const backgroundSize = imageRef.current
        ? `${imageRef.current.clientWidth * zoom}px ${imageRef.current.clientHeight * zoom}px`
        : `${current.image.width * zoom}px ${current.image.height * zoom}px`;
      const backgroundPosition = imageRef.current
        ? `${-(magnifier.displayX * zoom - magnifierSize / 2)}px ${-(magnifier.displayY * zoom - magnifierSize / 2)}px`
        : 'center';

      return (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
          <div className="space-y-4">
            <Card className="border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">图片信息</h3>
              </div>
              <div className="space-y-2 text-xs">
                <InfoRow label="尺寸" value={`${current.image.width} × ${current.image.height}`} />
                <InfoRow label="类型" value={current.image.type.toUpperCase()} />
                <InfoRow label="估算大小" value={formatBytes(current.image.byteLength)} />
                <InfoRow label="复制时间" value={formatTime(current.capturedAt)} />
                <InfoRow label="剪贴板格式" value={(current.formats || []).join(' / ') || '-'} />
              </div>
            </Card>
            <Card className="border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Pipette className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">取色结果</h3>
              </div>
              {color ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-xl border border-border"
                      style={{ backgroundColor: `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})` }}
                    />
                    <div className="text-xs text-muted-foreground">
                      <div>位置：x {color.x}, y {color.y}</div>
                      <div>长按图片取色，滚轮调整放大倍率：{zoom}x</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {colorFormats.map(item => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => void copyColorValue(item.value)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-left text-xs hover:border-primary/70 hover:bg-primary/10"
                      >
                        <span className="w-20 shrink-0 text-muted-foreground">{item.label}</span>
                        <span className="min-w-0 flex-1 break-all font-mono text-foreground">{item.value}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">在图片上长按任意位置读取颜色。</p>
              )}
            </Card>
          </div>
          <Card className="border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">复制的图片</h3>
                <p className="mt-1 text-xs text-muted-foreground">长按图片取色；按住时移动鼠标持续读取颜色，滚轮调整放大倍率。</p>
              </div>
              <Badge variant="secondary">{zoom}x</Badge>
            </div>
            <div
              ref={imageViewportRef}
              className="relative max-h-[620px] overscroll-contain overflow-auto rounded-2xl border border-border bg-secondary/30 p-3"
            >
              <img
                ref={imageRef}
                src={current.image.dataUrl}
                alt="剪贴板图片"
                draggable={false}
                onLoad={drawImageToCanvas}
                onPointerDown={handleImagePointerDown}
                onPointerMove={handleImagePointerMove}
                onPointerUp={handleImagePointerUp}
                onPointerCancel={() => setMagnifier(prev => ({ ...prev, active: false }))}
                className="mx-auto max-h-[560px] max-w-full select-none rounded-xl object-contain"
              />
              {magnifier.active && (
                <div
                  className="pointer-events-none absolute z-20 overflow-hidden rounded-2xl border-2 border-primary bg-card shadow-2xl"
                  style={{
                    width: magnifierSize,
                    height: magnifierSize,
                    left: magnifierLeft,
                    top: magnifierTop,
                    backgroundImage: `url(${current.image.dataUrl})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize,
                    backgroundPosition,
                  }}
                >
                  <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary" />
                  <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-primary" />
                  <div className="absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-[11px] text-foreground">
                    {magnifier.imageX}, {magnifier.imageY}
                  </div>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </Card>
        </div>
      );
    }

    return (
      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <FileQuestion className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">其他剪贴板内容</h3>
        </div>
        <div className="space-y-2 text-xs">
          <InfoRow label="复制时间" value={formatTime(current.capturedAt)} />
          <InfoRow label="类型" value="非文本 / 非图片" />
          <InfoRow label="剪贴板格式" value={(current.formats || []).join(' / ') || '-'} />
        </div>
      </Card>
    );
  };

  return (
    <DashboardLayout pageTitle="剪贴板">
      <div className="space-y-4">
        <Tabs defaultValue="info" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="info">
              <Info className="mr-2 h-4 w-4" />
              信息显示
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="mr-2 h-4 w-4" />
              剪贴板
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">当前剪贴板信息</h2>
                <p className="text-xs text-muted-foreground">页面会自动刷新当前系统剪贴板；图片取色只在本地 canvas 中完成。</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshClipboard()}>
                刷新
              </Button>
            </div>
            {renderCurrentContent()}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card className="border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">剪贴板历史</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这里显示 KewuToolbox 运行期间监听到的剪贴板历史；Windows 系统 Win+V 历史不提供稳定的桌面 API 直接读取。
                  </p>
                </div>
                <Badge variant="secondary">{history.length} 条</Badge>
              </div>
              <div className="space-y-2">
                {history.length > 0 ? (
                  history.map(item => {
                    const previewDataUrl = item.kind === 'image'
                      ? item.image?.thumbnailDataUrl || item.image?.dataUrl || ''
                      : '';
                    return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void restoreHistoryItem(item)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-border bg-secondary/30 p-3 text-left transition-colors hover:border-primary/70 hover:bg-primary/10"
                    >
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-card">
                        {item.kind === 'image' && previewDataUrl ? (
                          <img src={previewDataUrl} alt="" className="h-full w-full object-cover" />
                        ) : item.kind === 'text' ? (
                          <TypeIcon className="h-5 w-5 text-primary" />
                        ) : (
                          <Clipboard className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0">
                            {item.kind === 'text' ? '文本' : item.kind === 'image' ? '图片' : '其他'}
                          </Badge>
                          <span className="truncate text-sm font-medium text-foreground">{getSnapshotSummary(item)}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatTime(item.capturedAt)}</div>
                      </div>
                      <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    暂无剪贴板历史。复制文本或图片后会在这里出现。
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 rounded-xl bg-secondary/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-foreground">{value}</span>
    </div>
  );
}
