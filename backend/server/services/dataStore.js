/**
 * DataStore – Armazena configurações em arquivo JSON ou MongoDB
 * Convertido de CJS para ESM
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

export class DataStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = null;
    this.readyPromise = null;
  }

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.load();
    }
    return this.readyPromise;
  }

  async load() {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.data = { ...this.defaults };
        await this.save();
      } else {
        console.error('[DataStore] Falha ao ler arquivo:', error);
        this.data = { ...this.defaults };
      }
    }
    return this.data;
  }

  async save() {
    if (!this.data) this.data = { ...this.defaults };
    const tmpPath = `${this.filePath}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    await fsp.rename(tmpPath, this.filePath);
  }

  async get(key, fallback = undefined) {
    await this.ensureReady();
    if (!key) return this.data;
    const value = key.split('.').reduce((acc, part) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, part)) return acc[part];
      return undefined;
    }, this.data);
    return value === undefined ? fallback : value;
  }

  async set(key, value) {
    await this.ensureReady();
    if (!key) {
      this.data = value;
    } else {
      const parts = key.split('.');
      let cursor = this.data;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
        cursor = cursor[part];
      }
      cursor[parts[parts.length - 1]] = value;
    }
    await this.save();
    return value;
  }

  async update(key, updater) {
    await this.ensureReady();
    const current = await this.get(key);
    const nextValue = typeof updater === 'function' ? updater(current) : updater;
    await this.set(key, nextValue);
    return nextValue;
  }
}

/**
 * MongoDataStore – Mesma interface do DataStore, mas persiste no MongoDB.
 * Collection: app_settings  |  Cada chave de primeiro nível = um documento (_id = key).
 */
export class MongoDataStore {
  constructor(getDbFn) {
    this._getDb = getDbFn;
    this._collection = null;
    this._readyPromise = null;
  }

  async ensureReady() {
    if (!this._readyPromise) {
      this._readyPromise = this._init();
    }
    return this._readyPromise;
  }

  async _init() {
    const db = await this._getDb();
    this._collection = db.collection('app_settings');
  }

  async _col() {
    await this.ensureReady();
    return this._collection;
  }

  async get(key, fallback = undefined) {
    const col = await this._col();
    if (!key) {
      const docs = await col.find({}).toArray();
      const result = {};
      for (const doc of docs) {
        const { _id, ...rest } = doc;
        result[_id] = rest.value !== undefined ? rest.value : rest;
      }
      return result;
    }
    const topKey = key.split('.')[0];
    const doc = await col.findOne({ _id: topKey });
    if (!doc) return fallback;
    let value = doc.value !== undefined ? doc.value : (() => { const { _id, ...rest } = doc; return rest; })();
    const subPath = key.split('.').slice(1);
    for (const part of subPath) {
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)) {
        value = value[part];
      } else {
        return fallback;
      }
    }
    return value === undefined ? fallback : value;
  }

  async set(key, value) {
    const col = await this._col();
    if (!key) return value;
    const topKey = key.split('.')[0];
    const subPath = key.split('.').slice(1);

    if (!subPath.length) {
      await col.updateOne(
        { _id: topKey },
        { $set: { _id: topKey, value, updatedAt: new Date() } },
        { upsert: true }
      );
    } else {
      const doc = await col.findOne({ _id: topKey });
      let root = doc?.value !== undefined ? doc.value : {};
      if (!root || typeof root !== 'object') root = {};
      let cursor = root;
      for (let i = 0; i < subPath.length - 1; i++) {
        if (!cursor[subPath[i]] || typeof cursor[subPath[i]] !== 'object') cursor[subPath[i]] = {};
        cursor = cursor[subPath[i]];
      }
      cursor[subPath[subPath.length - 1]] = value;
      await col.updateOne(
        { _id: topKey },
        { $set: { _id: topKey, value: root, updatedAt: new Date() } },
        { upsert: true }
      );
    }
    return value;
  }

  async update(key, updater) {
    const current = await this.get(key);
    const nextValue = typeof updater === 'function' ? updater(current) : updater;
    await this.set(key, nextValue);
    return nextValue;
  }
}
