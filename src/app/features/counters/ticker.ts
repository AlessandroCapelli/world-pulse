import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { buildIntegrable, integrate } from '../../core/engine/integrate';
import { resolveProfile } from '../../core/engine/profiles';
import { LocaleService } from '../../core/i18n/locale.service';
import { ClockService } from '../../core/time/clock.service';
import { I18nTextPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { splitQuantity } from '../world/figures';
import { WorldView } from '../world/world-view.service';

/** Scrolling strip of live counters for featured metrics, "since you arrived". */
@Component({
  selector: 'app-ticker',
  imports: [TranslocoPipe, Icon, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ticker"
      [class.paused]="paused()"
      role="region"
      [attr.aria-label]="'ticker.title' | transloco"
    >
      <span class="title hud-label">{{ 'ticker.title' | transloco }}</span>
      <div class="viewport">
        <ul class="track" [style.--dur.s]="items().length * 6">
          @for (copy of copies; track copy) {
            @for (it of items(); track it.id) {
              <li [attr.aria-hidden]="copy === 1 ? 'true' : null">
                <button
                  type="button"
                  [style.--c]="it.color"
                  (click)="pick.emit(it.id)"
                  [title]="it.trace"
                  [tabindex]="copy === 1 ? -1 : 0"
                >
                  <app-icon [name]="it.icon" [size]="14" />
                  <span class="v mono"
                    >{{ it.value.number }}
                    @if (it.value.unit) {
                      <small> {{ it.value.unit }}</small>
                    }
                  </span>
                  <span class="n">{{ it.label | tx: lang() }}</span>
                  <span class="visually-hidden">({{ it.trace }})</span>
                </button>
              </li>
            }
          }
        </ul>
      </div>
      <button
        type="button"
        class="toggle hud-button icon-only"
        (click)="paused.set(!paused())"
        [attr.aria-pressed]="paused()"
        [attr.aria-label]="(paused() ? 'ticker.play' : 'ticker.pause') | transloco"
        [title]="(paused() ? 'ticker.play' : 'ticker.pause') | transloco"
      >
        <app-icon [name]="paused() ? 'play' : 'pause'" [size]="12" />
      </button>
    </div>
  `,
  styleUrl: './ticker.scss',
})
export class Ticker {
  readonly pick = output<string>();
  private readonly world = inject(WorldView);
  private readonly catalog = inject(CatalogService);
  private readonly clock = inject(ClockService);
  protected readonly lang = inject(LocaleService).lang;
  /** Scrolling starts paused when the visitor asked for reduced motion; the toggle can still start it. */
  protected readonly paused = signal(
    isPlatformBrowser(inject(PLATFORM_ID)) && typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  protected readonly copies = [0, 1];

  private readonly rates = computed(() => {
    const snaps = this.world.latestAll();
    const offsets = this.world.offsetsByIndex();
    const idx = new Map(this.catalog.countries().map((c) => [c.iso3, c.i]));
    return this.catalog
      .entries()
      .filter((e) => e.file.featured && e.file.kind === 'flow' && snaps.has(e.file.id))
      .map((e) => {
        const s = snaps.get(e.file.id)!;
        const src = s.world.sourceId ? e.file.sources[s.world.sourceId] : undefined;
        return {
          entry: e,
          snapshot: s,
          src,
          rates: buildIntegrable(
            s,
            (iso) => offsets[idx.get(iso) ?? 0] ?? 0,
            resolveProfile(e.file.temporalProfile),
          ),
        };
      });
  });

  protected readonly items = computed(() => {
    const t0 = this.clock.openedAt / 1000;
    const t1 = this.clock.now() / 1000;
    const lang = this.lang();
    return this.rates().map(({ entry, snapshot, src, rates }) => {
      const value = splitQuantity(integrate(rates, t0, t1), entry.file.unit, lang, true);
      return {
        id: entry.file.id,
        icon: entry.file.visual?.icon ?? 'globe',
        color: entry.file.visual?.color ?? '#46f0ff',
        label: value.unit ? entry.file.name : entry.file.unitLabel,
        value,
        trace: `${src?.publisher ?? '—'} · ${snapshot.world.dataYear ?? '—'} · ${snapshot.world.confidence}`,
      };
    });
  });
}
