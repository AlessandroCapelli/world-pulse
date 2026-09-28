import { ChangeDetectionStrategy, Component, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { CatalogService } from './core/data/catalog.service';
import { LocaleService } from './core/i18n/locale.service';
import { UserDataStore } from './core/data/user-data.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    const locale = inject(LocaleService);
    locale.init(isBrowser ? new URLSearchParams(location.search).get('lang') : null);
    const catalog = inject(CatalogService);
    void catalog.load();
    if (isBrowser) void inject(UserDataStore).restore();
  }
}
