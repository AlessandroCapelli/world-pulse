import { DOCUMENT, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslocoService } from '@jsverse/transloco';
import { Lang, LANGS } from './transloco';
import { I18nText } from '../engine/types';

const STORAGE_KEY = 'wp.lang';

/** Active UI language as a signal; syncs Transloco, <html lang> and localStorage. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lang = signal<Lang>('en');

  /** Picks the initial language: explicit (URL) → stored preference → browser language. */
  init(explicit: string | null): void {
    let lang: Lang = 'en';
    if (isLang(explicit)) lang = explicit;
    else if (this.isBrowser) {
      const stored = safeGet(STORAGE_KEY);
      if (isLang(stored)) lang = stored;
      else if (navigator.language?.toLowerCase().startsWith('it')) lang = 'it';
    }
    this.apply(lang, false);
  }

  set(lang: Lang): void {
    this.apply(lang, true);
  }

  text(t: I18nText): string {
    return t[this.lang()];
  }

  private apply(lang: Lang, persist: boolean): void {
    this.lang.set(lang);
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;
    if (persist && this.isBrowser) safeSet(STORAGE_KEY, lang);
  }
}

function isLang(v: string | null | undefined): v is Lang {
  return !!v && (LANGS as readonly string[]).includes(v);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode): preference is not persisted */
  }
}
