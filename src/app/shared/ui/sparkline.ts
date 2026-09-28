import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface SparkPoint {
  x: number;
  y: number;
  /** Estimated/carried/allocated points are drawn hollow. */
  estimated?: boolean;
}

/** Minimal SVG sparkline with a highlighted current point. */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (geometry(); as g) {
      <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
        <path class="area" [attr.d]="g.area" />
        <path class="line" [attr.d]="g.line" />
        @for (p of g.points; track p.x) {
          <circle [attr.cx]="p.cx" [attr.cy]="p.cy" [attr.r]="p.current ? 3 : 1.6" [class.hollow]="p.estimated" [class.current]="p.current" />
        }
      </svg>
      <div class="axis"><span>{{ g.minX }}</span><span>{{ g.maxX }}</span></div>
    }
  `,
  styles: `
    :host { display: block; }
    svg { width: 100%; height: 44px; overflow: visible; }
    .line { fill: none; stroke: var(--spark, var(--wp-accent)); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
    .area { fill: var(--spark, var(--wp-accent)); opacity: 0.1; }
    circle { fill: var(--spark, var(--wp-accent)); }
    circle.hollow { fill: var(--wp-bg); stroke: var(--spark, var(--wp-accent)); stroke-width: 1; }
    circle.current { filter: drop-shadow(0 0 4px var(--spark, var(--wp-accent))); }
    .axis { display: flex; justify-content: space-between; font: 10px/1 var(--wp-font-mono); color: var(--wp-text-faint); margin-top: 4px; }
  `,
})
export class Sparkline {
  readonly points = input.required<SparkPoint[]>();
  readonly current = input<number | null>(null);
  readonly label = input('');
  protected readonly width = 200;
  protected readonly height = 44;

  protected readonly geometry = computed(() => {
    const pts = [...this.points()].sort((a, b) => a.x - b.x);
    if (pts.length < 2) return null;
    const minX = pts[0].x;
    const maxX = pts[pts.length - 1].x;
    const maxY = Math.max(...pts.map((p) => p.y)) || 1;
    const sx = (x: number) => ((x - minX) / (maxX - minX || 1)) * this.width;
    const sy = (y: number) => this.height - 3 - (y / maxY) * (this.height - 6);
    const coords = pts.map((p) => ({ cx: sx(p.x), cy: sy(p.y), x: p.x, estimated: !!p.estimated, current: p.x === this.current() }));
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
    const area = `${line} L${this.width},${this.height} L0,${this.height} Z`;
    return { line, area, points: coords, minX, maxX };
  });
}
