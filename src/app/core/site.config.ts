/**
 * Canonical absolute site URL used for OG/canonical meta tags.
 * Injected at build time with `--define WP_SITE_URL="'https://<user>.github.io/<repo>'"`
 * (the GitHub Pages workflow does this automatically); defaults to the official deployment.
 */
declare const WP_SITE_URL: string | undefined;

export const SITE = {
  name: 'World Pulse',
  author: 'Alessandro Capelli',
  authorUrl: 'https://github.com/AlessandroCapelli',
  repoUrl: 'https://github.com/AlessandroCapelli/world-pulse',
  url: (typeof WP_SITE_URL === 'string' ? WP_SITE_URL : 'https://alessandrocapelli.github.io/world-pulse').replace(/\/+$/, ''),
} as const;

export function absoluteUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return clean ? `${SITE.url}/${clean}` : `${SITE.url}/`;
}
