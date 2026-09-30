import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { Confidence, Source } from '../../core/engine/types';
import { LocaleService } from '../../core/i18n/locale.service';
import { SeoService } from '../../core/seo/seo.service';
import { SITE } from '../../core/site.config';
import { Icon } from '../../shared/icons/icon';
import { ConfidenceBadge } from '../../shared/ui/confidence-badge';

interface SourceRow extends Source {
  key: string;
  metrics: { id: string; name: string }[];
}

@Component({
  selector: 'app-about-page',
  imports: [TranslocoPipe, RouterLink, Icon, ConfidenceBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {
  private readonly catalog = inject(CatalogService);
  private readonly transloco = inject(TranslocoService);
  private readonly seo = inject(SeoService);
  protected readonly lang = inject(LocaleService).lang;
  protected readonly confidences: Confidence[] = ['official', 'estimate', 'modelled'];
  protected readonly site = SITE;
  protected readonly methodKeys = ['rates', 'derived', 'years', 'allocation', 'coverage', 'profiles', 'counters', 'colours', 'etl', 'centroids'];

  protected readonly limits = computed(() => {
    this.lang();
    const v = this.transloco.translateObject('about.limits.items');
    return Array.isArray(v) ? (v as string[]) : [];
  });

  protected readonly sources = computed<SourceRow[]>(() => {
    const lang = this.lang();
    const map = new Map<string, SourceRow>();
    for (const e of this.catalog.entries()) {
      if (e.origin === 'user') continue;
      for (const s of Object.values(e.file.sources)) {
        const key = `${s.publisher}|${s.title}`;
        const row = map.get(key) ?? { ...s, key, metrics: [] };
        if (!row.metrics.some((m) => m.id === e.file.id)) row.metrics.push({ id: e.file.id, name: e.file.name[lang] });
        map.set(key, row);
      }
    }
    return [...map.values()].sort((a, b) => a.publisher.localeCompare(b.publisher));
  });

  protected readonly counts = computed(() => ({
    metrics: this.catalog.entries().filter((e) => e.origin !== 'user').length,
    sources: this.sources().length,
  }));

  constructor() {
    effect(() => {
      this.lang();
      untracked(() =>
        this.seo.set({
          title: this.transloco.translate('about.title'),
          description: this.transloco.translate('about.lead'),
          path: 'about',
        }),
      );
    });
  }
}
