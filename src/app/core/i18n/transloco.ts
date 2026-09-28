import { inject, Injectable, isDevMode, provideAppInitializer } from '@angular/core';
import { provideTransloco, Translation, TranslocoLoader, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, forkJoin, Observable, of } from 'rxjs';
import en from './en.json';
import it from './it.json';

export const LANGS = ['en', 'it'] as const;
export type Lang = (typeof LANGS)[number];

const TRANSLATIONS: Record<Lang, Translation> = { en, it };

/** Translations are bundled statically: available synchronously during prerender and in the browser. */
@Injectable({ providedIn: 'root' })
export class StaticTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(TRANSLATIONS[(LANGS as readonly string[]).includes(lang) ? (lang as Lang) : 'en']);
  }
}

export function provideI18n() {
  return [
    provideTranslocoConfig(),
    // Load both languages before the first render so translate() is synchronous everywhere
    // (SEO meta during prerender, computed labels, host bindings).
    provideAppInitializer(() => {
      const t = inject(TranslocoService);
      return firstValueFrom(forkJoin(LANGS.map((l) => t.load(l))));
    }),
  ];
}

function provideTranslocoConfig() {
  return provideTransloco({
    config: {
      availableLangs: [...LANGS],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
      missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
    },
    loader: StaticTranslocoLoader,
  });
}
