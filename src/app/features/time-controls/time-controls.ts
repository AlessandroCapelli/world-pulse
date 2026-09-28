import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TIME_WINDOWS, TimeWindow } from '../../core/engine/periods';
import { LocaleService } from '../../core/i18n/locale.service';
import { AppStore } from '../../core/state/app-store';
import { ClockService } from '../../core/time/clock.service';
import { Icon } from '../../shared/icons/icon';
import { WorldView } from '../world/world-view.service';

@Component({
  selector: 'app-time-controls',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './time-controls.html',
  styleUrl: './time-controls.scss',
})
export class TimeControls {
  protected readonly store = inject(AppStore);
  protected readonly world = inject(WorldView);
  private readonly clock = inject(ClockService);
  protected readonly lang = inject(LocaleService).lang;
  protected readonly windows = TIME_WINDOWS;
  protected readonly speeds = [1, 2, 4];

  protected readonly elapsed = computed(() => {
    const s = Math.floor((this.clock.now() - this.clock.openedAt) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
  });

  protected readonly range = computed(() => this.world.entry()?.range ?? null);
  protected readonly year = computed(() => this.world.year());
  protected readonly replayPct = computed(() => this.world.replayProgress() * 100);

  protected setWindow(w: TimeWindow): void {
    this.world.replay.set(null);
    this.store.window.set(w);
  }

  protected toggleReplay(): void {
    if (this.world.replay()) this.world.replay.set(null);
    else this.world.replay.set({ window: this.store.window(), startedAt: Date.now() });
  }

  protected onYear(e: Event): void {
    this.world.historyPlaying.set(false);
    this.store.year.set(Number((e.target as HTMLInputElement).value));
  }

  protected togglePlay(): void {
    const r = this.range();
    if (!r) return;
    if (!this.world.historyPlaying() && (this.year() ?? r.max) >= r.max) this.store.year.set(r.min);
    this.world.historyPlaying.set(!this.world.historyPlaying());
  }

  protected cycleSpeed(): void {
    const i = this.speeds.indexOf(this.world.historySpeed());
    this.world.historySpeed.set(this.speeds[(i + 1) % this.speeds.length]);
  }
}
