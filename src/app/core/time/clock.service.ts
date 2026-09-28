import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** UI clock: a signal of the current time updated at 10 Hz (≤15 Hz rule), paused while the tab is hidden. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  static readonly HZ = 10;
  /** When this page was opened (ms since epoch). */
  readonly openedAt = Date.now();
  readonly now = signal(this.openedAt);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => this.now.set(Date.now()), 1000 / ClockService.HZ);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();
    inject(DestroyRef).onDestroy(() => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }
}
