import { Pipe, PipeTransform } from '@angular/core';
import { I18nText, UnitId } from '../../core/engine/types';
import { formatInteger, formatPercent, formatQuantity, Locale } from '../../core/engine/units';

/** value | qty: unit : lang  →  "1.2 Mt" */
@Pipe({ name: 'qty' })
export class QuantityPipe implements PipeTransform {
  transform(value: number | null | undefined, unit: UnitId, lang: Locale): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return formatQuantity(value, unit, lang).text;
  }
}

/** value | int: lang  →  "1,234,567" */
@Pipe({ name: 'int' })
export class IntegerPipe implements PipeTransform {
  transform(value: number | null | undefined, lang: Locale): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return formatInteger(value, lang);
  }
}

/** value(0–100) | pct: lang : digits */
@Pipe({ name: 'pct' })
export class PercentPipe implements PipeTransform {
  transform(value: number | null | undefined, lang: Locale, digits = 0): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return formatPercent(value, lang, digits);
  }
}

/** {en, it} | tx: lang */
@Pipe({ name: 'tx' })
export class I18nTextPipe implements PipeTransform {
  transform(value: I18nText | null | undefined, lang: Locale): string {
    return value ? value[lang] : '';
  }
}
