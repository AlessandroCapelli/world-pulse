import { DOCUMENT, inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { absoluteUrl, SITE } from '../site.config';

export interface PageMeta {
  title: string;
  description: string;
  /** Path relative to the site root, e.g. "metric/births". */
  path: string;
}

/** Title, description, canonical and Open Graph / Twitter tags (rendered into prerendered HTML). */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  set(page: PageMeta): void {
    const fullTitle = page.title === SITE.name ? SITE.name : `${page.title} · ${SITE.name}`;
    const url = absoluteUrl(page.path);
    this.title.setTitle(fullTitle);
    const tags: [string, string, 'name' | 'property'][] = [
      ['description', page.description, 'name'],
      ['og:title', fullTitle, 'property'],
      ['og:description', page.description, 'property'],
      ['og:type', 'website', 'property'],
      ['og:url', url, 'property'],
      ['og:site_name', SITE.name, 'property'],
      ['og:image', absoluteUrl('og-image.jpg'), 'property'],
      ['twitter:card', 'summary_large_image', 'name'],
      ['twitter:title', fullTitle, 'name'],
      ['twitter:description', page.description, 'name'],
      ['twitter:image', absoluteUrl('og-image.jpg'), 'name'],
    ];
    for (const [key, content, attr] of tags) {
      this.meta.updateTag({ [attr]: key, content }, `${attr}="${key}"`);
    }
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'canonical';
      this.document.head.appendChild(link);
    }
    link.href = url;
  }
}
