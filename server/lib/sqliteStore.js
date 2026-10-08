/**
 * SQLite store — the same interface as JsonStore, backed by a database file.
 *
 * Each document is one row, so saving one learner's progress writes one row
 * instead of rewriting every account, and a crash cannot lose more than the
 * write in flight. It uses the SQLite that ships with Node (node:sqlite), so
 * there is nothing to install.
 *
 * It is still a single-node store: one gateway process owns the file. Running
 * several gateway replicas needs a network database (Postgres) and an async
 * store interface; see docs in README "Limitations".
 */

const fs = require('fs');
const path = require('path');

class SqliteStore {
  /**
   * @param {string} filePath  database file, or ':memory:' for tests
   */
  constructor(filePath) {
    // Required here, not at the top: the JSON store must keep working on a
    // Node build without node:sqlite.
    const { DatabaseSync } = require('node:sqlite');

    this.filePath = filePath;
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    // WAL: readers are not blocked by a write, and a commit is one append.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        doc        TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      ) WITHOUT ROWID
    `);

    this.statements = {
      get: this.db.prepare('SELECT doc FROM documents WHERE collection = ? AND id = ?'),
      set: this.db.prepare('INSERT INTO documents (collection, id, doc) VALUES (?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET doc = excluded.doc'),
      delete: this.db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?'),
      all: this.db.prepare('SELECT doc FROM documents WHERE collection = ?'),
    };
  }

  get(name, id) {
    const row = this.statements.get.get(name, String(id));
    return row ? JSON.parse(row.doc) : null;
  }

  set(name, id, doc) {
    this.statements.set.run(name, String(id), JSON.stringify(doc));
    return doc;
  }

  delete(name, id) {
    return this.statements.delete.run(name, String(id)).changes > 0;
  }

  all(name) {
    return this.statements.all.all(name).map((row) => JSON.parse(row.doc));
  }

  find(name, predicate) {
    return this.all(name).filter(predicate);
  }

  /** Every write is committed as it happens; nothing is pending. */
  flush() {}

  isWritable() {
    try {
      this.db.exec('BEGIN IMMEDIATE; ROLLBACK;');
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.db.close();
  }

  /**
   * Copy every document from a JsonStore file into this database (first
   * start after switching STORE_DRIVER). Existing rows are left alone.
   * @returns {number} documents copied
   */
  importJson(jsonPath) {
    if (!fs.existsSync(jsonPath)) return 0;
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const insert = this.db.prepare('INSERT OR IGNORE INTO documents (collection, id, doc) VALUES (?, ?, ?)');
    let copied = 0;
    this.db.exec('BEGIN');
    try {
      for (const [collection, docs] of Object.entries(data)) {
        for (const [id, doc] of Object.entries(docs)) {
          copied += Number(insert.run(collection, id, JSON.stringify(doc)).changes);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return copied;
  }
}

module.exports = { SqliteStore };
