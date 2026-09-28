import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { CatalogService, MetricEntry } from '../../core/data/catalog.service';
import { EngineClient } from '../../core/data/engine-client.service';
import { buildIntegrable, IntegrableRates, integrate } from '../../core/engine/integrate';
import { TimeWindow, WINDOW_SECONDS } from '../../core/engine/periods';
import { resolveProfile } from '../../core/engine/profiles';
import { perCapita } from '../../core/engine/resolve';
import { tzOffsetHours } from '../../core/engine/time';
import { CountryValue, MetricSnapshot, Provenance } from '../../core/engine/types';
import { isContinuous, niceUnitsPerParticle } from '../../core/engine/units';
import { AppStore } from '../../core/state/app-store';
import { ClockService } from '../../core/time/clock.service';
import {
  FLAG_ALLOCATED,
  FLAG_ESTIMATED,
  FLAG_NONE,
  FLAG_REPORTED,
  GlobeLayerData,
} from '../../globe/layer-data';
import { quantileClasses } from '../../globe/choropleth';

export const REPLAY_SECONDS = 10;
const PARTICLE_BUDGET = 160;

/** A resolved metric view: the snapshot plus what the UI needs to present it. */
export interface MetricView {
  entry: MetricEntry;
  snapshot: MetricSnapshot;
  population: MetricSnapshot | null;
  /** Snapshot actually drawn (per-capita when enabled). */
  display: MetricSnapshot;
  rates: IntegrableRates;
  byIso: Map<string, CountryValue>;
}

export function provenanceFlag(p: Provenance): number {
  switch (p) {
    case 'reported':
      return FLAG_REPORTED;
    case 'interpolated':
    case 'carried':
      return FLAG_ESTIMATED;
    case 'allocated':
      return FLAG_ALLOCATED;
  }
}

/**
 * View-model of the world page: resolves snapshots through the worker, derives globe layer data,
 * and exposes drift-free counters (always integrated from absolute timestamps).
 */
@Injectable()
export class WorldView {
  private readonly store = inject(AppStore);
  private readonly catalog = inject(CatalogService);
  private readonly engine = inject(EngineClient);
  private readonly clock = inject(ClockService);

  readonly entry = computed<MetricEntry | null>(() => {
    const map = this.catalog.byId();
    return map.get(this.store.metricId() ?? '') ?? map.get(this.catalog.defaultMetricId()) ?? null;
  });
  readonly compareEntry = computed<MetricEntry | null>(() => {
    const id = this.store.compareId();
    return id ? (this.catalog.byId().get(id) ?? null) : null;
  });

  /** Year used for the primary metric (latest data year outside history mode). */
  readonly year = computed<number | null>(() => {
    const e = this.entry();
    if (!e) return null;
    return this.store.mode() === 'history' ? clampYear(this.store.year() ?? e.latest, e) : e.latest;
  });
  readonly compareYear = computed<number | null>(() => {
    const e = this.compareEntry();
    if (!e) return null;
    return this.store.mode() === 'history' ? clampYear(this.store.year() ?? e.latest, e) : e.latest;
  });

  readonly primary = signal<MetricView | null>(null);
  readonly secondary = signal<MetricView | null>(null);
  /** Every metric at its latest year (ticker, dashboard, country panel outside history). */
  readonly latestAll = signal<Map<string, MetricSnapshot>>(new Map());
  /** Every metric at the history year (country panel in history mode). */
  readonly yearAll = signal<Map<string, MetricSnapshot>>(new Map());
  readonly loading = signal(true);

  // ---- replay & history playback
  readonly replay = signal<{ window: TimeWindow; startedAt: number } | null>(null);
  readonly historyPlaying = signal(false);
  readonly historySpeed = signal(1);
  readonly timeScale = computed(() => {
    const r = this.replay();
    return r ? WINDOW_SECONDS[r.window] / REPLAY_SECONDS : 1;
  });

  /** UTC offset per country index (hours). */
  readonly offsetsByIndex = computed(() => {
    const countries = this.catalog.countries();
    const n = countries.reduce((m, c) => Math.max(m, c.i), 0) + 1;
    const arr = new Float32Array(n);
    const now = new Date();
    const cache = new Map<string, number>();
    for (const c of countries) {
      let off = cache.get(c.tz);
      if (off === undefined) {
        off = tzOffsetHours(c.tz, now);
        cache.set(c.tz, off);
      }
      arr[c.i] = off;
    }
    return arr;
  });
  private readonly offsetByIso = computed(() => {
    const byIndex = this.offsetsByIndex();
    const map = new Map<string, number>();
    for (const c of this.catalog.countries()) map.set(c.iso3, byIndex[c.i]);
    return map;
  });

  readonly globePrimary = computed(() => this.toGlobe(this.primary()));
  readonly globeSecondary = computed(() => this.toGlobe(this.secondary()));

  constructor() {
    const destroyRef = inject(DestroyRef);
    let historyTimer: ReturnType<typeof setInterval> | null = null;
    let replayTimer: ReturnType<typeof setTimeout> | null = null;
    destroyRef.onDestroy(() => {
      if (historyTimer) clearInterval(historyTimer);
      if (replayTimer) clearTimeout(replayTimer);
    });

    this.bindView(this.entry, this.year, this.primary, true);
    this.bindView(this.compareEntry, this.compareYear, this.secondary, false);

    effect(() => {
      this.engine.catalogVersion();
      if (this.catalog.status() !== 'ready') return;
      untracked(() => {
        void this.engine.snapshots('latest').then((list) => this.latestAll.set(new Map(list.map((s) => [s.metricId, s]))));
      });
    });

    effect(() => {
      const year = this.store.mode() === 'history' ? this.year() : null;
      this.engine.catalogVersion();
      if (year == null || this.catalog.status() !== 'ready') return;
      untracked(() => {
        void this.engine.snapshots(year).then((list) => {
          if (this.year() === year) this.yearAll.set(new Map(list.map((s) => [s.metricId, s])));
        });
      });
    });

    // History playback: advance the year until the end of the metric's range.
    effect(() => {
      const playing = this.historyPlaying();
      const speed = this.historySpeed();
      if (historyTimer) clearInterval(historyTimer);
      historyTimer = null;
      if (!playing) return;
      historyTimer = setInterval(() => {
        const e = this.entry();
        const y = this.year();
        if (!e || y == null) return;
        if (y >= e.range.max) {
          this.historyPlaying.set(false);
          return;
        }
        this.store.year.set(y + 1);
      }, 1100 / speed);
    });

    // Replay auto-stops after REPLAY_SECONDS.
    effect(() => {
      const r = this.replay();
      if (replayTimer) clearTimeout(replayTimer);
      replayTimer = null;
      if (r) replayTimer = setTimeout(() => this.replay.set(null), REPLAY_SECONDS * 1000 + 200);
    });

    // Leaving window mode stops the replay; leaving history stops playback.
    effect(() => {
      const mode = this.store.mode();
      untracked(() => {
        if (mode !== 'window') this.replay.set(null);
        if (mode !== 'history') this.historyPlaying.set(false);
      });
    });
  }

  private bindView(
    entry: () => MetricEntry | null,
    year: () => number | null,
    target: ReturnType<typeof signal<MetricView | null>>,
    primary: boolean,
  ): void {
    let token = 0;
    effect(() => {
      const e = entry();
      const y = year();
      const pc = this.store.perCapita();
      this.engine.catalogVersion();
      const offsets = this.offsetByIso();
      if (!e || y == null || this.catalog.status() !== 'ready') {
        if (!e) target.set(null);
        return;
      }
      const my = ++token;
      if (primary) this.loading.set(true);
      void this.engine.snapshots(y, [e.file.id, 'population']).then((list) => {
        if (my !== token) return;
        const snap = list.find((s) => s.metricId === e.file.id);
        const pop = list.find((s) => s.metricId === 'population') ?? null;
        if (!snap) return;
        const display = pc && pop && e.file.id !== 'population' ? perCapita(snap, pop) : snap;
        const hourly = resolveProfile(e.file.temporalProfile);
        target.set({
          entry: e,
          snapshot: snap,
          population: pop,
          display,
          rates: buildIntegrable(snap, (iso) => offsets.get(iso) ?? 0, hourly),
          byIso: new Map(display.countries.map((c) => [c.iso3, c])),
        });
        if (primary) this.loading.set(false);
      });
    });
  }

  private toGlobe(view: MetricView | null): GlobeLayerData | null {
    if (!view) return null;
    const countries = this.catalog.countries();
    const n = countries.reduce((m, c) => Math.max(m, c.i), 0) + 1;
    const values = new Float32Array(n);
    const flags = new Uint8Array(n);
    const rates = new Float32Array(n);
    const flow = view.entry.file.kind === 'flow';
    const byIsoRaw = new Map(view.snapshot.countries.map((c) => [c.iso3, c]));
    let placedRate = 0;
    for (const c of countries) {
      const d = view.byIso.get(c.iso3);
      if (d) {
        values[c.i] = d.value;
        flags[c.i] = provenanceFlag(d.provenance);
      } else {
        flags[c.i] = FLAG_NONE;
      }
      const raw = byIsoRaw.get(c.iso3);
      if (flow && raw) {
        rates[c.i] = raw.value;
        placedRate += raw.value;
      }
    }
    const scale = this.timeScale();
    const e = view.entry.file;
    const color = e.visual?.color ?? '#46f0ff';
    return {
      key: `${e.id}|${view.snapshot.year}|${this.store.perCapita()}`,
      color,
      scale: e.visual?.scale ?? 'sqrt',
      values,
      flags,
      classes: quantileClasses(values, (i) => flags[i] !== FLAG_NONE, color),
      rates,
      offsets: this.offsetsByIndex(),
      hourly: view.rates.hourly,
      unitsPerParticle: flow ? niceUnitsPerParticle(placedRate * scale, PARTICLE_BUDGET, isContinuous(e.unit)) : 0,
    };
  }

  // ------------------------------------------------------------------ counters (read clock → ≤10 Hz)

  /** Total produced since the page was opened (live mode). */
  sinceOpen(view: MetricView | null): number {
    if (!view || view.entry.file.kind !== 'flow') return 0;
    return integrate(view.rates, this.clock.openedAt / 1000, this.clock.now() / 1000);
  }

  /** Total over the selected window ending now (profile-aware). */
  inWindow(view: MetricView | null, window: TimeWindow): number {
    if (!view || view.entry.file.kind !== 'flow') return 0;
    const now = this.clock.now() / 1000;
    return integrate(view.rates, now - WINDOW_SECONDS[window], now);
  }

  /** Replay progress 0..1 and the amount "revealed" so far. */
  replayProgress(): number {
    const r = this.replay();
    if (!r) return 0;
    return Math.min(1, (this.clock.now() - r.startedAt) / (REPLAY_SECONDS * 1000));
  }

}

function clampYear(y: number, e: MetricEntry): number {
  return Math.max(e.range.min, Math.min(e.range.max, y));
}
