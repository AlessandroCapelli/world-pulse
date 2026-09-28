import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface Cell {
  key: string;
  digit: number | null;
  char: string;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Odometer-style number: every digit is a vertical strip translated to its value,
 * so changes roll smoothly (CSS transition). Cells are keyed from the right so they stay stable.
 */
@Component({
  selector: 'app-odometer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-label]': 'value()', role: 'text' },
  template: `
    <span class="odo" aria-hidden="true">
      @for (c of cells(); track c.key) {
        @if (c.digit !== null) {
          <span class="cell"><span class="strip" [style.transform]="'translateY(' + -c.digit * 10 + '%)'">
            @for (d of digits; track d) {<span>{{ d }}</span>}
          </span></span>
        } @else {
          <span class="sep">{{ c.char }}</span>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      font-variant-numeric: tabular-nums;
    }
    .odo {
      display: inline-flex;
      align-items: flex-start;
      white-space: nowrap;
    }
    .cell {
      display: inline-block;
      height: 1em;
      overflow: hidden;
      line-height: 1;
    }
    .strip {
      display: flex;
      flex-direction: column;
      transition: transform 380ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .strip span {
      height: 1em;
      line-height: 1;
    }
    .sep {
      line-height: 1;
      height: 1em;
      white-space: pre;
    }
  `,
})
export class Odometer {
  readonly value = input.required<string>();
  protected readonly digits = DIGITS;
  protected readonly cells = computed<Cell[]>(() => {
    const chars = [...this.value()];
    const n = chars.length;
    return chars.map((char, i) => {
      const digit = char >= '0' && char <= '9' ? Number(char) : null;
      return { key: `${n - i}:${digit === null ? char : 'd'}`, digit, char };
    });
  });
}
