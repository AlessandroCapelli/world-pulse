import { DestroyRef, effect, inject, Injectable, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, NavigationStart, Params, Router } from '@angular/router';
import { LocaleService } from '../i18n/locale.service';
import { AppStore, CameraState, DEFAULT_LAYERS, isMode, isWindow, Layers } from './app-store';

const LAYER_CODES: [keyof Layers, string][] = [
  ['particles', 'p'],
  ['spikes', 's'],
  ['choropleth', 'c'],
];

/**
 * Bidirectional store ⇄ URL sync. Everything shareable lives in query params
 * (so GitHub Pages never needs server rewrites); the metric lives in the path (/metric/:id).
 */
@Injectable()
export class UrlSync {
  private readonly store = inject(AppStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LocaleService);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private applying = false;

  /** Reads the current URL into the store, then keeps the URL updated. */
  start(): void {
    this.read(this.route.snapshot.queryParams);
    this.destroyRef.onDestroy(() => this.timer && clearTimeout(this.timer));
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationStart && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (event instanceof NavigationEnd) {
        const params = this.route.snapshot.queryParams;
        // Our own URL writes must not round the live camera pose back into the store.
        if (!sameParams(params, this.serialize())) this.read(params, true);
      }
    });
    effect(() => {
      const params = this.serialize();
      if (this.applying) return;
      untracked(() => this.schedule(params));
    });
  }

  /** Creates a link immediately, without waiting for the debounced URL update. */
  shareUrl(currentUrl: string): string {
    const url = new URL(currentUrl);
    url.search = '';
    for (const [key, value] of Object.entries(this.serialize())) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    return url.href;
  }

  private read(q: Params, restoreLanguage = false): void {
    this.applying = true;
    const s = this.store;
    const str = (k: string): string | null => (typeof q[k] === 'string' ? (q[k] as string) : null);
    s.compareId.set(str('cmp'));
    const mode = str('mode');
    s.mode.set(isMode(mode) ? mode : 'live');
    const w = str('w');
    s.window.set(isWindow(w) ? w : '1min');
    const y = Number(str('y'));
    s.year.set(Number.isInteger(y) && y > 1800 && y < 2200 ? y : null);
    const c = str('c');
    s.country.set(c && /^[A-Z]{3}$/.test(c) ? c : null);
    s.perCapita.set(str('pc') === '1');
    const layers = str('layers');
    if (layers !== null) {
      s.layers.set(Object.fromEntries(LAYER_CODES.map(([k, code]) => [k, layers.includes(code)])) as unknown as Layers);
    } else s.layers.set({ ...DEFAULT_LAYERS });
    s.tableView.set(str('view') === 'table');
    s.camera.set(parseCamera(str('cam')));
    if (restoreLanguage) this.locale.set(str('lang') === 'it' ? 'it' : 'en');
    this.applying = false;
  }

  private serialize(): Params {
    const s = this.store;
    const layers = s.layers();
    const layerStr = LAYER_CODES.filter(([k]) => layers[k])
      .map(([, c]) => c)
      .join('');
    const cam = s.camera();
    const p: Params = {
      cmp: s.compareId(),
      mode: s.mode() === 'live' ? null : s.mode(),
      w: s.mode() === 'window' && s.window() !== '1min' ? s.window() : null,
      y: s.mode() === 'history' ? s.year() : null,
      c: s.country(),
      pc: s.perCapita() ? '1' : null,
      layers: layerStr === 'psc' ? null : layerStr || '-',
      view: s.tableView() ? 'table' : null,
      cam: cam ? `${cam.lat.toFixed(1)},${cam.lng.toFixed(1)},${cam.alt.toFixed(2)}` : null,
      lang: this.locale.lang() === 'en' ? null : this.locale.lang(),
    };
    return p;
  }

  private schedule(params: Params): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (sameParams(this.route.snapshot.queryParams, params)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.router.navigate([], { relativeTo: this.route, queryParams: params, replaceUrl: true, queryParamsHandling: '' });
    }, 350);
  }
}

function parseCamera(v: string | null): CameraState | null {
  if (!v) return null;
  if (v.split(',').length !== 3) return null;
  const [lat, lng, alt] = v.split(',').map(Number);
  if (![lat, lng, alt].every(Number.isFinite)) return null;
  return { lat: Math.max(-85, Math.min(85, lat)), lng: ((((lng + 180) % 360) + 360) % 360) - 180, alt: Math.max(0.2, Math.min(9, alt)) };
}

function sameParams(a: Params, b: Params): boolean {
  return Object.keys({ ...a, ...b }).every((key) =>
    (a[key] == null ? null : String(a[key])) === (b[key] == null ? null : String(b[key])),
  );
}

