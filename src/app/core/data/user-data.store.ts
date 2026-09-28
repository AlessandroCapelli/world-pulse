import { inject, Injectable, signal } from '@angular/core';
import type { IDBPDatabase } from 'idb';
import { MetricFile } from '../engine/types';
import { CatalogService } from './catalog.service';

const DB_NAME = 'world-pulse';
const STORE = 'user-metrics';

/** Persists user-uploaded datasets in IndexedDB (this browser only) and feeds them to the catalog. */
@Injectable({ providedIn: 'root' })
export class UserDataStore {
  private readonly catalog = inject(CatalogService);
  private db: Promise<IDBPDatabase> | null = null;
  readonly available = signal(true);
  readonly restored = signal(false);

  private open(): Promise<IDBPDatabase> {
    this.db ??= import('idb').then(({ openDB }) =>
      openDB(DB_NAME, 1, {
        upgrade(db) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        },
      }),
    );
    return this.db;
  }

  async restore(): Promise<void> {
    try {
      const db = await this.open();
      const files = (await db.getAll(STORE)) as MetricFile[];
      this.catalog.setUserMetrics(files);
    } catch {
      this.available.set(false);
    } finally {
      this.restored.set(true);
    }
  }

  async save(file: MetricFile): Promise<void> {
    const db = await this.open();
    await db.put(STORE, file);
    this.catalog.setUserMetrics([...this.catalog.userMetrics().filter((f) => f.id !== file.id), file]);
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    await db.delete(STORE, id);
    this.catalog.setUserMetrics(this.catalog.userMetrics().filter((f) => f.id !== id));
  }
}
