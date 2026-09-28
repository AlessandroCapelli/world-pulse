export interface CaptureInfo {
  metric: string;
  value: string;
  caption: string;
  trace: string;
  url: string;
  date: string;
  color: string;
}

/** Draws the globe frame plus a titled HUD overlay into a PNG blob (all local, no network). */
export async function composeScreenshot(base: HTMLCanvasElement, info: CaptureInfo): Promise<Blob> {
  await document.fonts?.ready;
  const w = base.width;
  const h = base.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(base, 0, 0);

  const s = Math.max(1, Math.min(w, h) / 900);
  const pad = 36 * s;

  // Bottom gradient for legibility.
  const grad = ctx.createLinearGradient(0, h * 0.62, 0, h);
  grad.addColorStop(0, 'rgba(1,4,9,0)');
  grad.addColorStop(1, 'rgba(1,4,9,0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // Brand.
  ctx.fillStyle = '#e2f9ff';
  ctx.font = `600 ${16 * s}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  drawTracked(ctx, 'WORLD PULSE', pad, pad, 4 * s);

  // Metric + value.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = info.color;
  ctx.font = `600 ${22 * s}px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillText(info.metric, pad, h - pad - 118 * s);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = info.color;
  ctx.shadowBlur = 24 * s;
  ctx.font = `500 ${64 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(info.value, pad, h - pad - 46 * s);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#8fb3c2';
  ctx.font = `400 ${17 * s}px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillText(info.caption, pad, h - pad - 18 * s);
  ctx.font = `400 ${12.5 * s}px "JetBrains Mono", monospace`;
  ctx.fillStyle = '#6d8e9c';
  ctx.fillText(info.trace, pad, h - pad + 4 * s);

  // Watermark.
  ctx.textAlign = 'right';
  ctx.fillText(`${info.url} · ${info.date}`, w - pad, h - pad + 4 * s);

  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number): void {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
