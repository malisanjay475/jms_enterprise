'use strict';

/**
 * ERP Masters (Item / Variant / Party / Rate) copied from Smart Ops.
 *
 *   JOYO ERP --5 min--> Smart Ops --5 min--> JMS (MAIN)
 *
 * JMS never calls the ERP for these. Smart Ops already pulls them from the ERP
 * and serves the changed rows by cursor (since + after_id). We keep the cursor
 * per master in smartops_sync_state and upsert by Smart Ops' row id, so reading
 * a row twice is harmless. Each tick re-reads 15 minutes behind the cursor:
 * Smart Ops writes one ERP fetch in a single transaction, so a few rows can land
 * slightly behind a cursor we already passed.
 *
 * Runs on MAIN only, in one PM2 worker, once at start and every
 * SMARTOPS_SYNC_MINUTES (default 5). Without SMARTOPS_URL / USER / PASS it logs
 * "Smart Ops sync not configured" once and does nothing; the pages still load.
 */

/* Columns we copy, in table order. Any other field Smart Ops sends is ignored.
   type: t text, i integer, n numeric, b boolean. Keep in sync with
   migrations/017_erp_masters_smartops.sql and PUBLIC/erp_masters.html. */
const MASTERS = {
  item: {
    table: 'jo_erp_item_master',
    cols: [['item_id', 'i'], ['item_code', 't'], ['item_name', 't'], ['uom', 't'], ['tax_rate', 'n'],
      ['category', 't'], ['project_id', 't'], ['project_name', 't'], ['item_weight', 'n'],
      ['hsn_code', 't'], ['is_active', 'b'], ['action', 't']]
  },
  variant: {
    table: 'jo_erp_variant_master',
    cols: [['item_id', 'i'], ['our_code', 't'], ['our_name', 't'], ['party_code', 't'], ['party', 't'],
      ['party_item_name', 't'], ['party_item_code', 't'], ['po_item_name', 't'], ['party_item_barcode', 't'],
      ['party_group', 't'], ['party_packing_size', 't'], ['our_party_item_code', 't'], ['content', 't'],
      ['capacity', 't'], ['barcode_item_name', 't'], ['barcode_outer_label_item_code', 't'], ['remarks', 't'],
      ['gross_weight', 'n'], ['inner_carton_qty', 'n'], ['vendor_code', 't'], ['number_of_design', 'i'],
      ['number_of_color', 'i'], ['outer_label_category', 't'], ['outer_l', 'n'], ['outer_w', 'n'],
      ['outer_h', 'n'], ['per_pkg_cbm', 'n'], ['action', 't']]
  },
  party: {
    table: 'jo_erp_party_master',
    cols: [['party_id', 'i'], ['party_code', 't'], ['party_group', 't'], ['price_group', 't'],
      ['party_name', 't'], ['party_type', 't'], ['gstin', 't'], ['pan', 't'], ['is_unregistered_for_gst', 't'],
      ['payment_term', 't'], ['credit_days', 'i'], ['sales_person', 't'], ['address', 't'], ['city', 't'],
      ['state', 't'], ['pincode', 't'], ['contact_number', 't'], ['email', 't'], ['is_active', 'b'], ['action', 't']]
  },
  rate: {
    table: 'jo_erp_rate_master',
    cols: [['item_id', 'i'], ['our_code', 't'], ['our_name', 't'], ['party_item_name', 't'],
      ['party_item_code', 't'], ['po_item_name', 't'], ['party_group', 't'], ['price_group', 't'],
      ['factory_id', 'i'], ['factory', 't'], ['uom', 't'], ['mrp_price', 'n'], ['offer_price', 'n'],
      ['rate', 'n'], ['effective_date', 't']]
  }
};

const PAGE_LIMIT = 5000;
const INSERT_BATCH = 500;
const OVERLAP = '15 minutes';
const TOKEN_TTL_MS = 23 * 3600 * 1000; // Smart Ops tokens last 24 h
const HTTP_TIMEOUT_MS = 120 * 1000;
const LOCK_KEY = 74102611; // pg advisory lock: one sync at a time across workers / instances

const isMain = () => String(process.env.SERVER_TYPE || 'MAIN').toUpperCase() === 'MAIN';
const baseUrl = () => String(process.env.SMARTOPS_URL || '').trim().replace(/\/+$/, '');
const isConfigured = () => Boolean(baseUrl() && process.env.SMARTOPS_USER && process.env.SMARTOPS_PASS);
function intervalMs() {
  const m = Number(process.env.SMARTOPS_SYNC_MINUTES);
  return (Number.isFinite(m) && m >= 1 ? m : 5) * 60 * 1000;
}

/* ---- values ---- */
function toValue(v, type) {
  if (v === undefined || v === null) return null;
  if (type === 't') return typeof v === 'object' ? JSON.stringify(v) : String(v);
  const s = String(v).trim();
  if (type === 'b') {
    if (typeof v === 'boolean') return v;
    if (/^(true|t|yes|y|1|active)$/i.test(s)) return true;
    if (/^(false|f|no|n|0|inactive)$/i.test(s)) return false;
    return null;
  }
  if (s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return type === 'i' ? Math.trunc(n) : s.replace(/,/g, '');
}

/* ---- Smart Ops HTTP ---- */
let token = null;
let tokenAt = 0;

async function login() {
  const res = await fetch(`${baseUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.SMARTOPS_USER, password: process.env.SMARTOPS_PASS }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(`Smart Ops login failed (HTTP ${res.status}${body.error ? `: ${body.error}` : ''})`);
  token = body.token;
  tokenAt = Date.now();
}

async function smartopsGet(path) {
  if (!token || Date.now() - tokenAt > TOKEN_TTL_MS) await login();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      token = null;
      await login();
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(`Smart Ops ${path.split('?')[0]} failed (HTTP ${res.status}${body && body.error ? `: ${body.error}` : ''})`);
    return body;
  }
}

/* ---- DB ---- */
async function upsertRows(client, def, rows) {
  const names = ['smartops_id', ...def.cols.map(c => c[0]), 'synced_at'];
  const updates = names.slice(1).map(n => `${n} = EXCLUDED.${n}`).concat('local_updated_at = now()').join(', ');
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH).filter(r => r && r.id !== undefined && r.id !== null);
    if (!chunk.length) continue;
    // A page can hold the same id twice only if Smart Ops changed it mid-read; keep the last.
    const byId = new Map(chunk.map(r => [String(r.id), r]));
    const params = [];
    const tuples = [];
    for (const r of byId.values()) {
      const vals = [String(r.id), ...def.cols.map(([n, t]) => toValue(r[n], t)),
        r.synced_at === undefined || r.synced_at === null ? null : String(r.synced_at)];
      tuples.push(`(${vals.map(v => { params.push(v); return `$${params.length}`; }).join(', ')})`);
    }
    await client.query(
      `INSERT INTO ${def.table} (${names.join(', ')}) VALUES ${tuples.join(', ')}
       ON CONFLICT (smartops_id) DO UPDATE SET ${updates}`, params);
  }
}

async function syncMaster(pool, key, remoteCount) {
  const def = MASTERS[key];
  const started = Date.now();
  let received = 0;

  const local = await pool.query(`SELECT count(*)::int AS n FROM ${def.table}`);
  if (Number.isFinite(Number(remoteCount)) && Number(remoteCount) < local.rows[0].n) {
    // Smart Ops cleared and re-fetched this master: our copy holds rows it no longer has.
    console.log(`[smartops-sync] ${key}: Smart Ops has ${remoteCount} rows, we have ${local.rows[0].n}; reloading in full`);
    await pool.query(`TRUNCATE ${def.table}`);
    await pool.query('UPDATE smartops_sync_state SET since = NULL, after_id = NULL WHERE master_key = $1', [key]);
  }

  const st = await pool.query(
    `SELECT CASE WHEN since IS NULL OR since = '' THEN NULL ELSE
       to_char((since::timestamptz - interval '${OVERLAP}') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'
     END AS since
     FROM smartops_sync_state WHERE master_key = $1`, [key]);
  let since = st.rows[0] ? st.rows[0].since : null;
  let afterId = since ? 0 : null;

  for (;;) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (since) { qs.set('since', since); qs.set('after_id', String(afterId || 0)); }
    const page = await smartopsGet(`/api/erp/masters/${key}/rows?${qs}`);
    const rows = Array.isArray(page.rows) ? page.rows : [];
    received += rows.length;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await upsertRows(client, def, rows);
      // next_since is stored exactly as received (microseconds), never via a JS Date.
      if (page.next_since !== undefined && page.next_since !== null) {
        await client.query(
          `INSERT INTO smartops_sync_state (master_key, since, after_id, status) VALUES ($1, $2, $3, 'never')
           ON CONFLICT (master_key) DO UPDATE SET since = EXCLUDED.since, after_id = EXCLUDED.after_id`,
          [key, String(page.next_since), page.next_after_id === undefined || page.next_after_id === null ? null : String(page.next_after_id)]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (!page.has_more || !rows.length) break;
    since = page.next_since === undefined || page.next_since === null ? since : String(page.next_since);
    afterId = page.next_after_id === undefined || page.next_after_id === null ? afterId : page.next_after_id;
  }

  await pool.query(
    `UPDATE smartops_sync_state
        SET status = 'ok', row_count = (SELECT count(*) FROM ${def.table}),
            last_success_at = now(), last_error = NULL
      WHERE master_key = $1`, [key]);
  console.log(`[smartops-sync] ${key}: ${received} rows received in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function markError(pool, key, err) {
  await pool.query(
    `INSERT INTO smartops_sync_state (master_key, status, last_error, last_run_at) VALUES ($1, 'error', $2, now())
     ON CONFLICT (master_key) DO UPDATE SET status = 'error', last_error = EXCLUDED.last_error, last_run_at = now()`,
    [key, String(err && err.message || err).slice(0, 1000)]).catch(() => {});
}

let running = false;

/* One full pass over the four masters. Returns { ok, skipped?, error? }. */
async function runSync(pool) {
  if (!isConfigured()) return { ok: false, error: 'Smart Ops sync not configured' };
  if (running) return { ok: false, skipped: true, error: 'A sync is already running' };
  running = true;
  const lock = await pool.connect();
  try {
    const got = await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!got.rows[0].ok) return { ok: false, skipped: true, error: 'A sync is already running' };
    try {
      let list;
      try {
        const body = await smartopsGet('/api/erp/masters');
        list = Array.isArray(body.masters) ? body.masters : [];
      } catch (err) {
        console.warn('[smartops-sync]', err.message);
        for (const key of Object.keys(MASTERS)) await markError(pool, key, err);
        return { ok: false, error: err.message };
      }
      const remote = new Map(list.map(m => [m.key, m]));
      let failed = 0;
      for (const key of Object.keys(MASTERS)) {
        try {
          if (!remote.has(key)) throw new Error(`Smart Ops does not list master "${key}"`);
          await syncMaster(pool, key, remote.get(key).row_count);
        } catch (err) {
          failed++;
          console.warn(`[smartops-sync] ${key}:`, err.message);
          await markError(pool, key, err);
        } finally {
          await pool.query('UPDATE smartops_sync_state SET last_run_at = now() WHERE master_key = $1', [key]).catch(() => {});
        }
      }
      return failed ? { ok: false, error: `${failed} master(s) failed; see status` } : { ok: true };
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    lock.release();
    running = false;
  }
}

function isPrimaryWorker() {
  const inst = process.env.NODE_APP_INSTANCE;
  return inst === undefined || inst === '' || inst === '0';
}

function startSmartopsSync(pool) {
  if (startSmartopsSync.started || process.env.NODE_ENV === 'test' || !pool) return;
  startSmartopsSync.started = true;
  if (!isMain() || !isPrimaryWorker()) return;
  if (!isConfigured()) {
    console.log('[smartops-sync] Smart Ops sync not configured');
    return;
  }
  const tick = () => runSync(pool).catch(err => console.warn('[smartops-sync]', err.message));
  const first = setTimeout(tick, 30 * 1000); // once on start, after boot settles
  if (first.unref) first.unref();
  const timer = setInterval(tick, intervalMs());
  if (timer.unref) timer.unref();
}

module.exports = { MASTERS, runSync, startSmartopsSync, isConfigured, isMain, __test: { toValue } };
