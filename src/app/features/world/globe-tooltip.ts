import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { SECONDS_PER_YEAR } from '../../core/engine/periods';
import { LocaleService } from '../../core/i18n/locale.service';
import { AppStore } from '../../core/state/app-store';
import { QuantityPipe } from '../../shared/format/format.pipes';
import { MetricView } from './world-view.service';

/** Content of the hover tooltip (positioned by the globe component without change detection). */
@Component({
  selector: 'app-globe-tooltip',
  imports: [TranslocoPipe, QuantityPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (country(); as c) {
      <div class="tip">
        <strong>{{ c.name[lang()] }}</strong>
        @if (value(); as v) {
          <span class="v mono">{{ v.amount | qty: v.unit : lang() }} @if (v.per) {<small>{{ v.per | transloco }}</small>}</span>
          <span class="meta">
            {{ 'confidence.' + v.confidence | transloco }} · {{ 'provenance.' + v.provenance | transloco }} · {{ v.year }}@if (v.source) { · {{ v.source }}}
          </span>
        } @else {
          <span class="meta">{{ 'tooltip.noData' | transloco }}</span>
        }
      </div>
    }
  `,
  styles: `
    .tip {
      display: flex;
      flex-direction: column;
      gap: 2px;
      transform: translate(14px, -50%);
      min-width: 150px;
      max-width: 240px;
      padding: 8px 11px;
      border-radius: 10px;
      border: 1px solid var(--wp-border-strong);
      background: var(--wp-panel-strong);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5), 0 0 16px rgba(70, 240, 255, 0.12);
      font-size: 12px;
      white-space: normal;
    }
    strong { font-weight: 600; font-size: 13px; }
    .v { color: var(--wp-accent); font-size: 13px; }
    small { color: var(--wp-text-dim); font-size: 10.5px; }
    .meta { color: var(--wp-text-faint); font: 10px/1.4 var(--wp-font-mono); text-transform: uppercase; letter-spacing: 0.05em; }
  `,
})
export class GlobeTooltip {
  readonly index = input<number | null>(null);
  readonly view = input<MetricView | null>(null);
  private readonly catalog = inject(CatalogService);
  private readonly store = inject(AppStore);
  protected readonly lang = inject(LocaleService).lang;

  protected readonly country = computed(() => {
    const i = this.index();
    return i ? (this.catalog.countryByIndex()[i] ?? null) : null;
  });

  protected readonly value = computed(() => {
    const c = this.country();
    const v = this.view();
    if (!c || !v) return null;
    const d = v.byIso.get(c.iso3);
    if (!d) return null;
    const f = v.entry.file;
    const pc = this.store.perCapita() && f.id !== 'population';
    const flow = f.kind === 'flow';
    return {
      amount: flow ? d.value * SECONDS_PER_YEAR : d.value,
      unit: f.unit,
      per: pc ? (flow ? 'tooltip.perPersonYear' : 'tooltip.perPerson') : flow ? 'tooltip.perYear' : '',
      confidence: d.confidence,
      provenance: d.provenance,
      year: d.dataYear,
      source: d.sourceId ? (f.sources[d.sourceId]?.publisher ?? null) : null,
    };
  });
}
