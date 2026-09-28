import { z } from 'zod';
import { normalizeHourly } from '../engine/profiles';
import {
  CATEGORY_IDS,
  Manifest,
  MetricFile,
  NAMED_PROFILES,
  UNIT_IDS,
} from '../engine/types';

// Single source of truth for dataset validation: used by the app (user uploads)
// and by scripts/validate-data.ts (bundled data, via tsx).

const i18nText = z.object({ en: z.string().min(1), it: z.string().min(1) });
const period = z.enum(['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second']);
const scope = z.string().regex(/^(world|[A-Z]{3})$/, 'scope must be "world" or an ISO 3166-1 alpha-3 code');
const isoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'expected YYYY, YYYY-MM or YYYY-MM-DD');

export const seriesPointSchema = z.object({
  scope,
  year: z.number().int().min(1800).max(2100),
  value: z.number().finite(),
  period: period.optional(),
  sourceId: z.string().min(1),
  confidence: z.enum(['official', 'estimate', 'modelled']),
  note: z.string().optional(),
});

export const sourceSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  published: isoDate.optional(),
  accessed: isoDate,
});

const temporalProfile = z.union([
  z.enum(NAMED_PROFILES),
  z.object({
    hourly: z
      .array(z.number().finite().nonnegative())
      .length(24)
      .refine((h) => h.some((v) => v > 0), 'hourly profile must not be all zeros'),
  }),
]);

export const seriesTableSchema = z.object({
  sourceId: z.string().min(1),
  confidence: z.enum(['official', 'estimate', 'modelled']),
  period: period.optional(),
  note: z.string().optional(),
  years: z.array(z.number().int().min(1800).max(2100)).min(1),
  values: z.record(scope, z.array(z.number().finite().nullable())),
});

export const metricFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    category: z.enum(CATEGORY_IDS),
    name: i18nText,
    description: i18nText,
    unit: z.enum(UNIT_IDS),
    unitLabel: i18nText,
    kind: z.enum(['flow', 'stock']),
    temporalProfile: temporalProfile.optional(),
    allocation: z.object({ proxy: z.string().min(1), exclude: z.array(z.string().length(3)).optional() }).optional(),
    resolution: z.object({ maxYearGap: z.number().int().min(0).max(200).optional() }).optional(),
    visual: z
      .object({
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        icon: z.string().optional(),
        scale: z.enum(['linear', 'sqrt', 'log']).optional(),
      })
      .optional(),
    featured: z.boolean().optional(),
    series: z.array(seriesPointSchema).optional(),
    tables: z.array(seriesTableSchema).optional(),
    sources: z.record(z.string(), sourceSchema),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    const used = new Set<string>();
    let count = 0;
    const check = (p: { scope: string; year: number; value: number; period?: string; sourceId: string }, path: (string | number)[]) => {
      count++;
      used.add(p.sourceId);
      if (!m.sources[p.sourceId]) ctx.addIssue({ code: 'custom', path, message: `unknown source "${p.sourceId}"` });
      if (m.kind === 'flow' && !p.period) ctx.addIssue({ code: 'custom', path, message: 'flow points need a period' });
      if (p.value < 0) ctx.addIssue({ code: 'custom', path, message: 'negative values are not supported' });
      const key = `${p.scope}:${p.year}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path, message: `duplicate point ${key}` });
      seen.add(key);
    };
    (m.series ?? []).forEach((p, i) => check(p, ['series', i]));
    (m.tables ?? []).forEach((t, ti) => {
      if (new Set(t.years).size !== t.years.length) {
        ctx.addIssue({ code: 'custom', path: ['tables', ti, 'years'], message: 'years must be unique' });
      }
      for (const [scopeId, values] of Object.entries(t.values)) {
        if (values.length !== t.years.length) {
          ctx.addIssue({ code: 'custom', path: ['tables', ti, 'values', scopeId], message: `expected ${t.years.length} values, got ${values.length}` });
          continue;
        }
        values.forEach((value, yi) => {
          if (value === null) return;
          check({ scope: scopeId, year: t.years[yi], value, period: t.period, sourceId: t.sourceId }, ['tables', ti, 'values', scopeId, yi]);
        });
      }
    });
    if (count === 0) ctx.addIssue({ code: 'custom', path: ['series'], message: 'metric has no data points' });
    if (m.temporalProfile && typeof m.temporalProfile !== 'string') {
      try {
        normalizeHourly(m.temporalProfile.hourly);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['temporalProfile'], message: (e as Error).message });
      }
    }
    for (const id of Object.keys(m.sources)) {
      if (!used.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['sources', id], message: `source "${id}" is never referenced` });
      }
    }
  }) satisfies z.ZodType<MetricFile>;

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  defaultMetric: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1),
  proxies: z.array(z.string().min(1)),
}) satisfies z.ZodType<Manifest>;

export interface CountryRecord {
  i: number;
  iso3: string;
  iso2: string | null;
  num: string | null;
  name: { en: string; it: string };
  aliases: string[];
  /** [lng, lat] display centroid. */
  c: [number, number];
  tz: string;
  areaKm2: number;
  disputed?: boolean;
}

export const countriesFileSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  countries: z.array(
    z.object({
      i: z.number().int().positive(),
      iso3: z.string().length(3),
      iso2: z.string().length(2).nullable(),
      num: z.string().nullable(),
      name: i18nText,
      aliases: z.array(z.string()),
      c: z.tuple([z.number(), z.number()]),
      tz: z.string(),
      areaKm2: z.number().nonnegative(),
      disputed: z.boolean().optional(),
    }),
  ),
});

export type CountriesFile = z.infer<typeof countriesFileSchema>;

/** Formats zod issues as short human-readable lines. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
