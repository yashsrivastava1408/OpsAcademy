/**
 * Supabase Store — cloud persistence for OpsAcademy.
 *
 * Implements the same synchronous interface as JsonStore and SqliteStore
 * with an in-memory write-through cache backed by Supabase PostgreSQL.
 *
 * - The whole `documents` table is loaded (paginated) before the store reports
 *   ready; `await store.ready()` must resolve before serving requests.
 * - Reads are served from memory; writes are persisted in the background with
 *   retries. Failures are counted and make `isWritable()` false until a later
 *   write succeeds, and `flush()` waits for every pending write.
 * - An existing store.json is imported at most once (tracked by a marker row).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const logger = require('./logger');

const PAGE_SIZE = 1000;
const WRITE_ATTEMPTS = 3;
const RETRY_BASE_MS = 200;
const IMPORT_BATCH = 100;
const META_COLLECTION = '_meta';
const IMPORT_MARKER = 'json_import';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class SupabaseStore {
  /**
   * @param {object} options
   * @param {string} options.supabaseUrl
   * @param {string} options.supabaseKey (service role secret key)
   * @param {string} [options.importPath] store.json to import once on first run
   * @param {object} [options.client] injected Supabase client (tests)
   * @param {number} [options.retryBaseMs]
   */
  constructor({ supabaseUrl, supabaseKey, importPath = null, client = null, retryBaseMs = RETRY_BASE_MS } = {}) {
    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key = supabaseKey || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;

    if (!client && (!url || !key)) {
      throw new Error('SupabaseStore requires SUPABASE_URL and SUPABASE_SECRET_KEY');
    }

    this.supabase =
      client ||
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

    this.importPath = importPath;
    this.retryBaseMs = retryBaseMs;
    this.data = {};
    this.pendingWrites = new Set();
    this.initialized = false;
    this.initError = null;
    this.writeFailures = 0;
    this.lastWriteError = null;
    this.writeHealthy = true;

    this._initPromise = this.init();
  }

  /** Resolves when the preload (and one-time import) finished; rejects if it failed. */
  ready() {
    return this._initPromise.then((ok) => {
      if (!ok) throw this.initError || new Error('SupabaseStore failed to initialise');
      return true;
    });
  }

  async loadAll() {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.supabase
        .from('documents')
        .select('collection, id, doc')
        .order('collection', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async init() {
    try {
      const rows = await this.loadAll();
      for (const row of rows) {
        if (!this.data[row.collection]) this.data[row.collection] = {};
        this.data[row.collection][row.id] = row.doc;
      }
      logger.info({ count: rows.length }, '[SupabaseStore] Preloaded documents from Supabase');

      await this.importOnce();

      this.initialized = true;
      return true;
    } catch (err) {
      logger.error({ err: err.message }, '[SupabaseStore] Init failed');
      this.initError = err;
      return false;
    }
  }

  /** Import store.json once; a marker row stops later boots from re-importing. */
  async importOnce() {
    if (!this.importPath || !fs.existsSync(this.importPath)) return 0;
    if (this.get(META_COLLECTION, IMPORT_MARKER)) return 0;

    const imported = await this.importJson(this.importPath);
    const marker = { importedAt: new Date().toISOString(), imported };
    this.collection(META_COLLECTION)[IMPORT_MARKER] = marker;
    await this.persist(() =>
      this.supabase.from('documents').upsert({
        collection: META_COLLECTION,
        id: IMPORT_MARKER,
        doc: marker,
        updated_at: new Date().toISOString(),
      }),
    );
    return imported;
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = {};
    return this.data[name];
  }

  get(name, id) {
    const doc = this.collection(name)[String(id)];
    return doc === undefined ? null : structuredClone(doc);
  }

  /**
   * Run a Supabase write with retries. Resolves true on success; on final
   * failure records it (writeFailures, lastWriteError, writeHealthy=false).
   */
  async persist(run, label = 'write') {
    let lastError = null;
    for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
      try {
        const { error } = await run();
        if (!error) {
          this.writeHealthy = true;
          return true;
        }
        lastError = new Error(error.message);
      } catch (err) {
        lastError = err;
      }
      if (attempt < WRITE_ATTEMPTS) await sleep(this.retryBaseMs * 2 ** (attempt - 1));
    }
    this.writeFailures += 1;
    this.lastWriteError = lastError.message;
    this.writeHealthy = false;
    logger.error({ err: lastError.message, label }, '[SupabaseStore] Write failed after retries');
    return false;
  }

  track(promise) {
    const tracked = promise.finally(() => this.pendingWrites.delete(tracked));
    this.pendingWrites.add(tracked);
    return tracked;
  }

  set(name, id, doc) {
    const cloned = structuredClone(doc);
    const strId = String(id);
    this.collection(name)[strId] = cloned;

    this.track(
      this.persist(
        () =>
          this.supabase.from('documents').upsert({
            collection: name,
            id: strId,
            doc: cloned,
            updated_at: new Date().toISOString(),
          }),
        `upsert ${name}/${strId}`,
      ),
    );

    // Keep public.profiles in step for convenience.
    if (name === 'users' && doc.id) this.syncProfile(doc);

    return doc;
  }

  syncProfile(user) {
    this.track(
      this.persist(
        () =>
          this.supabase.from('profiles').upsert({
            id: String(user.id),
            name: user.name || null,
            email: user.email || null,
            guest: Boolean(user.guest),
            profile_slug: user.profileSlug || null,
            updated_at: new Date().toISOString(),
          }),
        `profile ${user.id}`,
      ),
    );
  }

  delete(name, id) {
    const strId = String(id);
    const existed = strId in this.collection(name);
    delete this.collection(name)[strId];

    if (existed) {
      this.track(
        this.persist(
          () => this.supabase.from('documents').delete().match({ collection: name, id: strId }),
          `delete ${name}/${strId}`,
        ),
      );
    }

    return existed;
  }

  all(name) {
    return Object.values(this.collection(name)).map((doc) => structuredClone(doc));
  }

  find(name, predicate) {
    return this.all(name).filter(predicate);
  }

  /** Wait for every in-flight write (also those queued while waiting). */
  async flush() {
    while (this.pendingWrites.size > 0) {
      await Promise.allSettled(Array.from(this.pendingWrites));
    }
  }

  /** True once loaded and while the latest write succeeded. */
  isWritable() {
    return this.initialized && !this.initError && this.writeHealthy;
  }

  /** Import records from a store.json path or a plain object; returns the count. */
  async importJson(source) {
    let payload = null;
    if (typeof source === 'string' && fs.existsSync(source)) {
      try {
        payload = JSON.parse(fs.readFileSync(source, 'utf8'));
      } catch (err) {
        logger.warn({ err: err.message }, '[SupabaseStore] Could not read import file');
        return 0;
      }
    } else if (typeof source === 'object') {
      payload = source;
    }

    if (!payload) return 0;

    let imported = 0;
    const rows = [];
    for (const [col, items] of Object.entries(payload)) {
      if (typeof items !== 'object' || items === null) continue;
      for (const [id, doc] of Object.entries(items)) {
        const strId = String(id);
        // Never overwrite a document that already lives in Supabase.
        if (strId in this.collection(col)) continue;
        this.collection(col)[strId] = structuredClone(doc);
        rows.push({ collection: col, id: strId, doc, updated_at: new Date().toISOString() });
        imported += 1;
      }
    }

    for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
      const batch = rows.slice(i, i + IMPORT_BATCH);
      const ok = await this.persist(() => this.supabase.from('documents').upsert(batch), 'import batch');
      if (!ok) throw new Error(`Import failed: ${this.lastWriteError}`);
    }
    if (imported > 0) logger.info({ imported }, '[SupabaseStore] Imported records to Supabase');

    return imported;
  }
}

module.exports = { SupabaseStore, PAGE_SIZE };
