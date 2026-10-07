/**
 * JSON file store — small persistence layer for users, progress and certificates.
 *
 * Everything lives in memory and is written to one file with an atomic
 * rename, so a crash mid-write cannot corrupt it. It is single-process only:
 * run one gateway replica, or swap this module for a database adapter with
 * the same get/set/all interface before scaling out.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string|null} filePath  null keeps the store in memory only (tests).
   */
  constructor(filePath = null, { debounceMs = 200 } = {}) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
    this.data = {};
    this.timer = null;
    this.dirty = false;

    if (filePath && fs.existsSync(filePath)) {
      this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = {};
    return this.data[name];
  }

  get(name, id) {
    const doc = this.collection(name)[id];
    return doc === undefined ? null : structuredClone(doc);
  }

  set(name, id, doc) {
    this.collection(name)[id] = structuredClone(doc);
    this.schedule();
    return doc;
  }

  delete(name, id) {
    const existed = id in this.collection(name);
    delete this.collection(name)[id];
    if (existed) this.schedule();
    return existed;
  }

  all(name) {
    return Object.values(this.collection(name)).map((doc) => structuredClone(doc));
  }

  find(name, predicate) {
    return this.all(name).filter(predicate);
  }

  schedule() {
    this.dirty = true;
    if (!this.filePath || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref();
  }

  /** Write pending changes to disk now. Safe to call at shutdown. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.filePath || !this.dirty) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
  }

  /** True if the backing directory can be written (used by the readiness probe). */
  isWritable() {
    if (!this.filePath) return true;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.accessSync(path.dirname(this.filePath), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

let defaultStore = null;

function getStore() {
  if (!defaultStore) {
    const config = require('../config');
    defaultStore = new JsonStore(config.isTest ? null : path.join(config.dataDir, 'store.json'));
  }
  return defaultStore;
}

/** Replace the shared store (tests). */
function setStore(store) {
  defaultStore = store;
}

module.exports = { JsonStore, getStore, setStore };
