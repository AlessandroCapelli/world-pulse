import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from '../../shared/icons/icon';

/** Share popover: copy the deep link (full state is in the URL) and export a PNG. */
@Component({
  selector: 'app-share-menu',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud-panel menu" role="dialog" [attr.aria-label]="'share.title' | transloco" (keydown.escape)="closed.emit()">
      <div class="row">
        <p class="hud-label">{{ 'share.title' | transloco }}</p>
        <button type="button" class="hud-button icon-only" (click)="closed.emit()" [attr.aria-label]="'common.close' | transloco">
          <app-icon name="x" [size]="13" />
        </button>
      </div>
      <input class="url mono" type="text" readonly [value]="url()" (focus)="select($event)" aria-label="URL" />
      <div class="row">
        <button type="button" class="hud-button" (click)="copy()">
          <app-icon [name]="copied() ? 'check' : 'link'" [size]="14" />
          {{ (copied() ? 'share.copied' : failed() ? 'share.copyFailed' : 'share.copy') | transloco }}
        </button>
        <button type="button" class="hud-button" [disabled]="!canCapture() || busy()" (click)="capture.emit()">
          <app-icon name="camera" [size]="14" />{{ (busy() ? 'share.capturing' : 'share.screenshot') | transloco }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .menu { display: flex; flex-direction: column; gap: 10px; width: min(360px, calc(100vw - 24px)); padding: 12px 14px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .row p { margin: 0; }
    .url { width: 100%; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--wp-border); background: rgba(0,0,0,.3); font-size: 11.5px; color: var(--wp-text-dim); }
  `,
})
export class ShareMenu {
  readonly url = input.required<string>();
  readonly canCapture = input(true);
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly capture = output<void>();
  protected readonly copied = signal(false);
  protected readonly failed = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.failed.set(true);
    }
  }

  protected select(e: FocusEvent): void {
    (e.target as HTMLInputElement).select();
  }
}
