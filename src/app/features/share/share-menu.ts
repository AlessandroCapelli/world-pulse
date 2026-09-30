import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, DOCUMENT, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from '../../shared/icons/icon';

/** Share popover: copy the deep link (full state is in the URL) and export a PNG. */
@Component({
  selector: 'app-share-menu',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #menu class="hud-panel menu" role="dialog" [attr.aria-label]="'share.title' | transloco" (keydown.escape)="$event.preventDefault(); $event.stopPropagation(); closed.emit()">
      <div class="row">
        <p class="hud-label">{{ 'share.title' | transloco }}</p>
        <button type="button" class="hud-button icon-only" (click)="closed.emit()" [attr.aria-label]="'common.close' | transloco">
          <app-icon name="x" [size]="13" />
        </button>
      </div>
      <input #urlInput class="url mono" type="text" readonly [value]="url()" (focus)="select($event)" aria-label="URL" />
      <div class="row">
        <button type="button" class="hud-button" [disabled]="copying()" [attr.aria-busy]="copying()" (click)="copy()">
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
  protected readonly copying = signal(false);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  private readonly urlInput = viewChild.required<ElementRef<HTMLInputElement>>('urlInput');
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    });
    afterNextRender(() => {
      const trigger = this.document.activeElement;
      const menu = this.menu().nativeElement;
      this.urlInput().nativeElement.focus();
      this.destroyRef.onDestroy(() => {
        const active = this.document.activeElement;
        if ((active === this.document.body || (active && menu.contains(active))) && trigger instanceof HTMLElement && trigger.isConnected) {
          trigger.focus();
        }
      });
    });
  }

  protected async copy(): Promise<void> {
    if (this.copying()) return;
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    this.copied.set(false);
    this.failed.set(false);
    this.copying.set(true);
    try {
      await navigator.clipboard.writeText(this.url());
      if (this.destroyRef.destroyed) return;
      this.copied.set(true);
      this.feedbackTimer = setTimeout(() => {
        this.copied.set(false);
        this.feedbackTimer = null;
      }, 2000);
    } catch {
      if (!this.destroyRef.destroyed) this.failed.set(true);
    } finally {
      if (!this.destroyRef.destroyed) this.copying.set(false);
    }
  }

  protected select(e: FocusEvent): void {
    (e.target as HTMLInputElement).select();
  }
}
