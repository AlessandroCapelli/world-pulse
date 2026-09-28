import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideI18n } from './core/i18n/transloco';

// No client hydration: prerendered HTML serves SEO/first paint, then the client renders from scratch.
// This avoids hydration mismatches with browser-only state (language, local datasets, WebGL).
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideI18n(),
  ],
};
