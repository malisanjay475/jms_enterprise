'use strict';

const fs = require('fs/promises');
const path = require('path');

function createRawEventStore(options = {}) {
  const baseDir = options.baseDir || path.join(process.cwd(), 'data', 'raw-events');

  async function persist(event) {
    const receivedAt = event.received_at || new Date().toISOString();
    const eventId = String(event.event_id || '').trim();

    if (!eventId) {
      throw new Error('event_id is required');
    }

    const date = new Date(receivedAt);
    const year = Number.isNaN(date.getTime()) ? 'unknown' : String(date.getUTCFullYear());
    const month = Number.isNaN(date.getTime()) ? 'unknown' : String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = Number.isNaN(date.getTime()) ? 'unknown' : String(date.getUTCDate()).padStart(2, '0');

    const eventDir = path.join(baseDir, year, month, day);
    const eventPath = path.join(eventDir, `${eventId}.json`);

    const payload = {
      event_id: eventId,
      factory_id: event.factory_id || null,
      source_type: event.source_type || 'device',
      source_id: event.source_id || null,
      event_type: event.event_type || 'device_event',
      occurred_at: event.occurred_at || receivedAt,
      received_at: receivedAt,
      payload: event.payload || {}
    };

    await fs.mkdir(eventDir, { recursive: true });

    try {
      await fs.writeFile(eventPath, `${JSON.stringify(payload, null, 2)}\n`, {
        flag: 'wx',
        encoding: 'utf8'
      });

      return {
        event: payload,
        duplicate: false,
        storage_path: eventPath
      };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        const existing = await fs.readFile(eventPath, 'utf8');
        return {
          event: JSON.parse(existing),
          duplicate: true,
          storage_path: eventPath
        };
      }

      throw error;
    }
  }

  return {
    persist
  };
}

module.exports = createRawEventStore;
