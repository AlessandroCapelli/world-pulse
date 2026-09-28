import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LocaleService } from '../../core/i18n/locale.service';
import { Lang, LANGS } from '../../core/i18n/transloco';
import { AppStore, Mode, MODES } from '../../core/state/app-store';
import { Icon } from '../../shared/icons/icon';

@Component({
  selector: 'app-top-bar',
  imports: [TranslocoPipe, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
  host: {
    '(document:pointerdown)': 'onDocumentPointer($event)',
    '(document:keydown.escape)': 'moreOpen.set(false)',
  },
})
export class TopBar {
  readonly pickerOpen = input(false);
  readonly togglePicker = output<void>();
  readonly openUpload = output<void>();
  readonly openShare = output<void>();

  protected readonly store = inject(AppStore);
  protected readonly locale = inject(LocaleService);
  protected readonly modes = MODES;
  protected readonly langs = LANGS;
  protected readonly modeIcon: Record<Mode, string> = { live: 'live', window: 'clock', history: 'history' };
  /** Overflow menu (narrow screens). */
  protected readonly moreOpen = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected onDocumentPointer(e: PointerEvent): void {
    if (this.moreOpen() && !this.host.nativeElement.querySelector('.more')?.contains(e.target as Node)) this.moreOpen.set(false);
  }

  protected setMode(m: Mode): void {
    this.store.mode.set(m);
  }

  protected setLang(l: Lang): void {
    this.locale.set(l);
    this.moreOpen.set(false);
  }
}
