import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Confidence, Provenance } from '../../core/engine/types';
import { LocaleService } from '../../core/i18n/locale.service';

/** "official · reported 2023" style badge; the title explains the confidence level. */
@Component({
  selector: 'app-confidence-badge',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="confidence()" [attr.title]="hint()">
    {{ 'confidence.' + confidence() | transloco }}
    @if (provenance() && provenance() !== 'reported') {
      · {{ 'provenance.' + provenance() | transloco }}
    }
    @if (year()) {
      · {{ year() }}
    }
  </span>`,
  styles: `
    :host {
      display: inline-flex;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 999px;
      font: 500 10px/1.5 var(--wp-font-mono);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border: 1px solid currentColor;
      white-space: nowrap;
    }
    .official { color: var(--wp-ok); }
    .estimate { color: var(--wp-warn); }
    .modelled { color: var(--wp-accent-2); }
  `,
})
export class ConfidenceBadge {
  readonly confidence = input.required<Confidence>();
  readonly provenance = input<Provenance | 'sum' | null>(null);
  readonly year = input<number | null>(null);
  private readonly transloco = inject(TranslocoService);
  private readonly locale = inject(LocaleService);
  protected readonly hint = computed(() => {
    this.locale.lang();
    return this.transloco.translate(`confidenceHint.${this.confidence()}`);
  });
}
