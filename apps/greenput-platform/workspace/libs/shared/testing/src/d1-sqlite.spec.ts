import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './d1-sqlite';

const SCHEMA = `
  CREATE TABLE parents (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
  CREATE TABLE children (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES parents(id)
  );
`;

describe('createSqliteD1', () => {
  it('runs bound inserts and reads them back through first() and all()', async () => {
    const { db, rows, close } = createSqliteD1({ sql: [SCHEMA] });

    await db
      .prepare('INSERT INTO parents (id, name) VALUES (?, ?)')
      .bind('p1', 'Ada')
      .run();

    const first = await db
      .prepare('SELECT * FROM parents WHERE id = ?')
      .bind('p1')
      .first<{ id: string; name: string }>();
    expect(first).toEqual({ id: 'p1', name: 'Ada' });

    const name = await db
      .prepare('SELECT name FROM parents WHERE id = ?')
      .bind('p1')
      .first<string>('name');
    expect(name).toBe('Ada');

    const all = await db.prepare('SELECT * FROM parents').all();
    expect(all.results).toEqual([{ id: 'p1', name: 'Ada' }]);
    expect(rows('parents')).toHaveLength(1);
    close();
  });

  it('resolves first() to null when there is no row', async () => {
    const { db, close } = createSqliteD1({ sql: [SCHEMA] });
    const row = await db
      .prepare('SELECT * FROM parents WHERE id = ?')
      .bind('missing')
      .first();
    expect(row).toBeNull();
    close();
  });

  it('enforces NOT NULL and FOREIGN KEY constraints like D1', async () => {
    const { db, close } = createSqliteD1({ sql: [SCHEMA] });

    await expect(
      db
        .prepare('INSERT INTO parents (id, name) VALUES (?, ?)')
        .bind('p1', null)
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed: parents.name/);

    await expect(
      db
        .prepare('INSERT INTO children (id, parent_id) VALUES (?, ?)')
        .bind('c1', 'nope')
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    close();
  });

  it('rejects undefined bind values the way D1 does', () => {
    const { db, close } = createSqliteD1({ sql: [SCHEMA] });
    expect(() =>
      db
        .prepare('INSERT INTO parents (id, name) VALUES (?, ?)')
        .bind('p1', undefined),
    ).toThrow(/D1_TYPE_ERROR/);
    close();
  });
});
