# OR-JR Status — ERP Auto-Sync (replace manual Excel upload)

**Goal:** stop downloading an Excel from the ERP and uploading it by hand. JR Status ERP
data already stored in JMS gets pushed into the OR-JR Status master (`or_jr_report`) with
one button — **filtered to the logged-in factory**, and writing **only the columns
OR-JR Status already has**.

**Status:** implemented and **verified end-to-end on staging 2026-07-28**. Released as v1.10.0.

Shipped in PRs #1072 (feature), #1074 (date/timezone + preview parity), #1075 (factory-code
seed), #1077 (confirm payload size).

### Staging verification results

| Check | Result |
|---|---|
| Factory partition (3 factories) | 8,474 + 388 + 3,983 = **12,845 = exactly the source row count**, 0 unresolved |
| Real import saved | 5,323 rows in 86s |
| **Idempotency** — re-run after save | 0 NEW, 0 UPDATE, **all 8,474 SKIP** |
| **Date accuracy** vs ERP text | **36,338 values, 100.00% exact match, 0 mismatches** |
| Factory isolation in `or_jr_report` | 9,777 rows, all `factory_id = 1`; plant codes JG + JGUI only |
| `remarks_all` | never blanked; existing values preserved |

Two bugs were caught only by running against real data, both fixed before release:
`Date` objects drifting a day across the Node/Postgres timezone boundary, and the preview
reporting `remarks_all` changes the save would never make.

**Still untested:** the Excel upload regression (needs a real file uploaded through the UI)
and how imported rows replicate to a LOCAL factory server.

---

## 0. The two stages

The ERP call and the OR-JR write are **separate jobs done by different people**.

```
STAGE 1 — superadmin only                    STAGE 2 — any Masters editor
"Fetch Latest Data" (ALREADY EXISTS)         "Import from ERP Data" (NEW)

  ERP API                                      erp_jr_status
  GetORJRStatus  ──────▶  erp_jr_status  ──────────────────▶  or_jr_report
                          (all factories)      filter to        (this factory only)
                                               login factory
                                               + review modal
```

Stage 2 **never calls the ERP** — it is a pure DB read of the snapshot Stage 1 left behind.
No ERP timeouts or credentials in the everyday path; no permission leak; ERP load stays
under superadmin control.

**Decisions:**
- **Flow:** button → review modal (NEW/UPDATE/SKIP) → "Confirm Update" saves.
- **Stage 1 access:** superadmin only — unchanged.
- **Stage 2 access:** anyone with Masters edit (`JPSMS.auth.can('masters','edit')`).
- **Scope:** only the logged-in factory's rows (§3).
- **Columns:** only the 36 columns OR-JR Status already has (§4).

---

## 1. Verified facts (live ERP + staging, 2026-07-27)

Raw ERP pulled directly from `http://erp.joyo.in:8464/api/Values/GetORJRStatus`
(reachable from a dev machine; JWT via `/api/Auth/token` with `{"UserName":"Sanjay"}`).

| Fact | Value |
|---|---|
| Live ERP response | **339 rows**, 253 Open / 86 Close — *not* a full dump |
| Stored `erp_jr_status` on staging | **12,625 rows**, last synced **2026-07-09** (accumulated; sync never deletes) |
| `or_jr_report` on staging | **6,021 rows**, all `factory_id = 1` (Dungra Plant 1) |
| Date formats | `dd-MMM-yy` (115,039 values) and `dd/MMM/yyyy` (25,146). **No ISO anywhere.** |
| 2-digit year span | 24–27 only → no century ambiguity |
| Row collapse on (OR, JC) | **zero** — 12,625 rows → 12,625 distinct keys |
| Numeric fields in raw JSON | real numbers (`orjrQty: 21600`); stored as TEXT |

### ⚠️ Correction to an earlier assumption

I previously suspected `mapErpJrStatusRow()` had wrong key names, because 14 fields were
100% empty in the stored snapshot. **That was wrong.** Every mapper key matches the raw ERP
response exactly. Those fields were empty because **the ERP started returning them after
2026-07-09**, which is when the stored snapshot was taken. The mapper needs no fixing.

Fields that went from empty → 100% filled: `orjrid`, `sno`, `factoryID`, `factory`,
`moulding`, `printing`, `packing`, `mouldingPrintingPacking`, `planQty`, `action`.

---

## 2. `remarks_all` — solved

Earlier this was the blocker: `remarks_all` is **required** in the Excel template
(`registerLegacyRoutes.js:508`, label `JC-Mld-Shift-Pur-Ptd/Tuft-Pkg-WH Remarks`), is 100%
filled in `or_jr_report`, drives plan→Job Card auto-linking (`:13170`), and appeared to be
absent from the API.

**It is present** — the ERP calls it `mouldingPrintingPacking`, 100% filled, exact same format:

```
(JC)Single pcs printed box with 12 pcs packing...- (M) ; Comp on -11.03.26 (13/03/2026)- (ST)- (PR)- (PK)- (PD)- (W)
```

Today the mapper sends it to `mld_prt_pack` (an ignored extra column). **Fix: map it to
`remarks_all` as well** — keep `mld_prt_pack` so the JR Status ERP report is unchanged.

Belt-and-braces: still `COALESCE(EXCLUDED.remarks_all, or_jr_report.remarks_all)` in the
confirm UPSERT, so a blank ERP value can never wipe an existing one.

---

## 3. Factory-wise split

### The mapping (confirmed against live ERP + owner)

| JMS factory | Plant | ERP `factoryID` | ERP `factory` | OR prefix |
|---|---|---:|---|---|
| 1 | Dungra Plant 1 | **41** | JOYO PLASTICS - DUNGRA - UNIT-I | `JG`, `JGUI` |
| F2 | Shivani | **44** | JOYO PLASTICS - SHIVANI, KACHIGAM | `JS` |
| F3 | Kachigam | **1** | JOYO PLASTICS - PREMIER, KACHIGAM | `JP` |

**🚨 The ID spaces collide.** ERP `factoryID = 1` is **Kachigam**, but JMS `factory_id = 1`
is **Dungra Plant 1**. Using the ERP number directly as the JMS number would silently file
Kachigam's orders under Dungra. An explicit mapping is mandatory — never a passthrough.

This also settles the JGUI question: **JGUI and JG are both `factoryID 41` (Dungra)**, so
JGUI belongs to Dungra Plant 1. No separate decision needed.

### Implementation

Add `factories.erp_factory_id INTEGER` (additive migration, editable from Masters later),
seeded 1→41. Filter: `erpRow.factory_id === factories.erp_factory_id` for the login factory.

### The legacy-rows problem

The 12,625 stored rows were synced **before** the ERP started sending `factoryID`, so they
all have `factory_id = null`. Filtering strictly by `factory_id` would match none of them.

**Fallback rule:** use `factory_id` when present; otherwise derive from the OR/JR number
prefix (`JR/JG/2526/1` → `JG`). The prefix↔factory correlation is confirmed by live data
(41→JG+JGUI, 1→JP, 44→JS) with no contradictions. Store the prefix list alongside
`erp_factory_id` on `factories`.

Rows that match neither are **excluded and counted**, never guessed into the login factory.

> Caveat: prefix↔factory was verified on 339 live rows, where JG appeared only 4 times.
> Worth re-confirming once a few more Stage 1 fetches have landed.

Also: 94 rows have an OR prefix different from their JC prefix (e.g. `JR/JS/…` with
`JC/JP/…`). **Filter on the OR number** — it is the row's identity.

---

## 4. Column-wise split — only the existing OR-JR Status columns

Strict whitelist of **36** columns; everything else in the ERP feed is ignored.

**Imported (36)** — `or_jr_no`, `or_jr_date`, `or_qty`, `jr_qty`, `job_card_no`,
`job_card_date`, `item_code`, `product_name`, `client_name`, `prod_plan_qty`, `std_pack`,
`uom`, `planned_comp_date`, `mld_start_date`, `mld_end_date`, `actual_mld_start_date`,
`prt_tuf_end_date`, `pack_end_date`, `mld_status`, `shift_status`, `prt_tuf_status`,
`pack_status`, `wh_status`, `rev_mld_end_date`, `shift_comp_date`, `rev_ptd_tuf_end_date`,
`rev_pak_end_date`, `wh_rec_date`, **`remarks_all`** (from `mouldingPrintingPacking`),
`jr_close`, `or_remarks`, `jr_remarks`, `created_by`, `created_date`, `edited_by`,
`edited_date`.

**Ignored ERP extras (14)** — `status` (duplicate of `jr_close`), `orjr_id`, `sno`,
`factory` (name; the id is used for filtering only, not written), `moulding`, `printing`,
`packing`, `mld_prt_pack`, `meeting_conclusion`, `wh_received_date`, `shift_remarks`,
`plan_qty`, `plan_date`, `erp_action`.

**JMS-internal columns never touched** — `plan_qty`, `plan_date`, `is_closed`,
`manual_closed_*`, `manual_reopened_*`, `is_deleted`, `global_id`, `sync_*`,
`last_updated_at`. `plan_qty`/`plan_date` are already excluded from the UPSERT's
`DO UPDATE` list (`:15697`), so they survive updates — verified, no change needed.

---

## 5. Stage 2 endpoint

`POST /api/upload/or-jr-erp-preview` — read-only against `erp_jr_status`, no network calls.

```
1. writeContext = getWritableFactoryContext(req, 'import OR-JR Status from ERP data')
     → single-factory login required (All-Factories is read-only)
   + require Masters edit permission

2. factory = SELECT id, erp_factory_id, plant_codes FROM factories WHERE id = <login factory>
     → if erp_factory_id is not configured: 409 "ERP factory ID not set for this factory."

3. snapshot = SELECT * FROM erp_jr_status
     → if empty: 409 "No ERP data yet. Ask a superadmin to press 'Fetch Latest Data'."

4. scoped = snapshot.filter(row =>
        row.factory_id ? Number(row.factory_id) === factory.erp_factory_id
                       : factory.plant_codes.includes(prefixOf(row.or_jr_no)))
     → count and report excluded / unresolvable rows

5. mapped = scoped.map(erpStatusRowToOrJrReportRow)   // 36-col whitelist, parseErpDate, toNum
6. run the EXISTING diff → NEW / UPDATE / SKIP + _changedFields
7. res.json({ ok, data, meta:{ snapshot_synced_at, snapshot_age_hours,
                               source_rows, other_factory, unresolved } })
```

Confirm step is **unchanged** — the frontend reuses `pendingUploadMode = 'server-orjr'` and
`POST /api/upload/or-jr-confirm`, inheriting the existing UPSERT + auto-link +
completion-sync.

### Date parsing (the one real remaining risk)

`toDate()` currently passes strings through untouched, handing `09-Oct-24` to Postgres.
Needs an explicit `parseErpDate()` for both `dd-MMM-yy` and `dd/MMM/yyyy` → `yyyy-mm-dd`,
`'' → null`. Must be round-trip tested: `or_jr_date` comes back from PG as
`2025-04-01T18:30:00.000Z` (IST-midnight artifact), and `toIsoDateText()` uses
`.toISOString()` — a mismatch here would either flag all 5,825 matched rows as spurious
UPDATEs or drift dates by one day on save.

### Volume — no longer a concern

Live ERP returns ~339 rows per fetch, and the factory filter cuts the accumulated store
further. Chunking is not needed; a single transaction is fine. Revisit only if a
future ERP change starts returning full dumps.

---

## 6. Frontend

`masters.html`, next to the existing OR-JR controls:

```html
<button id="orjrErpImportBtn" class="btn-action" onclick="importOrJrFromErpData()"
        style="background:#065f46; display:none">
  <i class="bi bi-database-down"></i> Import from ERP Data
</button>
<span id="orjrErpSnapshotAge" class="muted small" style="display:none"></span>
```

Named **"Import from ERP Data"**, not "Sync from ERP" — it must not imply a live ERP call.

`masters-script-2.js`:
- show in `setReportUI()` when `type === 'orjr'` **and** `JPSMS.auth.can('masters','edit')`
- `importOrJrFromErpData()` → POST → `pendingUploadMode = 'server-orjr'` → `showReviewModal(...)`
- modal header shows: factory scope, snapshot age (amber past 24h), and
  *"4,318 rows from other factories excluded."*

---

## 7. Work breakdown

| # | Task | Files |
|---|---|---|
| 1 | ~~Inspect real ERP data~~ | ✅ done |
| 2 | `factories.erp_factory_id` + `plant_codes` columns, additive migration, seed 1→41 | `registerLegacyRoutes.js` schema block |
| 3 | Map `remarks_all` ← `mouldingPrintingPacking` in `mapErpJrStatusRow()` | `:14795` |
| 4 | `parseErpDate()` for `dd-MMM-yy` + `dd/MMM/yyyy`, with round-trip test | `registerLegacyRoutes.js` |
| 5 | Extract `buildOrJrUploadPreview()` from the Excel preview route (pure refactor) | `:15568-15629` |
| 6 | `erpStatusRowToOrJrReportRow()` — 36-col whitelist + factory filter + prefix fallback | near `:14980` |
| 7 | `POST /api/upload/or-jr-erp-preview` | near `:15502` |
| 8 | `COALESCE` guard on `remarks_all` in the confirm UPSERT | `:15713` |
| 9 | Button + `importOrJrFromErpData()` + scope/staleness banner | `masters.html:458`, `masters-script-2.js` |
| 10 | Cache-bust masters script tag | `masters.html` |
| 11 | Version bump + `changelog.json` (module: Masters) | `BACKEND/PUBLIC/assets/changelog.json` |

---

## 8. Test plan

- [ ] `node --check BACKEND/src/legacy/registerLegacyRoutes.js`; `node server.js` boots clean
- [ ] Excel upload path still works **unchanged** (regression — task 5 touched it)
- [ ] "Fetch Latest Data" still works, still superadmin-only
- [ ] **Factory isolation:** logged into Dungra, JP/JS rows are excluded and the count shown
- [ ] **No cross-contamination:** no imported row carries an ERP factory ≠ 41
- [ ] Legacy `factory_id = null` rows resolve via prefix; unresolvable ones excluded, not guessed
- [ ] **Columns:** only the 36 whitelisted columns written; `plan_qty`/`plan_date`/`is_closed`/`sync_*` untouched
- [ ] `remarks_all` populated from `mouldingPrintingPacking` on new rows
- [ ] `remarks_all` on existing rows never blanked
- [ ] Plan → JC auto-link still fires after an import
- [ ] **Dates:** spot-check 10 rows against the ERP UI for one-day drift; `dd/MMM/yyyy` audit dates correct
- [ ] Import twice in a row → second run all `SKIP` (idempotent)
- [ ] Empty `erp_jr_status` → clear 409
- [ ] Import issues **no** ERP request (verify in logs)
- [ ] Plain Masters editor works; no-Masters-edit user gets 403 and no button
- [ ] All-Factories login → blocked read-only
- [ ] Test on **staging** (`72.62.228.195:9093`), never on the factory LOCAL server

---

## 9. Out of scope

- Scheduled/cron auto-sync — get the button right and watched first.
- Auto-triggering Stage 1 from Stage 2 — explicitly rejected.
- Changing the `or_jr_report` unique key (no collapse exists, so no need).
- Other ERP reports (summary / details / BOM / mould item) — stay read-only.
- Backfilling `factory_id` onto the 12,625 legacy `erp_jr_status` rows — the prefix
  fallback covers it; revisit if prefixes prove unreliable.
