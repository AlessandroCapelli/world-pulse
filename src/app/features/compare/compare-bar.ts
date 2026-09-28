import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { formatNumber } from '../../core/engine/units';
import { LocaleService } from '../../core/i18n/locale.service';
import { AppStore } from '../../core/state/app-store';
import { I18nTextPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { WorldView } from '../world/world-view.service';

/** Ratio between the two compared metrics (only meaningful for flows sharing a unit). */
@Component({
  selector: 'app-compare-bar',
  imports: [TranslocoPipe, Icon, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud-panel bar">
      <!-- Phones draw one globe at a time: these tabs pick which metric it shows. -->
      <div class="tabs" role="tablist" [attr.aria-label]="'compare.show' | transloco">
        @for (t of tabs(); track t.slot) {
          <button type="button" role="tab" [attr.aria-selected]="slot() === t.slot" [class.active]="slot() === t.slot" [style.--tab]="t.color" (click)="slotChange.emit(t.slot)">
            <span class="dot"></span><span class="name">{{ t.name | tx: lang() }}</span>
          </button>
        }
      </div>
      @if (ratio(); as r) {
        <p class="ratio">
          <span class="big" [style.color]="r.bigColor">{{ r.big | tx: lang() }}</span>
          <span class="x mono">= {{ r.n }} ×</span>
          <span class="small" [style.color]="r.smallColor">{{ r.small | tx: lang() }}</span>
        </p>
      } @else {
        <p class="hint">{{ 'compare.incompatible' | transloco }}</p>
      }
      <button type="button" class="hud-button icon-only" (click)="swap()" [title]="'compare.swap' | transloco" [attr.aria-label]="'compare.swap' | transloco">⇄</button>
      <button type="button" class="hud-button" (click)="closed.emit()">
        <app-icon name="x" [size]="13" />{{ 'compare.close' | transloco }}
      </button>
    </div>
  `,
  styles: `
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; }
    .tabs { display: none; }
    @media (max-width: 760px), (max-height: 500px) and (orientation: landscape) {
      .bar { gap: 8px 10px; padding: 8px; }
      .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; flex: 1 1 100%; padding: 3px; border-radius: 10px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--wp-border); }
      .tabs button { display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--wp-text-dim); font: 500 13px/1.1 var(--wp-font-display); transition: background 160ms ease, color 160ms ease; }
      .tabs button.active { color: var(--wp-text); background: color-mix(in srgb, var(--tab) 18%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tab) 55%, transparent); }
      .tabs .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--tab); box-shadow: 0 0 8px var(--tab); }
      .tabs .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ratio { flex: 1 1 auto; font-size: 12.5px; padding-left: 6px; }
    }
    .ratio { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 8px; font-size: 13.5px; }
    .big, .small { font-weight: 600; }
    .x { color: var(--wp-text); font-size: 15px; }
    .hint { margin: 0; font-size: 12.5px; color: var(--wp-text-dim); }
  `,
})
export class CompareBar {
  /** Phone tabs: which metric the single globe shows (0 = primary). */
  readonly slot = input<0 | 1>(0);
  readonly slotChange = output<0 | 1>();
  readonly closed = output<void>();
  private readonly world = inject(WorldView);
  private readonly store = inject(AppStore);
  protected readonly lang = inject(LocaleService).lang;

  protected readonly ratio = computed(() => {
    const a = this.world.primary();
    const b = this.world.secondary();
    if (!a || !b) return null;
    const fa = a.entry.file;
    const fb = b.entry.file;
    if (fa.kind !== 'flow' || fb.kind !== 'flow' || fa.unit !== fb.unit) return null;
    const ra = a.snapshot.world.value;
    const rb = b.snapshot.world.value;
    if (!(ra > 0) || !(rb > 0)) return null;
    const [big, small] = ra >= rb ? [a, b] : [b, a];
    const n = big.snapshot.world.value / small.snapshot.world.value;
    return {
      big: big.entry.file.name,
      small: small.entry.file.name,
      bigColor: big.entry.file.visual?.color ?? null,
      smallColor: small.entry.file.visual?.color ?? null,
      n: formatNumber(n, this.lang(), { maximumSignificantDigits: 3 }),
    };
  });

  protected readonly tabs = computed(() =>
    [this.world.primary(), this.world.secondary()].flatMap((v, i) =>
      v ? [{ slot: i as 0 | 1, name: v.entry.file.name, color: v.entry.file.visual?.color ?? '#46f0ff' }] : [],
    ),
  );

  protected swap(): void {
    const a = this.store.metricId();
    const b = this.store.compareId();
    if (!a || !b) return;
    this.store.compareId.set(a);
    this.store.metricId.set(b);
  }
}
