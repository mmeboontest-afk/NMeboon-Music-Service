import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.resolve(config.dataDir, 'stats.json');

export class Stats extends EventEmitter {
  constructor() {
    super();
    this.data = { requests: {}, plays: {} };
    this.timer = null;
    this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      this.data.requests = raw.requests || {};
      this.data.plays = raw.plays || {};
    } catch {
      /* first run */
    }
  }

  #scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(this.data));
      } catch (e) {
        console.warn('[stats] could not save:', e.message);
      }
    }, 2000);
  }

  addRequest(id) {
    this.data.requests[id] = (this.data.requests[id] || 0) + 1;
    this.#scheduleSave();
    this.emit('change');
  }

  addPlay(id) {
    this.data.plays[id] = (this.data.plays[id] || 0) + 1;
    this.#scheduleSave();
    this.emit('change');
  }

  requests(id) {
    return this.data.requests[id] || 0;
  }

  plays(id) {
    return this.data.plays[id] || 0;
  }
}
