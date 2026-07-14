# FlowNex360 — Complete Implementation Plan
## All New Features: OEE · Reports · 5M · Approval · DPR Compliance · Departments

**IndustrIQ Technologies | Version 2.0 Roadmap**

---

## OVERVIEW — What We Are Building

| # | Feature | Complexity | Timeline | Priority |
|---|---------|-----------|----------|----------|
| 1 | Machine Utilization & OEE Dashboard | High | 3 weeks | P1 |
| 2 | 5M Analysis Reports | High | 3 weeks | P1 |
| 3 | Analyze Reports (5 dimensions) | Medium | 2 weeks | P1 |
| 4 | Tonnage Report (Daily/Weekly/Monthly) | Low | 1 week | P2 |
| 5 | WIP Report (Color Wise & Job Wise) | Medium | 2 weeks | P2 |
| 6 | Today's Plan Report | Low | 1 week | P1 |
| 7 | 3-Layer Approval System | High | 3 weeks | P1 |
| 8 | DPR Compliance Summary | Medium | 2 weeks | P1 |
| 9 | Quality Department (enhanced) | Medium | 2 weeks | P2 |
| 10 | Shifting Department (enhanced) | Medium | 2 weeks | P2 |
| 11 | Packing Department (enhanced) | Medium | 2 weeks | P2 |
| 12 | BOM Manager (from earlier plan) | High | 4 weeks | P2 |

**Total Timeline: 10–12 weeks (phased delivery)**

---

## PHASE 1 — Foundation (Weeks 1–4)
### Approval System + OEE + DPR Compliance

---

## FEATURE 1: Machine Utilization & OEE Dashboard

### What is OEE?
OEE = **Availability × Performance × Quality**
- **Availability** = Actual Run Time ÷ Planned Run Time
- **Performance** = (Ideal Cycle Time × Total Count) ÷ Run Time
- **Quality** = Good Count ÷ Total Count

### Database Tables

```sql
-- Machine downtime log (feeds Availability)
CREATE TABLE machine_downtime (
  id SERIAL PRIMARY KEY,
  machine_id INT REFERENCES machines(id),
  shift_id INT REFERENCES shifts(id),
  date DATE NOT NULL,
  planned_time_min INT DEFAULT 480,      -- 8 hr shift = 480 min
  downtime_min INT DEFAULT 0,
  downtime_reason VARCHAR(100),
  downtime_category VARCHAR(50),         -- Breakdown | Setup | No Material | No Operator
  created_at TIMESTAMP DEFAULT NOW()
);

-- Machine production targets (feeds Performance)
CREATE TABLE machine_targets (
  id SERIAL PRIMARY KEY,
  machine_id INT REFERENCES machines(id),
  product_id INT REFERENCES products(id),
  ideal_cycle_time_sec INT NOT NULL,     -- seconds per shot
  target_shots_per_hour INT,
  effective_from DATE,
  effective_to DATE
);

-- OEE calculated summary (pre-computed daily)
CREATE TABLE oee_summary (
  id SERIAL PRIMARY KEY,
  machine_id INT REFERENCES machines(id),
  date DATE NOT NULL,
  shift VARCHAR(20),
  planned_time_min INT,
  actual_run_time_min INT,
  availability_pct DECIMAL(5,2),
  performance_pct DECIMAL(5,2),
  quality_pct DECIMAL(5,2),
  oee_pct DECIMAL(5,2),
  total_shots INT,
  good_shots INT,
  rejected_shots INT,
  UNIQUE(machine_id, date, shift)
);

-- Mould efficiency tracking
CREATE TABLE mould_efficiency (
  id SERIAL PRIMARY KEY,
  mould_id INT REFERENCES moulds(id),
  machine_id INT REFERENCES machines(id),
  date DATE NOT NULL,
  shift VARCHAR(20),
  total_shots INT DEFAULT 0,
  actual_cycle_time_avg_sec DECIMAL(8,2),
  ideal_cycle_time_sec INT,
  efficiency_pct DECIMAL(5,2),
  changeover_time_min INT DEFAULT 0
);
```

### API Routes

```
GET  /api/oee/dashboard              ← Today's OEE all machines
GET  /api/oee/machine/:id?date=&shift= ← Single machine OEE
GET  /api/oee/trend/:machineId       ← OEE trend last 30 days
GET  /api/oee/mould/:mouldId         ← Mould efficiency history
POST /api/oee/downtime/log           ← Log downtime entry
GET  /api/oee/downtime/machine/:id   ← Downtime analysis
POST /api/oee/recalculate            ← Trigger OEE recalculation
GET  /api/oee/ranking                ← Machine ranking by OEE
```

### Frontend Page
**New file: `BACKEND/PUBLIC/oee_dashboard.html`**

Layout:
- Top row: 4 KPI cards (OEE %, Availability %, Performance %, Quality %)
- Center: Machine OEE bar chart (horizontal bars, color-coded)
- Right panel: Mould efficiency table
- Bottom: Trend line chart (OEE last 30 days)
- Filters: Date, Shift, Machine group

### OEE Calculation Logic (Node.js)

```javascript
// BACKEND/src/modules/oee/calculator.js
function calculateOEE(machineId, date, shift) {
  const planned = 480; // minutes
  const downtime = getDowntimeMinutes(machineId, date, shift);
  const actualRun = planned - downtime;
  const availability = (actualRun / planned) * 100;

  const totalShots = getTotalShots(machineId, date, shift);
  const idealCycleTime = getIdealCycleTime(machineId); // seconds
  const performance = ((idealCycleTime * totalShots) / (actualRun * 60)) * 100;

  const goodShots = totalShots - getRejections(machineId, date, shift);
  const quality = (goodShots / totalShots) * 100;

  return {
    availability: Math.min(availability, 100).toFixed(2),
    performance: Math.min(performance, 100).toFixed(2),
    quality: quality.toFixed(2),
    oee: ((availability / 100) * (performance / 100) * (quality / 100) * 100).toFixed(2)
  };
}
```

---

## FEATURE 2: 3-Layer Approval System

### Design Principles
- Layer 1 (Operator): SUBMIT — creates entry, status = "pending"
- Layer 2 (Supervisor): VERIFY — checks data, status = "verified" or "returned"
- Layer 3 (Manager/QC): APPROVE — final lock, status = "approved"
- Once APPROVED: **data is immutable** — no edits allowed

### Database Changes

```sql
-- Add approval columns to existing DPR table
ALTER TABLE dpr_entries ADD COLUMN approval_status VARCHAR(20) DEFAULT 'pending';
-- Values: pending | verified | approved | returned | rejected

ALTER TABLE dpr_entries ADD COLUMN submitted_by INT REFERENCES users(id);
ALTER TABLE dpr_entries ADD COLUMN submitted_at TIMESTAMP;
ALTER TABLE dpr_entries ADD COLUMN verified_by INT REFERENCES users(id);
ALTER TABLE dpr_entries ADD COLUMN verified_at TIMESTAMP;
ALTER TABLE dpr_entries ADD COLUMN verified_note TEXT;
ALTER TABLE dpr_entries ADD COLUMN approved_by INT REFERENCES users(id);
ALTER TABLE dpr_entries ADD COLUMN approved_at TIMESTAMP;
ALTER TABLE dpr_entries ADD COLUMN return_reason TEXT;
ALTER TABLE dpr_entries ADD COLUMN locked BOOLEAN DEFAULT false;

-- Approval audit log (every status change)
CREATE TABLE approval_audit_log (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,  -- dpr | planning | qc | shifting
  entity_id INT NOT NULL,
  action VARCHAR(30) NOT NULL,       -- submit | verify | approve | return | reject
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  done_by INT REFERENCES users(id),
  note TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

-- User roles extended for approval
ALTER TABLE users ADD COLUMN approval_layer INT DEFAULT 1;
-- 1 = Operator, 2 = Supervisor, 3 = Manager/QC
ALTER TABLE users ADD COLUMN can_approve_dpr BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN can_approve_planning BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN can_approve_qc BOOLEAN DEFAULT false;
```

### Approval Flow API

```
POST /api/approval/dpr/:id/submit     ← Layer 1
POST /api/approval/dpr/:id/verify     ← Layer 2 only
POST /api/approval/dpr/:id/approve    ← Layer 3 only
POST /api/approval/dpr/:id/return     ← Layer 2 or 3 (send back)
GET  /api/approval/pending            ← All pending items for current user
GET  /api/approval/history/:entityId  ← Full audit trail
GET  /api/approval/dashboard          ← Approval summary for manager
```

### Middleware

```javascript
// Approval permission middleware
function requireApprovalLayer(minLayer) {
  return (req, res, next) => {
    if (req.user.approval_layer < minLayer) {
      return res.status(403).json({ error: 'Insufficient approval authority' });
    }
    next();
  };
}

// Lock check middleware
function checkNotLocked(entityType) {
  return async (req, res, next) => {
    const entity = await getEntity(entityType, req.params.id);
    if (entity.locked) {
      return res.status(403).json({ error: 'Record is locked after approval' });
    }
    next();
  };
}
```

### UI Changes
- All DPR entries show approval badge: 🟡 Pending | 🔵 Verified | ✅ Approved | 🔴 Returned
- Supervisor view: filtered queue of "pending" entries to verify
- Manager view: queue of "verified" entries to approve
- Lock icon (🔒) appears on approved entries — no edit button
- Notification bell shows pending approvals count

---

## FEATURE 3: DPR Compliance Summary

### Database Tables

```sql
-- DPR compliance config
CREATE TABLE dpr_compliance_config (
  id SERIAL PRIMARY KEY,
  machine_id INT REFERENCES machines(id),
  shift VARCHAR(20) NOT NULL,
  submission_deadline_min INT DEFAULT 15,  -- minutes after shift end
  is_active BOOLEAN DEFAULT true
);

-- Compliance tracking
CREATE TABLE dpr_compliance_log (
  id SERIAL PRIMARY KEY,
  machine_id INT REFERENCES machines(id),
  date DATE NOT NULL,
  shift VARCHAR(20) NOT NULL,
  expected_submission_time TIMESTAMP,
  actual_submission_time TIMESTAMP,
  submitted_by INT REFERENCES users(id),
  is_late BOOLEAN DEFAULT false,
  late_by_min INT DEFAULT 0,
  is_missed BOOLEAN DEFAULT false,
  compliance_score DECIMAL(5,2),  -- 100 = on time, 50 = late, 0 = missed
  UNIQUE(machine_id, date, shift)
);
```

### API Routes

```
GET  /api/compliance/today              ← Today's live heatmap
GET  /api/compliance/summary?from=&to=  ← Date range summary
GET  /api/compliance/operator/:id       ← Per-operator score
GET  /api/compliance/machine/:id        ← Per-machine history
POST /api/compliance/alert/send         ← Trigger missed alert
GET  /api/compliance/ranking            ← Operator compliance ranking
```

### Auto-Alert System

```javascript
// Runs every 5 minutes via cron job
// BACKEND/src/jobs/complianceChecker.js

const cron = require('node-cron');

cron.schedule('*/5 * * * *', async () => {
  const shifts = await getCurrentActiveShifts();
  
  for (const shift of shifts) {
    const deadline = new Date(shift.end_time.getTime() + 15 * 60000);
    
    if (new Date() > deadline) {
      const missing = await findMissingDPREntries(shift);
      
      for (const machine of missing) {
        await sendAlert({
          type: 'dpr_missed',
          machine: machine.name,
          shift: shift.name,
          notifyUsers: ['supervisors', 'managers'],
          message: `DPR not submitted for ${machine.name} - ${shift.name} shift`
        });
        
        await markAsMissed(machine.id, shift.date, shift.name);
      }
    }
  }
});
```

### Unique Features to Build

1. **Compliance Heatmap** — color grid (Machine × Shift × Date)
   - Green = submitted on time
   - Yellow = submitted late (within 15 min)
   - Orange = submitted very late (15–60 min)
   - Red = not submitted

2. **Operator Score Card** — per-operator compliance %
   - Monthly compliance %
   - On-time submission rate
   - Days with perfect compliance
   - Public ranking (motivates operators)

3. **Tamper-Proof Timestamps**
   - Server-side timestamp only (client cannot set time)
   - Stored with IP address + user agent

4. **Photo Proof Attachment**
   - Operator can upload 1 photo per DPR entry
   - Stored in `/uploads/dpr-photos/` with machine/date/shift in filename

---

## FEATURE 4: 5M Analysis Reports

### Report Structure

Each M has its own report page/section:

**M1 — Machine Analysis**
- Machine-wise production summary
- OEE per machine
- Downtime causes breakdown (pie chart)
- Machine-wise rejection trend

**M2 — Manpower Analysis**
- Operator-wise output (pieces per hour)
- Attendance-linked production
- Per-operator rejection rate
- Team performance comparison

**M3 — Material Analysis**
- Actual consumption vs BOM
- Material wastage %
- Job-wise material usage
- Stock consumption trend

**M4 — Mould Analysis**
- Mould-wise shots produced
- Cycle time trend
- Mould changeover frequency
- Mould maintenance due list

**M5 — Method Analysis**
- Process adherence score
- Top rejection reasons
- Defect-to-cause correlation
- Process deviation alerts

### API Routes

```
GET /api/reports/5m/machine?from=&to=&machineId=
GET /api/reports/5m/manpower?from=&to=&operatorId=
GET /api/reports/5m/material?from=&to=&productId=
GET /api/reports/5m/mould?from=&to=&mouldId=
GET /api/reports/5m/method?from=&to=&machineId=
GET /api/reports/5m/combined?from=&to=   ← All 5Ms in one dashboard
```

---

## FEATURE 5: Analyze Reports (5 Dimensions)

### Machine Wise Report
```
Columns: Machine | Plan | Actual | Variance | OEE | Rejection % | Downtime hrs
Group by: Machine → Date
Filters: Date range, Machine group, Shift
Export: PDF, Excel
```

### Mould Wise Report
```
Columns: Mould Code | Product | Machine | Shots | Cycle Time | Efficiency | Next PM Due
Group by: Mould → Date
Filters: Date range, Mould code
```

### Supervisor Wise Report
```
Columns: Supervisor | Team Size | Total Output | Rejection Rate | OEE | Compliance %
Group by: Supervisor → Date
Filters: Date range, Department
```

### Order Wise Report
```
Columns: Order No | Customer | Product | Qty Ordered | Produced | Pending | Due Date | Status
Group by: Order → Product
Filters: Date range, Customer, Status (open/closed/overdue)
```

### Plant Wise Report (for multi-location)
```
Columns: Plant | Total Machines | Production | OEE | Rejection | Tonnage
Group by: Plant → Date
Use case: For clients with multiple factory units
```

---

## FEATURE 6: Tonnage Report

### What is Tonnage?
Weight of plastic produced = Shots × Shot Weight (grams) → converted to KG/Tonnes

### Database

```sql
-- Add shot_weight to products (already may exist — extend)
ALTER TABLE products ADD COLUMN shot_weight_gm DECIMAL(10,3) DEFAULT 0;
ALTER TABLE products ADD COLUMN runner_weight_gm DECIMAL(10,3) DEFAULT 0;

-- Tonnage pre-calculated view
CREATE VIEW tonnage_daily AS
SELECT
  date,
  machine_id,
  product_id,
  shift,
  SUM(produced_qty) as total_shots,
  SUM(produced_qty * p.shot_weight_gm / 1000) as net_kg,
  SUM(produced_qty * (p.shot_weight_gm + p.runner_weight_gm) / 1000) as gross_kg
FROM dpr_entries d
JOIN products p ON d.product_id = p.id
GROUP BY date, machine_id, product_id, shift;
```

### API Routes

```
GET /api/reports/tonnage/daily?date=
GET /api/reports/tonnage/weekly?week=&year=
GET /api/reports/tonnage/monthly?month=&year=
GET /api/reports/tonnage/machine/:id?period=
```

---

## FEATURE 7: WIP Report (Color Wise & Job Wise)

### Database

```sql
-- WIP tracking (Work In Progress)
CREATE TABLE wip_inventory (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id),
  product_id INT REFERENCES products(id),
  colour VARCHAR(50),
  colour_code VARCHAR(20),
  location VARCHAR(100),         -- Machine Floor / QC / Shifting / Packing
  quantity INT DEFAULT 0,
  unit VARCHAR(20) DEFAULT 'pcs',
  status VARCHAR(30) DEFAULT 'in_process',
  -- in_process | qc_hold | approved | packed | dispatched
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### WIP Report Views
- **Colour Wise**: Group by colour → shows all jobs of that colour across locations
- **Job Wise**: Group by job → shows colour breakdown, location, quantities
- **Location Wise**: Group by location → what's at each stage

---

## FEATURE 8: Today's Plan vs Actual Report

### Data Required
- Planning board entries for today
- DPR actual production for today
- Calculate variance per machine per shift

### API Route

```
GET /api/reports/plan-vs-actual?date=TODAY
```

### Output Format
```
Machine | Shift | Planned Job | Plan Qty | Actual Qty | Variance | % Achieved
INJ-01  | Morning | CHAIR-LEG | 1000 pcs | 940 pcs | -60 pcs | 94%
```

---

## PHASE 2 — Department Enhancements (Weeks 5–8)

---

## FEATURE 9: Quality Department (Enhanced)

### New Tables

```sql
-- CAPA (Corrective Action Preventive Action)
CREATE TABLE quality_capa (
  id SERIAL PRIMARY KEY,
  rejection_id INT REFERENCES qc_rejections(id),
  problem_description TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  responsible_person INT REFERENCES users(id),
  target_date DATE,
  completion_date DATE,
  status VARCHAR(20) DEFAULT 'open',  -- open | in_progress | closed | verified
  verified_by INT REFERENCES users(id)
);

-- Incoming material QC (GRN quality check)
CREATE TABLE grn_quality_check (
  id SERIAL PRIMARY KEY,
  grn_id INT REFERENCES purchase_grn(id),
  material_id INT,
  batch_no VARCHAR(50),
  sample_qty INT,
  accepted_qty INT,
  rejected_qty INT,
  rejection_reason TEXT,
  checked_by INT REFERENCES users(id),
  check_date TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending'  -- pending | accepted | rejected | conditional
);
```

### New Quality Features
- CAPA management module
- Incoming material QC at GRN stage
- Customer complaint registration & tracking
- Quality alert escalation (if rejection > X%)
- Defect photo capture with QC entry
- Inter-department quality hold system

---

## FEATURE 10: Shifting Department (Enhanced)

### New Tables

```sql
-- Shifting requests
CREATE TABLE shifting_requests (
  id SERIAL PRIMARY KEY,
  from_location VARCHAR(100),
  to_location VARCHAR(100),
  product_id INT REFERENCES products(id),
  job_id INT REFERENCES jobs(id),
  quantity INT,
  colour VARCHAR(50),
  requested_by INT REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT NOW(),
  approved_by INT REFERENCES users(id),
  approved_at TIMESTAMP,
  completed_by INT REFERENCES users(id),
  completed_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending',
  notes TEXT
);
```

### New Shifting Features
- Shifting request → approval → execute flow
- Real-time location tracking of WIP
- Pre-shift shortage alerts (if material not shifted)
- Barcode scan on shifting (scan product label)
- Shifting completion notification

---

## FEATURE 11: Packing Department (Enhanced)

### New Tables

```sql
-- Packing entries
CREATE TABLE packing_entries (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES jobs(id),
  product_id INT REFERENCES products(id),
  packing_config_id INT REFERENCES packing_settings(id),
  boxes_packed INT DEFAULT 0,
  pieces_per_box INT,
  total_pieces INT,
  label_printed BOOLEAN DEFAULT false,
  packed_by INT REFERENCES users(id),
  packed_at TIMESTAMP DEFAULT NOW(),
  qc_approved_by INT REFERENCES users(id),
  dispatch_ready BOOLEAN DEFAULT false
);
```

### New Packing Features
- Packing against production qty (linked to DPR)
- Customer-specific label configuration
- Barcode scan before packing (verify product)
- Dispatch-ready stock visibility
- Packing summary report per customer

---

## PHASE 3 — BOM Integration (Weeks 9–12)

*(Covered in earlier BOM plan — Party-wise BOM + Multi-level Child BOM)*

---

## COMPLETE DATABASE MIGRATION SEQUENCE

Run in this order:

```bash
# Week 1
node scripts/migrate_oee_tables.js
node scripts/migrate_approval_tables.js

# Week 2
node scripts/migrate_compliance_tables.js
node scripts/migrate_5m_views.js

# Week 3
node scripts/migrate_tonnage_views.js
node scripts/migrate_wip_tables.js

# Week 4
node scripts/migrate_quality_enhanced.js
node scripts/migrate_shifting_enhanced.js
node scripts/migrate_packing_enhanced.js

# Week 6
node scripts/migrate_bom_tables.js
```

---

## NEW HTML PAGES TO CREATE

| Page | URL | Module |
|------|-----|--------|
| `oee_dashboard.html` | /oee_dashboard.html | OEE |
| `reports_5m.html` | /reports_5m.html | 5M Analysis |
| `reports_analyze.html` | /reports_analyze.html | Analyze Reports |
| `reports_tonnage.html` | /reports_tonnage.html | Tonnage |
| `reports_wip.html` | /reports_wip.html | WIP |
| `approval_queue.html` | /approval_queue.html | Approval System |
| `dpr_compliance.html` | /dpr_compliance.html | DPR Compliance |
| `quality_capa.html` | /quality_capa.html | Quality CAPA |
| `shifting_requests.html` | /shifting_requests.html | Shifting |
| `bom_manager.html` | /bom_manager.html | BOM |

---

## TESTING CHECKLIST (per feature)

- [ ] DB migration runs clean (`node --check` + actual run)
- [ ] All API routes return correct data structure
- [ ] Page loads without console errors
- [ ] Filters work (date, machine, shift)
- [ ] Export to PDF and Excel works
- [ ] Approval permissions enforced (Layer 1 cannot approve Layer 3)
- [ ] Locked records cannot be edited
- [ ] OEE calculation formula verified with manual test data
- [ ] Compliance alerts trigger correctly in test environment

---

## DELIVERY TIMELINE

| Week | Deliverable |
|------|-------------|
| Week 1 | OEE Dashboard (backend + frontend) |
| Week 2 | Approval System (3-layer) |
| Week 3 | DPR Compliance Summary + Alerts |
| Week 4 | 5M Reports + Analyze Reports |
| Week 5 | Tonnage + WIP + Today's Plan Reports |
| Week 6 | Quality CAPA + Incoming QC |
| Week 7 | Shifting enhanced + Packing enhanced |
| Week 8 | Integration testing + bug fixes |
| Week 9–12 | BOM Manager (Party-wise + Child BOM) |

---

## PRICING FOR NEW FEATURES (to quote clients)

| Feature Set | Quote Price |
|-------------|-------------|
| OEE Dashboard | ₹60,000 |
| 5M Analysis Reports | ₹75,000 |
| 3-Layer Approval System | ₹55,000 |
| DPR Compliance Dashboard | ₹40,000 |
| Tonnage + WIP Reports | ₹35,000 |
| Complete V2 Upgrade (all above) | ₹2,20,000 |

*Existing clients get V2 at 40% discount as part of AMC renewal*

---

*IndustrIQ Technologies — FlowNex360 V2 Implementation Plan — Confidential*
*Generated: 26-Jun-2026*
