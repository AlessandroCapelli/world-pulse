export type QualityLevel = 0 | 1 | 2;

export interface QualityProfile {
  pixelRatio: number;
  bloom: boolean;
  bloomScale: number;
  spawnBudget: number;
}

/** Initial quality guess from device hints; the governor then adapts to measured frame time. */
export function initialQuality(): { level: QualityLevel; mobile: boolean } {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = coarse || small;
  const level: QualityLevel = mobile || memory < 4 ? 1 : 2;
  return { level, mobile };
}

export function profileFor(level: QualityLevel): QualityProfile {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  switch (level) {
    case 2:
      return { pixelRatio: Math.min(dpr, 2), bloom: true, bloomScale: 1, spawnBudget: 400 };
    case 1:
      return { pixelRatio: Math.min(dpr, 1.5), bloom: true, bloomScale: 0.5, spawnBudget: 260 };
    default:
      return { pixelRatio: 1, bloom: false, bloomScale: 0.5, spawnBudget: 150 };
  }
}

/** Steps quality down when frames are slow for ~2 s, up when fast for ~6 s (with hysteresis). */
export class QualityGovernor {
  private ema = 16;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 3;

  constructor(
    public level: QualityLevel,
    private readonly maxLevel: QualityLevel,
    private readonly apply: (level: QualityLevel) => void,
  ) {}

  /** @param frameMs wall time between frames */
  sample(frameMs: number, dt: number): void {
    if (frameMs > 250) return; // tab switch / breakpoint
    this.ema += (frameMs - this.ema) * 0.08;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.ema > 24) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.ema < 13) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.cooldown > 0) return;
    if (this.slowFor > 2 && this.level > 0) this.set((this.level - 1) as QualityLevel);
    else if (this.fastFor > 6 && this.level < this.maxLevel) this.set((this.level + 1) as QualityLevel);
  }

  get frameMs(): number {
    return this.ema;
  }

  private set(level: QualityLevel): void {
    this.level = level;
    this.slowFor = 0;
    this.fastFor = 0;
    this.cooldown = 4;
    this.apply(level);
  }
}
