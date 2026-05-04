'use strict';

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const {
  getRequestUsername,
  normalizeFactoryId
} = require('../../app/requestContext');

const ROLE_ADMIN = new Set(['admin', 'superadmin']);
const ROLE_HR = new Set(['hr_manager']);
const STATUS_SCORE_MAP = {
  completed: 1,
  partial: 0.5,
  not_done: 0
};

function normalizeText(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function normalizeNullableText(value) {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function normalizeRoleCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (ROLE_ADMIN.has(raw)) return raw;
  if (ROLE_HR.has(raw)) return 'hr_manager';
  return 'employee';
}

function normalizeChecklistStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'completed' || raw === 'done' || raw === 'yes') return 'completed';
  if (raw === 'partial' || raw === 'partially_done' || raw === 'half') return 'partial';
  return 'not_done';
}

function toMarks(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function monthWindow(monthValue) {
  const raw = String(monthValue || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getMonth();
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function buildGrade(percent) {
  if (percent >= 90) return 'A';
  if (percent >= 75) return 'B';
  return 'C';
}

function safePercent(actual, possible) {
  if (!possible) return 0;
  return Number(((actual / possible) * 100).toFixed(2));
}

function sendWorkbook(res, workbook, filename) {
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

function sendHtmlWorkbook(res, html, filename) {
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + html);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMonthDays(window) {
  const days = [];
  const cursor = new Date(`${window.startDate}T00:00:00`);
  const end = new Date(`${window.endDate}T00:00:00`);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({
      iso,
      dayNumber: cursor.getDate(),
      weekday: cursor.toLocaleDateString('en-US', { weekday: 'short' })
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function prettyMonthLabel(month) {
  const [year, mon] = String(month || '').split('-');
  if (!year || !mon) return String(month || '');
  const date = new Date(Number(year), Number(mon) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}

function statusGlyph(status) {
  const value = normalizeChecklistStatus(status);
  if (value === 'completed') return '&#10003;';
  if (value === 'partial') return '&#126;';
  if (value === 'not_done') return '&#10007;';
  return '';
}

function hasBrandLogo() {
  const candidates = [
    path.join(__dirname, '../../../PUBLIC/assets/jms-logo.png'),
    path.join(process.cwd(), 'PUBLIC/assets/jms-logo.png')
  ];
  return candidates.some((filePath) => fs.existsSync(filePath));
}

function buildBrandLogoUrl(req) {
  if (!hasBrandLogo()) return '';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto ? String(forwardedProto).split(',')[0].trim() : (req.protocol || 'http');
  const host = req.get('host');
  if (!host) return '';
  return `${proto}://${host}/assets/jms-logo.png`;
}

module.exports = function registerHrPerformanceRoutes({ app, pool }) {
  async function q(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
  }

  async function exec(text, params = []) {
    return pool.query(text, params);
  }

  async function ensureTables() {
    await exec(`
      CREATE TABLE IF NOT EXISTS factories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        location TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_updated_at TIMESTAMPTZ
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255),
        line VARCHAR(255) DEFAULT '',
        role_code VARCHAR(50) DEFAULT 'operator',
        permissions JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT TRUE,
        global_access BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'active'
      );
    `);

    await exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';`);
    await exec(`ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';`);
    await exec(`UPDATE users SET status = 'active' WHERE status IS NULL;`);

    await exec(`
      CREATE TABLE IF NOT EXISTS user_factories (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        factory_id INTEGER NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, factory_id)
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_employee_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        employee_code TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        department TEXT NOT NULL,
        designation TEXT NOT NULL,
        manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        role_code TEXT NOT NULL DEFAULT 'employee',
        email TEXT,
        phone TEXT,
        factory_id INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_kra_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        department TEXT,
        description TEXT,
        frequency TEXT DEFAULT 'Daily',
        is_active BOOLEAN DEFAULT TRUE,
        created_by TEXT,
        factory_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_kra_template_items (
        id SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES hr_kra_templates(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL DEFAULT 'kra',
        category TEXT,
        key_area TEXT NOT NULL,
        responsibility TEXT NOT NULL,
        measurement TEXT,
        frequency TEXT,
        target_value TEXT,
        marks NUMERIC(10,2) DEFAULT 0,
        display_order INTEGER DEFAULT 0,
        is_daily_activity BOOLEAN DEFAULT FALSE
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_kra_assignments (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES hr_kra_templates(id) ON DELETE SET NULL,
        employee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assignment_mode TEXT NOT NULL DEFAULT 'individual',
        department TEXT,
        start_date DATE DEFAULT CURRENT_DATE,
        end_date DATE,
        assigned_by TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_kra_assignment_items (
        id SERIAL PRIMARY KEY,
        assignment_id INTEGER NOT NULL REFERENCES hr_kra_assignments(id) ON DELETE CASCADE,
        template_item_id INTEGER REFERENCES hr_kra_template_items(id) ON DELETE SET NULL,
        item_type TEXT NOT NULL DEFAULT 'kra',
        category TEXT,
        key_area TEXT NOT NULL,
        responsibility TEXT NOT NULL,
        measurement TEXT,
        frequency TEXT,
        target_value TEXT,
        marks NUMERIC(10,2) DEFAULT 0,
        display_order INTEGER DEFAULT 0,
        is_daily_activity BOOLEAN DEFAULT FALSE
      );
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS hr_kra_daily_entries (
        id SERIAL PRIMARY KEY,
        assignment_id INTEGER NOT NULL REFERENCES hr_kra_assignments(id) ON DELETE CASCADE,
        assignment_item_id INTEGER NOT NULL REFERENCES hr_kra_assignment_items(id) ON DELETE CASCADE,
        employee_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entry_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_done',
        remarks TEXT,
        score NUMERIC(10,2) DEFAULT 0,
        updated_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (employee_user_id, assignment_item_id, entry_date)
      );
    `);

    await exec(`ALTER TABLE hr_employee_profiles ADD COLUMN IF NOT EXISTS email TEXT`);
    await exec(`ALTER TABLE hr_employee_profiles ADD COLUMN IF NOT EXISTS phone TEXT`);
    await exec(`ALTER TABLE hr_employee_profiles ADD COLUMN IF NOT EXISTS factory_id INTEGER`);
    await exec(`ALTER TABLE hr_employee_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await exec(`ALTER TABLE hr_kra_templates ADD COLUMN IF NOT EXISTS factory_id INTEGER`);

    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_employee_profiles_department ON hr_employee_profiles(department)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_employee_profiles_manager ON hr_employee_profiles(manager_user_id)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_kra_assignments_employee_active ON hr_kra_assignments(employee_user_id, is_active)`);
    await exec(`CREATE INDEX IF NOT EXISTS idx_hr_kra_daily_entries_employee_date ON hr_kra_daily_entries(employee_user_id, entry_date DESC)`);
  }

  ensureTables().catch((error) => {
    console.error('[HR PERFORMANCE] Failed to initialize tables:', error);
  });

  async function getSessionUser(req) {
    const username = getRequestUsername(req);
    if (!username) return null;
    return (await q(
      `SELECT id, username, role_code, line, global_access
         FROM users
        WHERE username = $1
        LIMIT 1`,
      [username]
    ))[0] || null;
  }

  function isAdminLike(user) {
    return ROLE_ADMIN.has(String(user?.role_code || '').toLowerCase());
  }

  function isHrManager(user) {
    const role = String(user?.role_code || '').toLowerCase();
    return isAdminLike(user) || ROLE_HR.has(role);
  }

  async function requireSessionUser(req, res) {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return null;
    }
    return user;
  }

  async function requireHrAccess(req, res) {
    const user = await requireSessionUser(req, res);
    if (!user) return null;
    if (!isHrManager(user)) {
      res.status(403).json({ ok: false, error: 'HR/Admin access required' });
      return null;
    }
    return user;
  }

  async function getEmployeeProfileByUserId(userId) {
    return (await q(
      `SELECT p.id,
              p.user_id,
              p.employee_code,
              p.full_name,
              p.department,
              p.designation,
              p.manager_user_id,
              p.role_code,
              p.email,
              p.phone,
              p.factory_id,
              p.is_active,
              u.username,
              u.role_code AS account_role_code,
              manager.username AS manager_username,
              mp.full_name AS manager_name
         FROM hr_employee_profiles p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN users manager ON manager.id = p.manager_user_id
         LEFT JOIN hr_employee_profiles mp ON mp.user_id = p.manager_user_id
        WHERE p.user_id = $1
        LIMIT 1`,
      [userId]
    ))[0] || null;
  }

  async function getMetaPayload(currentUser) {
    const currentProfile = await getEmployeeProfileByUserId(currentUser.id);
    const departments = await q(`
      SELECT DISTINCT department
        FROM hr_employee_profiles
       WHERE COALESCE(is_active, TRUE) = TRUE
         AND department IS NOT NULL
         AND TRIM(department) <> ''
       ORDER BY department
    `);
    const managers = await q(`
      SELECT p.user_id,
             p.full_name,
             p.department,
             p.designation,
             u.username
        FROM hr_employee_profiles p
        JOIN users u ON u.id = p.user_id
       WHERE COALESCE(p.is_active, TRUE) = TRUE
       ORDER BY p.full_name
    `);
    const employees = isHrManager(currentUser) ? await q(`
      SELECT p.id,
             p.user_id,
             p.employee_code,
             p.full_name,
             p.department,
             p.designation,
             p.manager_user_id,
             p.role_code,
             p.email,
             p.phone,
             p.factory_id,
             p.is_active,
             u.username,
             u.role_code AS account_role_code,
             mp.full_name AS manager_name
        FROM hr_employee_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN hr_employee_profiles mp ON mp.user_id = p.manager_user_id
       ORDER BY p.full_name
    `) : (currentProfile ? [currentProfile] : []);

    return {
      currentUser: {
        id: currentUser.id,
        username: currentUser.username,
        role_code: currentUser.role_code
      },
      currentProfile,
      roles: [
        { code: 'admin', label: 'Admin' },
        { code: 'hr_manager', label: 'HR Manager' },
        { code: 'employee', label: 'Employee' }
      ],
      departments: departments.map((row) => row.department),
      managers,
      employees,
      capabilities: {
        canManageEmployees: isHrManager(currentUser),
        canManageTemplates: isHrManager(currentUser),
        canAssignKra: isHrManager(currentUser),
        canViewAll: isHrManager(currentUser)
      }
    };
  }

  async function buildEmployeeList() {
    return q(`
      SELECT p.id,
             p.user_id,
             p.employee_code,
             p.full_name,
             p.department,
             p.designation,
             p.manager_user_id,
             p.role_code,
             p.email,
             p.phone,
             p.factory_id,
             p.is_active,
             u.username,
             u.role_code AS account_role_code,
             COALESCE(manager.full_name, '') AS manager_name,
             (
               SELECT COUNT(*)
                 FROM hr_kra_assignments a
                WHERE a.employee_user_id = p.user_id
                  AND COALESCE(a.is_active, TRUE) = TRUE
             )::int AS active_assignments
        FROM hr_employee_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN hr_employee_profiles manager ON manager.user_id = p.manager_user_id
       ORDER BY p.full_name
    `);
  }

  async function buildTemplateList(currentUser) {
    const rows = await q(`
      SELECT t.id,
             t.name,
             t.department,
             t.description,
             t.frequency,
             t.is_active,
             t.created_by,
             t.created_at,
             t.updated_at,
             COUNT(i.id)::int AS item_count,
             COALESCE(SUM(i.marks), 0)::numeric AS total_marks
        FROM hr_kra_templates t
        LEFT JOIN hr_kra_template_items i ON i.template_id = t.id
       GROUP BY t.id
       ORDER BY t.updated_at DESC, t.name ASC
    `);

    if (!isHrManager(currentUser)) {
      const ownAssignments = await q(`
        SELECT DISTINCT template_id
          FROM hr_kra_assignments
         WHERE employee_user_id = $1
           AND COALESCE(is_active, TRUE) = TRUE
           AND template_id IS NOT NULL
      `, [currentUser.id]);
      const allowed = new Set(ownAssignments.map((row) => Number(row.template_id)));
      return rows.filter((row) => allowed.has(Number(row.id)));
    }

    return rows;
  }

  async function loadTemplateDetails(templateId) {
    const template = (await q(`
      SELECT id, name, department, description, frequency, is_active, created_by, created_at, updated_at
        FROM hr_kra_templates
       WHERE id = $1
       LIMIT 1
    `, [templateId]))[0];
    if (!template) return null;
    template.items = await q(`
      SELECT id,
             item_type,
             category,
             key_area,
             responsibility,
             measurement,
             frequency,
             target_value,
             marks,
             display_order,
             is_daily_activity
        FROM hr_kra_template_items
       WHERE template_id = $1
       ORDER BY display_order ASC, id ASC
    `, [templateId]);
    return template;
  }

  async function buildAssignmentList(currentUser) {
    const params = [];
    let where = '';
    if (!isHrManager(currentUser)) {
      params.push(currentUser.id);
      where = 'WHERE a.employee_user_id = $1';
    }
    const assignments = await q(`
      SELECT a.id,
             a.template_id,
             a.employee_user_id,
             a.assignment_mode,
             a.department,
             a.start_date::text AS start_date,
             a.end_date::text AS end_date,
             a.assigned_by,
             a.is_active,
             a.created_at,
             t.name AS template_name,
             p.full_name AS employee_name,
             p.employee_code,
             p.department AS employee_department,
             p.designation
        FROM hr_kra_assignments a
        LEFT JOIN hr_kra_templates t ON t.id = a.template_id
        JOIN hr_employee_profiles p ON p.user_id = a.employee_user_id
        ${where}
       ORDER BY a.created_at DESC, p.full_name ASC
    `, params);

    return assignments;
  }

  async function getChecklistPayload(targetUserId, entryDate) {
    const profile = await getEmployeeProfileByUserId(targetUserId);
    if (!profile) {
      return { profile: null, assignments: [], summary: { daily_score: 0, daily_possible: 0, performance_percent: 0 } };
    }

    const rows = await q(`
      SELECT a.id AS assignment_id,
             a.template_id,
             a.start_date::text AS start_date,
             a.end_date::text AS end_date,
             t.name AS template_name,
             ai.id AS assignment_item_id,
             ai.item_type,
             ai.category,
             ai.key_area,
             ai.responsibility,
             ai.measurement,
             ai.frequency,
             ai.target_value,
             ai.marks,
             ai.display_order,
             ai.is_daily_activity,
             e.id AS entry_id,
             e.status,
             e.remarks,
             e.score
        FROM hr_kra_assignments a
        LEFT JOIN hr_kra_templates t ON t.id = a.template_id
        JOIN hr_kra_assignment_items ai ON ai.assignment_id = a.id
        LEFT JOIN hr_kra_daily_entries e
               ON e.assignment_item_id = ai.id
              AND e.employee_user_id = a.employee_user_id
              AND e.entry_date = $2::date
       WHERE a.employee_user_id = $1
         AND COALESCE(a.is_active, TRUE) = TRUE
       ORDER BY a.created_at DESC, ai.display_order ASC, ai.id ASC
    `, [targetUserId, entryDate]);

    const grouped = new Map();
    let dailyPossible = 0;
    let dailyScore = 0;
    for (const row of rows) {
      if (!grouped.has(row.assignment_id)) {
        grouped.set(row.assignment_id, {
          assignment_id: row.assignment_id,
          template_id: row.template_id,
          template_name: row.template_name || 'Assigned KRA',
          start_date: row.start_date,
          end_date: row.end_date,
          items: []
        });
      }
      const marks = toMarks(row.marks);
      const score = row.entry_id ? toMarks(row.score) : 0;
      dailyPossible += marks;
      dailyScore += score;
      grouped.get(row.assignment_id).items.push({
        assignment_item_id: row.assignment_item_id,
        item_type: row.item_type,
        category: row.category,
        key_area: row.key_area,
        responsibility: row.responsibility,
        measurement: row.measurement,
        frequency: row.frequency,
        target_value: row.target_value,
        marks,
        display_order: Number(row.display_order) || 0,
        is_daily_activity: !!row.is_daily_activity,
        status: row.status || 'not_done',
        remarks: row.remarks || '',
        score
      });
    }

    return {
      profile,
      assignments: [...grouped.values()],
      summary: {
        daily_score: Number(dailyScore.toFixed(2)),
        daily_possible: Number(dailyPossible.toFixed(2)),
        performance_percent: safePercent(dailyScore, dailyPossible)
      }
    };
  }

  async function computeDashboard(currentUser, month, department) {
    const window = monthWindow(month);
    const employeeWhere = [];
    const employeeParams = [];
    if (!isHrManager(currentUser)) {
      employeeParams.push(currentUser.id);
      employeeWhere.push(`p.user_id = $${employeeParams.length}`);
    }
    if (department) {
      employeeParams.push(department);
      employeeWhere.push(`p.department = $${employeeParams.length}`);
    }

    const employeeRows = await q(`
      SELECT p.id AS profile_id,
             p.user_id,
             p.employee_code,
             p.full_name,
             p.department,
             p.designation,
             u.username,
             COALESCE(SUM(ai.marks), 0)::numeric AS max_daily_marks,
             COUNT(ai.id)::int AS item_count
        FROM hr_employee_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN hr_kra_assignments a
               ON a.employee_user_id = p.user_id
              AND COALESCE(a.is_active, TRUE) = TRUE
        LEFT JOIN hr_kra_assignment_items ai ON ai.assignment_id = a.id
       ${employeeWhere.length ? `WHERE ${employeeWhere.join(' AND ')}` : ''}
       GROUP BY p.id, u.username
       ORDER BY p.full_name
    `, employeeParams);

    const entryParams = [window.startDate, window.endDate];
    const entryWhere = [`e.entry_date BETWEEN $1::date AND $2::date`];
    if (!isHrManager(currentUser)) {
      entryParams.push(currentUser.id);
      entryWhere.push(`e.employee_user_id = $${entryParams.length}`);
    }
    if (department) {
      entryParams.push(department);
      entryWhere.push(`p.department = $${entryParams.length}`);
    }

    const entryRows = await q(`
      SELECT e.employee_user_id,
             e.entry_date::text AS entry_date,
             e.status,
             e.score,
             e.assignment_item_id,
             p.department,
             p.full_name
        FROM hr_kra_daily_entries e
        JOIN hr_employee_profiles p ON p.user_id = e.employee_user_id
       WHERE ${entryWhere.join(' AND ')}
       ORDER BY e.entry_date ASC
    `, entryParams);

    const employeeMap = new Map();
    for (const row of employeeRows) {
      employeeMap.set(Number(row.user_id), {
        user_id: Number(row.user_id),
        profile_id: Number(row.profile_id),
        employee_code: row.employee_code,
        full_name: row.full_name,
        department: row.department,
        designation: row.designation,
        username: row.username,
        max_daily_marks: toMarks(row.max_daily_marks),
        item_count: Number(row.item_count) || 0,
        monthly_score: 0,
        possible_score: 0,
        days_updated: 0,
        completed_count: 0,
        partial_count: 0,
        not_done_count: 0,
        completion_percent: 0,
        performance_percent: 0,
        grade: 'C'
      });
    }

    const perEmployeeDayMap = new Map();
    const dailyTrendMap = new Map();
    for (const row of entryRows) {
      const userId = Number(row.employee_user_id);
      const employee = employeeMap.get(userId);
      if (!employee) continue;
      const dateKey = row.entry_date;
      const dayKey = `${userId}::${dateKey}`;
      if (!perEmployeeDayMap.has(dayKey)) {
        perEmployeeDayMap.set(dayKey, {
          userId,
          dateKey,
          score: 0
        });
      }
      perEmployeeDayMap.get(dayKey).score += toMarks(row.score);
      employee.monthly_score += toMarks(row.score);
      if (row.status === 'completed') employee.completed_count += 1;
      else if (row.status === 'partial') employee.partial_count += 1;
      else employee.not_done_count += 1;
    }

    for (const dayEntry of perEmployeeDayMap.values()) {
      const employee = employeeMap.get(dayEntry.userId);
      if (!employee) continue;
      employee.days_updated += 1;
      employee.possible_score += employee.max_daily_marks;
      const pct = safePercent(dayEntry.score, employee.max_daily_marks);
      if (!dailyTrendMap.has(dayEntry.dateKey)) {
        dailyTrendMap.set(dayEntry.dateKey, { date: dayEntry.dateKey, total: 0, count: 0 });
      }
      const trend = dailyTrendMap.get(dayEntry.dateKey);
      trend.total += pct;
      trend.count += 1;
    }

    const ranking = [...employeeMap.values()].map((employee) => {
      employee.performance_percent = safePercent(employee.monthly_score, employee.possible_score);
      const totalEntries = employee.completed_count + employee.partial_count + employee.not_done_count;
      employee.completion_percent = safePercent(employee.completed_count + employee.partial_count, totalEntries);
      employee.grade = buildGrade(employee.performance_percent);
      return employee;
    }).sort((a, b) => b.performance_percent - a.performance_percent || a.full_name.localeCompare(b.full_name));

    const departments = new Map();
    for (const employee of ranking) {
      if (!departments.has(employee.department || 'Unassigned')) {
        departments.set(employee.department || 'Unassigned', {
          department: employee.department || 'Unassigned',
          employees: 0,
          total_performance: 0,
          total_completion: 0,
          top_performer: employee.full_name,
          low_performer: employee.full_name
        });
      }
      const group = departments.get(employee.department || 'Unassigned');
      group.employees += 1;
      group.total_performance += employee.performance_percent;
      group.total_completion += employee.completion_percent;
    }

    const departmentPerformance = [...departments.values()].map((group) => {
      const deptEmployees = ranking.filter((employee) => (employee.department || 'Unassigned') === group.department);
      const sorted = deptEmployees.slice().sort((a, b) => b.performance_percent - a.performance_percent);
      return {
        department: group.department,
        employees: group.employees,
        average_performance: Number((group.total_performance / Math.max(group.employees, 1)).toFixed(2)),
        average_completion: Number((group.total_completion / Math.max(group.employees, 1)).toFixed(2)),
        top_performer: sorted[0]?.full_name || '-',
        low_performer: sorted[sorted.length - 1]?.full_name || '-'
      };
    }).sort((a, b) => b.average_performance - a.average_performance);

    const trend = [...dailyTrendMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        performance_percent: Number((row.total / Math.max(row.count, 1)).toFixed(2))
      }));

    const topPerformers = ranking.slice(0, 5);
    const lowPerformers = ranking.slice(-5).reverse();

    return {
      month: window.month,
      date_range: {
        start: window.startDate,
        end: window.endDate
      },
      ranking,
      top_performers: topPerformers,
      low_performers: lowPerformers,
      department_performance: departmentPerformance,
      trend,
      department_filter: department || '',
      overview: {
        employees: ranking.length,
        average_performance: ranking.length
          ? Number((ranking.reduce((sum, row) => sum + row.performance_percent, 0) / ranking.length).toFixed(2))
          : 0,
        average_completion: ranking.length
          ? Number((ranking.reduce((sum, row) => sum + row.completion_percent, 0) / ranking.length).toFixed(2))
          : 0,
        active_templates: (await q(`SELECT COUNT(*)::int AS c FROM hr_kra_templates WHERE COALESCE(is_active, TRUE) = TRUE`))[0]?.c || 0
      }
    };
  }

  async function buildDetailedReportRows(currentUser, month, department, employeeUserId) {
    const window = monthWindow(month);
    const params = [window.startDate, window.endDate];
    const conditions = [`e.entry_date BETWEEN $1::date AND $2::date`];
    if (!isHrManager(currentUser)) {
      params.push(currentUser.id);
      conditions.push(`e.employee_user_id = $${params.length}`);
    } else if (employeeUserId) {
      params.push(employeeUserId);
      conditions.push(`e.employee_user_id = $${params.length}`);
    }
    if (department) {
      params.push(department);
      conditions.push(`p.department = $${params.length}`);
    }

    return q(`
      SELECT p.employee_code AS "Employee Code",
             p.full_name AS "Employee Name",
             p.department AS "Department",
             p.designation AS "Designation",
             e.entry_date::text AS "Date",
             t.name AS "KRA Template",
             ai.category AS "Key Area",
             ai.responsibility AS "Responsibilities",
             ai.measurement AS "Measurement",
             ai.frequency AS "Frequency",
             ai.target_value AS "Target",
             ai.marks AS "Marks",
             e.status AS "Status",
             e.remarks AS "Remarks",
             e.score AS "Score"
        FROM hr_kra_daily_entries e
        JOIN hr_kra_assignments a ON a.id = e.assignment_id
        JOIN hr_kra_assignment_items ai ON ai.id = e.assignment_item_id
        LEFT JOIN hr_kra_templates t ON t.id = a.template_id
        JOIN hr_employee_profiles p ON p.user_id = e.employee_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.full_name, e.entry_date, ai.display_order, ai.id
    `, params);
  }

  async function buildEmployeeKraReportRows(currentUser, month, department, employeeUserId) {
    const window = monthWindow(month);
    const params = [window.startDate, window.endDate, window.endDate, window.startDate];
    const conditions = [
      `COALESCE(a.is_active, TRUE) = TRUE`,
      `(a.start_date IS NULL OR a.start_date <= $3::date)`,
      `(a.end_date IS NULL OR a.end_date >= $4::date)`
    ];

    if (!isHrManager(currentUser)) {
      params.push(currentUser.id);
      conditions.push(`a.employee_user_id = $${params.length}`);
    } else if (employeeUserId) {
      params.push(employeeUserId);
      conditions.push(`a.employee_user_id = $${params.length}`);
    }

    if (department) {
      params.push(department);
      conditions.push(`p.department = $${params.length}`);
    }

    return q(`
      SELECT p.user_id,
             p.employee_code,
             p.full_name,
             p.department,
             p.designation,
             COALESCE(mp.full_name, mu.username, '-') AS manager_name,
             a.id AS assignment_id,
             ai.id AS assignment_item_id,
             ai.display_order,
             ai.item_type,
             ai.is_daily_activity,
             ai.category,
             ai.key_area,
             ai.responsibility,
             ai.measurement,
             ai.frequency,
             ai.target_value,
             ai.marks,
             t.name AS template_name,
             e.entry_date::text AS entry_date,
             e.status,
             e.remarks,
             e.score
        FROM hr_kra_assignments a
        JOIN hr_kra_assignment_items ai ON ai.assignment_id = a.id
        LEFT JOIN hr_kra_templates t ON t.id = a.template_id
        JOIN hr_employee_profiles p ON p.user_id = a.employee_user_id
        LEFT JOIN hr_employee_profiles mp ON mp.user_id = p.manager_user_id
        LEFT JOIN users mu ON mu.id = p.manager_user_id
        LEFT JOIN hr_kra_daily_entries e
          ON e.assignment_id = a.id
         AND e.assignment_item_id = ai.id
         AND e.entry_date BETWEEN $1::date AND $2::date
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.full_name, COALESCE(ai.category, ''), ai.display_order, ai.id, e.entry_date
    `, params);
  }

  function buildEmployeeKraHtmlReport(rows, month, logoUrl = '') {
    const window = monthWindow(month);
    const days = buildMonthDays(window);
    const employees = new Map();

    for (const row of rows) {
      const employeeKey = String(row.user_id);
      if (!employees.has(employeeKey)) {
        employees.set(employeeKey, {
          meta: {
            full_name: row.full_name || '-',
            employee_code: row.employee_code || '-',
            department: row.department || '-',
            designation: row.designation || '-',
            manager_name: row.manager_name || '-',
            template_name: row.template_name || 'KRA'
          },
          items: new Map()
        });
      }

      const employee = employees.get(employeeKey);
      const itemKey = String(row.assignment_item_id);
      if (!employee.items.has(itemKey)) {
        employee.items.set(itemKey, {
          category: row.category || (row.is_daily_activity ? 'Daily Activities' : 'KRA'),
          key_area: row.key_area || '',
          responsibility: row.responsibility || '',
          measurement: row.measurement || '',
          frequency: row.frequency || '',
          target_value: row.target_value || '',
          marks: Number(row.marks || 0),
          is_daily_activity: row.is_daily_activity === true,
          display_order: Number(row.display_order || 0),
          entries: {},
          remarks: []
        });
      }

      const item = employee.items.get(itemKey);
      if (row.entry_date) {
        item.entries[row.entry_date] = {
          status: row.status || '',
          score: Number(row.score || 0),
          remarks: row.remarks || ''
        };
        if (row.remarks) item.remarks.push(String(row.remarks));
      }
    }

    const sections = [];
    let employeeIndex = 0;

    for (const employee of employees.values()) {
      employeeIndex += 1;
      const groupedByCategory = new Map();
      for (const item of employee.items.values()) {
        if (!groupedByCategory.has(item.category)) groupedByCategory.set(item.category, []);
        groupedByCategory.get(item.category).push(item);
      }

      const bodyRows = [];
      let serial = 1;

      for (const [category, items] of groupedByCategory.entries()) {
        const sortedItems = items.sort((a, b) => a.display_order - b.display_order || a.key_area.localeCompare(b.key_area));
        bodyRows.push(`
          <tr class="section-row">
            <td class="center section-number">${serial}</td>
            <td colspan="5" class="section-title">${escapeHtml(category)}</td>
            ${days.map(() => '<td class="day-cell section-empty"></td>').join('')}
            <td class="section-empty"></td>
            <td class="section-empty"></td>
          </tr>
        `);
        for (const item of sortedItems) {
          const rowTotal = days.reduce((sum, day) => sum + Number(item.entries[day.iso]?.score || 0), 0);
          const remarks = [...new Set(item.remarks.filter(Boolean))].join(' | ');
          const description = [
            item.key_area && item.key_area !== category ? `<div class="item-key-area">${escapeHtml(item.key_area)}</div>` : '',
            `<div class="item-responsibility">${escapeHtml(item.responsibility)}</div>`,
            item.measurement ? `<div class="item-measurement">${escapeHtml(item.measurement)}</div>` : ''
          ].filter(Boolean).join('');

          bodyRows.push(`
            <tr>
              <td class="center">${serial}</td>
              <td>${description}</td>
              <td>${escapeHtml(item.frequency || '-')}</td>
              <td>${escapeHtml(item.target_value || '-')}</td>
              <td class="right">${item.marks ? item.marks.toFixed(2).replace(/\.00$/, '') : '-'}</td>
              <td>${item.is_daily_activity ? 'Daily Activity' : 'KRA'}</td>
              ${days.map((day) => `<td class="center day-cell">${statusGlyph(item.entries[day.iso]?.status || '')}</td>`).join('')}
              <td class="right total-cell">${rowTotal ? rowTotal.toFixed(2).replace(/\.00$/, '') : '-'}</td>
              <td>${escapeHtml(remarks || '')}</td>
            </tr>
          `);
          serial += 1;
        }
      }

      sections.push(`
        <div class="report-page ${employeeIndex < employees.size ? 'page-break' : ''}">
          <table class="meta-table">
            <tr>
              <td class="logo-cell">
                ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="JMS Ocean" class="brand-logo">` : '<div class="brand-logo-text">JMS</div>'}
              </td>
              <td class="company-cell" colspan="${days.length + 7}">
                <div class="company-name">JOYO PLASTICS</div>
                <div class="company-subtitle">HR KRA &amp; PERFORMANCE MANAGEMENT SYSTEM</div>
                <div class="company-period">Daily Check List (${escapeHtml(prettyMonthLabel(window.month))})</div>
              </td>
            </tr>
          </table>

          <table class="employee-meta">
            <tr>
              <td><strong>Name</strong></td>
              <td>${escapeHtml(employee.meta.full_name)}</td>
              <td><strong>Employee Code</strong></td>
              <td>${escapeHtml(employee.meta.employee_code)}</td>
              <td><strong>Manager</strong></td>
              <td>${escapeHtml(employee.meta.manager_name)}</td>
            </tr>
            <tr>
              <td><strong>Department</strong></td>
              <td>${escapeHtml(employee.meta.department)}</td>
              <td><strong>Designation</strong></td>
              <td>${escapeHtml(employee.meta.designation)}</td>
              <td><strong>KRA Template</strong></td>
              <td>${escapeHtml(employee.meta.template_name)}</td>
            </tr>
          </table>

          <table class="kra-table">
            <thead>
              <tr>
                <th rowspan="2" class="center narrow">S.No.</th>
                <th rowspan="2" class="wide">Key Area / Responsibility / Measurement</th>
                <th rowspan="2">Frequency</th>
                <th rowspan="2">Target</th>
                <th rowspan="2" class="center">Marks</th>
                <th rowspan="2" class="center">Type</th>
                <th colspan="${days.length}" class="center">Daily Check List</th>
                <th rowspan="2" class="center">Total Marks</th>
                <th rowspan="2">Remarks</th>
              </tr>
              <tr>
                ${days.map((day) => `<th class="day-head"><div>${String(day.dayNumber).padStart(2, '0')}</div><div class="weekday">${escapeHtml(day.weekday)}</div></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${bodyRows.join('')}
            </tbody>
          </table>

          <table class="approval-table">
            <tr>
              <td>PREPARED BY</td>
              <td>CHECKED BY</td>
              <td>APPROVED BY</td>
            </tr>
          </table>
        </div>
      `);
    }

    if (!sections.length) {
      sections.push(`<div class="report-page"><div class="no-data">No KRA data available for the selected period.</div></div>`);
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #111827; }
    .report-page { padding: 10px 12px; }
    .page-break { page-break-after: always; }
    table { border-collapse: collapse; width: 100%; }
    .meta-table td, .employee-meta td, .kra-table th, .kra-table td, .approval-table td { border: 1px solid #111; }
    .logo-cell { width: 82px; text-align: center; vertical-align: middle; padding: 4px; }
    .brand-logo { width: 46px; height: 46px; display: block; margin: 0 auto; object-fit: contain; }
    .brand-logo-text { width: 46px; height: 46px; line-height: 46px; margin: 0 auto; border: 1px solid #111; border-radius: 8px; font-size: 16px; font-weight: 800; color: #0f5c8f; }
    .company-cell { text-align: center; padding: 6px; }
    .company-name { font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
    .company-subtitle { font-size: 11px; font-weight: 700; margin-top: 2px; }
    .company-period { font-size: 11px; font-style: italic; margin-top: 4px; }
    .employee-meta td { padding: 6px 8px; font-size: 11px; }
    .kra-table th, .kra-table td { padding: 4px 5px; font-size: 10px; vertical-align: top; }
    .kra-table thead th { background: #f3f7fb; }
    .center { text-align: center; }
    .right { text-align: right; }
    .narrow { width: 40px; }
    .wide { width: 360px; }
    .day-head { min-width: 34px; text-align: center; }
    .weekday { font-size: 9px; color: #475569; }
    .day-cell { font-size: 11px; text-align: center; }
    .section-row td { background: #eef6ff; font-weight: 700; }
    .section-title { text-transform: uppercase; letter-spacing: 0.04em; }
    .section-number { background: #e0efff; }
    .section-empty { background: #eef6ff; }
    .item-key-area { font-weight: 700; margin-bottom: 2px; }
    .item-responsibility { font-weight: 600; }
    .item-measurement { color: #475569; margin-top: 2px; font-size: 9px; }
    .total-cell { font-weight: 700; }
    .approval-table { margin-top: 28px; }
    .approval-table td { height: 48px; width: 33.33%; text-align: center; vertical-align: bottom; font-weight: 700; padding-bottom: 8px; }
    .no-data { padding: 40px; text-align: center; font-weight: 700; border: 1px solid #111; }
  </style>
</head>
<body>${sections.join('')}</body>
</html>`;
  }

  async function buildMonthlySummaryRows(currentUser, month, department) {
    const dashboard = await computeDashboard(currentUser, month, department);
    return dashboard.ranking.map((row) => ({
      'Employee Code': row.employee_code,
      'Employee Name': row.full_name,
      Department: row.department,
      Designation: row.designation,
      'Days Updated': row.days_updated,
      'Monthly Score': row.monthly_score,
      'Possible Score': row.possible_score,
      'Performance %': row.performance_percent,
      'Completion %': row.completion_percent,
      Grade: row.grade
    }));
  }

  async function buildDepartmentSummaryRows(currentUser, month) {
    const dashboard = await computeDashboard(currentUser, month, '');
    return dashboard.department_performance.map((row) => ({
      Department: row.department,
      Employees: row.employees,
      'Average Performance %': row.average_performance,
      'Average Completion %': row.average_completion,
      'Top Performer': row.top_performer,
      'Low Performer': row.low_performer
    }));
  }

  app.get('/api/hr-performance/meta', async (req, res) => {
    try {
      const user = await requireSessionUser(req, res);
      if (!user) return;
      res.json({ ok: true, data: await getMetaPayload(user) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/hr-performance/employees', async (req, res) => {
    try {
      const user = await requireHrAccess(req, res);
      if (!user) return;
      res.json({ ok: true, data: await buildEmployeeList() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/hr-performance/employees', async (req, res) => {
    const client = await pool.connect();
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;

      const payload = req.body || {};
      const profileId = payload.id ? Number(payload.id) : null;
      const username = normalizeText(payload.username || payload.employee_code).toLowerCase();
      const password = String(payload.password || '');
      const fullName = normalizeText(payload.full_name || payload.name);
      const employeeCode = normalizeText(payload.employee_code);
      const department = normalizeText(payload.department);
      const designation = normalizeText(payload.designation);
      const roleCode = normalizeRoleCode(payload.role_code || payload.role);
      const managerUserId = payload.manager_user_id ? Number(payload.manager_user_id) : null;
      const factoryId = normalizeFactoryId(payload.factory_id);
      const email = normalizeNullableText(payload.email);
      const phone = normalizeNullableText(payload.phone);

      if (!username) return res.status(400).json({ ok: false, error: 'Username is required' });
      if (!fullName) return res.status(400).json({ ok: false, error: 'Employee name is required' });
      if (!employeeCode) return res.status(400).json({ ok: false, error: 'Employee code is required' });
      if (!department) return res.status(400).json({ ok: false, error: 'Department is required' });
      if (!designation) return res.status(400).json({ ok: false, error: 'Designation is required' });

      await client.query('BEGIN');

      let userId = null;
      if (profileId) {
        const existingProfile = (await client.query(
          `SELECT p.id, p.user_id, u.username
             FROM hr_employee_profiles p
             JOIN users u ON u.id = p.user_id
            WHERE p.id = $1
            LIMIT 1`,
          [profileId]
        )).rows[0];
        if (!existingProfile) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'Employee profile not found' });
        }
        userId = existingProfile.user_id;

        const duplicateUser = (await client.query(
          `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2 LIMIT 1`,
          [username, userId]
        )).rows[0];
        if (duplicateUser) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Username already exists' });
        }

        const duplicateCode = (await client.query(
          `SELECT id FROM hr_employee_profiles WHERE LOWER(employee_code) = LOWER($1) AND id <> $2 LIMIT 1`,
          [employeeCode, profileId]
        )).rows[0];
        if (duplicateCode) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Employee code already exists' });
        }

        const updates = [
          client.query(
            `UPDATE users
                SET username = $1,
                    role_code = $2,
                    line = $3,
                    updated_at = NOW()
              WHERE id = $4`,
            [username, roleCode, designation, userId]
          ),
          client.query(
            `UPDATE hr_employee_profiles
                SET employee_code = $1,
                    full_name = $2,
                    department = $3,
                    designation = $4,
                    manager_user_id = $5,
                    role_code = $6,
                    email = $7,
                    phone = $8,
                    factory_id = $9,
                    updated_at = NOW()
              WHERE id = $10`,
            [employeeCode, fullName, department, designation, managerUserId, roleCode, email, phone, factoryId, profileId]
          )
        ];
        await Promise.all(updates);

        if (password) {
          const hash = await bcrypt.hash(password, 10);
          await client.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [hash, userId]);
        }
      } else {
        if (!password) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Password is required for new employees' });
        }
        const duplicateUser = (await client.query(
          `SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          [username]
        )).rows[0];
        if (duplicateUser) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Username already exists' });
        }
        const duplicateCode = (await client.query(
          `SELECT id FROM hr_employee_profiles WHERE LOWER(employee_code) = LOWER($1) LIMIT 1`,
          [employeeCode]
        )).rows[0];
        if (duplicateCode) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Employee code already exists' });
        }
        const hash = await bcrypt.hash(password, 10);
        const insertedUser = (await client.query(
          `INSERT INTO users(username, password, line, role_code, permissions, is_active, global_access, updated_at)
           VALUES($1, $2, $3, $4, '{}'::jsonb, TRUE, FALSE, NOW())
           RETURNING id`,
          [username, hash, designation, roleCode]
        )).rows[0];
        userId = insertedUser.id;
        await client.query(
          `INSERT INTO hr_employee_profiles(user_id, employee_code, full_name, department, designation, manager_user_id, role_code, email, phone, factory_id, is_active, created_by, updated_at)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, NOW())`,
          [userId, employeeCode, fullName, department, designation, managerUserId, roleCode, email, phone, factoryId, actor.username]
        );
      }

      await client.query('DELETE FROM user_factories WHERE user_id = $1', [userId]);
      if (factoryId !== null) {
        await client.query(
          `INSERT INTO user_factories(user_id, factory_id)
           VALUES($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, factoryId]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, message: profileId ? 'Employee updated' : 'Employee created' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });

  app.delete('/api/hr-performance/employees/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;
      const profileId = Number(req.params.id);
      const profile = (await client.query(
        `SELECT id, user_id FROM hr_employee_profiles WHERE id = $1 LIMIT 1`,
        [profileId]
      )).rows[0];
      if (!profile) return res.status(404).json({ ok: false, error: 'Employee not found' });

      await client.query('BEGIN');
      await client.query('DELETE FROM users WHERE id = $1', [profile.user_id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/hr-performance/templates', async (req, res) => {
    try {
      const user = await requireSessionUser(req, res);
      if (!user) return;
      const templates = await buildTemplateList(user);
      if (req.query.include_items === '1') {
        const detailed = [];
        for (const template of templates) {
          detailed.push(await loadTemplateDetails(template.id));
        }
        return res.json({ ok: true, data: detailed });
      }
      res.json({ ok: true, data: templates });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/hr-performance/templates', async (req, res) => {
    const client = await pool.connect();
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;
      const payload = req.body || {};
      const templateId = payload.id ? Number(payload.id) : null;
      const name = normalizeText(payload.name);
      const department = normalizeNullableText(payload.department);
      const description = normalizeNullableText(payload.description);
      const frequency = normalizeText(payload.frequency, 'Daily');
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!name) return res.status(400).json({ ok: false, error: 'Template name is required' });
      if (!items.length) return res.status(400).json({ ok: false, error: 'Add at least one KRA item' });

      const normalizedItems = items.map((item, index) => ({
        item_type: String(item.item_type || (item.is_daily_activity ? 'daily_activity' : 'kra')).trim() || 'kra',
        category: normalizeNullableText(item.category || (item.is_daily_activity ? 'Daily Activities' : 'KRA')),
        key_area: normalizeText(item.key_area || item.title || item.category),
        responsibility: normalizeText(item.responsibility || item.key_area || item.title || item.category),
        measurement: normalizeNullableText(item.measurement),
        frequency: normalizeNullableText(item.frequency || frequency),
        target_value: normalizeNullableText(item.target_value || item.target),
        marks: toMarks(item.marks),
        display_order: Number(item.display_order ?? index + 1) || (index + 1),
        is_daily_activity: !!item.is_daily_activity || String(item.item_type || '').toLowerCase().includes('daily')
      }));

      await client.query('BEGIN');

      let resolvedTemplateId = templateId;
      if (templateId) {
        await client.query(
          `UPDATE hr_kra_templates
              SET name = $1,
                  department = $2,
                  description = $3,
                  frequency = $4,
                  updated_at = NOW()
            WHERE id = $5`,
          [name, department, description, frequency, templateId]
        );
        await client.query('DELETE FROM hr_kra_template_items WHERE template_id = $1', [templateId]);
      } else {
        const inserted = (await client.query(
          `INSERT INTO hr_kra_templates(name, department, description, frequency, created_by, factory_id, updated_at)
           VALUES($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id`,
          [name, department, description, frequency, actor.username, null]
        )).rows[0];
        resolvedTemplateId = inserted.id;
      }

      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO hr_kra_template_items(
             template_id, item_type, category, key_area, responsibility, measurement, frequency, target_value, marks, display_order, is_daily_activity
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            resolvedTemplateId,
            item.item_type,
            item.category,
            item.key_area,
            item.responsibility,
            item.measurement,
            item.frequency,
            item.target_value,
            item.marks,
            item.display_order,
            item.is_daily_activity
          ]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, data: await loadTemplateDetails(resolvedTemplateId) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });

  app.delete('/api/hr-performance/templates/:id', async (req, res) => {
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;
      await exec('DELETE FROM hr_kra_templates WHERE id = $1', [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/hr-performance/assignments', async (req, res) => {
    try {
      const user = await requireSessionUser(req, res);
      if (!user) return;
      res.json({ ok: true, data: await buildAssignmentList(user) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/hr-performance/assignments', async (req, res) => {
    const client = await pool.connect();
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;
      const payload = req.body || {};
      const templateId = Number(payload.template_id);
      const employeeUserId = payload.employee_user_id ? Number(payload.employee_user_id) : null;
      const department = normalizeNullableText(payload.department);
      const startDate = normalizeNullableText(payload.start_date) || new Date().toISOString().slice(0, 10);
      const endDate = normalizeNullableText(payload.end_date);

      if (!templateId) return res.status(400).json({ ok: false, error: 'Template is required' });

      const template = await loadTemplateDetails(templateId);
      if (!template) return res.status(404).json({ ok: false, error: 'Template not found' });
      if (!template.items?.length) return res.status(400).json({ ok: false, error: 'Template has no KRA items' });

      let targetUsers = [];
      if (employeeUserId) {
        targetUsers = [{ user_id: employeeUserId, department: department || null }];
      } else if (department) {
        targetUsers = await q(
          `SELECT user_id, department
             FROM hr_employee_profiles
            WHERE department = $1
              AND COALESCE(is_active, TRUE) = TRUE`,
          [department]
        );
      } else {
        return res.status(400).json({ ok: false, error: 'Select an employee or department' });
      }

      if (!targetUsers.length) {
        return res.status(400).json({ ok: false, error: 'No employees found for this assignment' });
      }

      await client.query('BEGIN');
      let createdCount = 0;
      let skippedCount = 0;

      for (const target of targetUsers) {
        const existing = (await client.query(
          `SELECT id
             FROM hr_kra_assignments
            WHERE employee_user_id = $1
              AND template_id = $2
              AND COALESCE(is_active, TRUE) = TRUE
            LIMIT 1`,
          [target.user_id, templateId]
        )).rows[0];
        if (existing) {
          skippedCount += 1;
          continue;
        }

        const insertedAssignment = (await client.query(
          `INSERT INTO hr_kra_assignments(template_id, employee_user_id, assignment_mode, department, start_date, end_date, assigned_by, is_active)
           VALUES($1, $2, $3, $4, $5::date, $6::date, $7, TRUE)
           RETURNING id`,
          [templateId, target.user_id, employeeUserId ? 'individual' : 'department', department || target.department, startDate, endDate, actor.username]
        )).rows[0];

        for (const item of template.items) {
          await client.query(
            `INSERT INTO hr_kra_assignment_items(
               assignment_id, template_item_id, item_type, category, key_area, responsibility, measurement, frequency, target_value, marks, display_order, is_daily_activity
             ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              insertedAssignment.id,
              item.id,
              item.item_type,
              item.category,
              item.key_area,
              item.responsibility,
              item.measurement,
              item.frequency,
              item.target_value,
              item.marks,
              item.display_order,
              item.is_daily_activity
            ]
          );
        }

        createdCount += 1;
      }

      await client.query('COMMIT');
      res.json({ ok: true, data: { created: createdCount, skipped: skippedCount } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/hr-performance/assignments/:id/toggle', async (req, res) => {
    try {
      const actor = await requireHrAccess(req, res);
      if (!actor) return;
      const assignmentId = Number(req.params.id);
      const active = req.body?.is_active !== false;
      await exec(`UPDATE hr_kra_assignments SET is_active = $1 WHERE id = $2`, [active, assignmentId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/hr-performance/checklist', async (req, res) => {
    try {
      const currentUser = await requireSessionUser(req, res);
      if (!currentUser) return;
      const targetUserId = req.query.employee_user_id ? Number(req.query.employee_user_id) : currentUser.id;
      const entryDate = normalizeText(req.query.entry_date, new Date().toISOString().slice(0, 10));

      if (!isHrManager(currentUser) && targetUserId !== currentUser.id) {
        return res.status(403).json({ ok: false, error: 'You can only view your own checklist' });
      }

      res.json({ ok: true, data: await getChecklistPayload(targetUserId, entryDate) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/hr-performance/checklist', async (req, res) => {
    const client = await pool.connect();
    try {
      const currentUser = await requireSessionUser(req, res);
      if (!currentUser) return;
      const payload = req.body || {};
      const targetUserId = payload.employee_user_id ? Number(payload.employee_user_id) : currentUser.id;
      const entryDate = normalizeText(payload.entry_date, new Date().toISOString().slice(0, 10));
      const entries = Array.isArray(payload.entries) ? payload.entries : [];

      if (!isHrManager(currentUser) && targetUserId !== currentUser.id) {
        return res.status(403).json({ ok: false, error: 'You can only update your own checklist' });
      }

      if (!entries.length) {
        return res.status(400).json({ ok: false, error: 'No checklist entries provided' });
      }

      await client.query('BEGIN');
      for (const item of entries) {
        const assignmentItemId = Number(item.assignment_item_id);
        const assignmentRow = (await client.query(
          `SELECT ai.id AS assignment_item_id,
                  ai.marks,
                  a.id AS assignment_id,
                  a.employee_user_id
             FROM hr_kra_assignment_items ai
             JOIN hr_kra_assignments a ON a.id = ai.assignment_id
            WHERE ai.id = $1
            LIMIT 1`,
          [assignmentItemId]
        )).rows[0];
        if (!assignmentRow) continue;
        if (Number(assignmentRow.employee_user_id) !== targetUserId) continue;

        const status = normalizeChecklistStatus(item.status);
        const factor = STATUS_SCORE_MAP[status];
        const score = Number((toMarks(assignmentRow.marks) * factor).toFixed(2));
        const remarks = normalizeNullableText(item.remarks);

        await client.query(
          `INSERT INTO hr_kra_daily_entries(
             assignment_id, assignment_item_id, employee_user_id, entry_date, status, remarks, score, updated_by, updated_at
           ) VALUES($1, $2, $3, $4::date, $5, $6, $7, $8, NOW())
           ON CONFLICT (employee_user_id, assignment_item_id, entry_date)
           DO UPDATE SET
             status = EXCLUDED.status,
             remarks = EXCLUDED.remarks,
             score = EXCLUDED.score,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [
            assignmentRow.assignment_id,
            assignmentItemId,
            targetUserId,
            entryDate,
            status,
            remarks,
            score,
            currentUser.username
          ]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, data: await getChecklistPayload(targetUserId, entryDate) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/hr-performance/dashboard', async (req, res) => {
    try {
      const user = await requireSessionUser(req, res);
      if (!user) return;
      const department = isHrManager(user) ? normalizeNullableText(req.query.department) : null;
      const data = await computeDashboard(user, req.query.month, department);
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/hr-performance/reports/export', async (req, res) => {
    try {
      const user = await requireSessionUser(req, res);
      if (!user) return;
      const type = normalizeText(req.query.type, 'employee').toLowerCase();
      const department = isHrManager(user) ? normalizeNullableText(req.query.department) : null;
      const employeeUserId = req.query.employee_user_id ? Number(req.query.employee_user_id) : null;

      if (type === 'employee') {
        const reportRows = await buildEmployeeKraReportRows(user, req.query.month, department, employeeUserId);
        const html = buildEmployeeKraHtmlReport(reportRows, req.query.month, buildBrandLogoUrl(req));
        return sendHtmlWorkbook(res, html, 'joyo-plastics-kra-report.xls');
      }

      const workbook = xlsx.utils.book_new();
      let rows = [];
      let sheetName = 'KRA Report';
      let fileName = 'joyo-plastics-kra-report.xlsx';

      if (type === 'department') {
        rows = await buildDepartmentSummaryRows(user, req.query.month);
        sheetName = 'Department Performance';
        fileName = 'joyo-plastics-department-performance.xlsx';
      } else if (type === 'monthly') {
        rows = await buildMonthlySummaryRows(user, req.query.month, department);
        sheetName = 'Monthly Summary';
        fileName = 'joyo-plastics-monthly-performance.xlsx';
      } else {
        rows = await buildDetailedReportRows(user, req.query.month, department, employeeUserId);
        sheetName = 'Employee Performance';
        fileName = 'joyo-plastics-employee-performance.xlsx';
      }

      const worksheet = xlsx.utils.json_to_sheet(rows.length ? rows : [{ Message: 'No data available for selected filters.' }]);
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
      sendWorkbook(res, workbook, fileName);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
};
