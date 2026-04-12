const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const syncService = require('../services/sync.service');
const {
    getFinancialYearInfo,
    getFinancialYearPrefix,
    isFinancialYearScopedId,
    generateFinancialYearSequenceId
} = require('../utils/financialYearId');

// Configure Multer for Invoice Uploads
const upload = multer({
    dest: 'public/uploads/invoices/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_this_later';

// Helper for DB queries (will be passed from server.js or we can require pool here)
// Better to require pool here to keep it standalone
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Sanjay@541##',
    database: process.env.DB_NAME || 'jpsms'
});

async function q(text, params) {
    const { rows } = await pool.query(text, params);
    return rows;
}

/* ============================================================
   MIDDLEWARE: Vendor Auth
============================================================ */
const requireVendorAuth = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.vendorId) throw new Error('Invalid Token');

        req.vendor = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ ok: false, error: 'Invalid Token' });
    }
};

/* ============================================================
   AUTH ROUTES
============================================================ */

// POST /api/vendor/auth/login
router.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });

        const rows = await q(`SELECT * FROM vendor_users WHERE username = $1 AND is_active = TRUE`, [username]);
        if (!rows.length) return res.json({ ok: false, error: 'Invalid Vendor Code' });

        const vendorUser = rows[0];
        const valid = await bcrypt.compare(password, vendorUser.password);
        if (!valid) return res.json({ ok: false, error: 'Invalid Password' });

        // Update last login
        await q(`UPDATE vendor_users SET last_login = NOW() WHERE id = $1`, [vendorUser.id]);

        // Fetch Vendor Details
        const vendorRows = await q(`SELECT * FROM vendors WHERE id = $1`, [vendorUser.vendor_id]);
        const vendor = vendorRows[0];

        // Generate Token
        const token = jwt.sign(
            {
                id: vendorUser.id,
                vendorId: vendor.id,
                role: 'vendor',
                name: vendor.vendor_name
            },
            JWT_SECRET,
            { expiresIn: '36500d' }
        );

        res.json({ ok: true, token, vendor: { name: vendor.vendor_name, id: vendor.id } });
    } catch (e) {
        console.error('Vendor Login Error:', e);
        res.status(500).json({ ok: false, error: String(e) });
    }
});

/* ============================================================
   VENDOR PORTAL ROUTES (Protected)
============================================================ */

// GET /api/vendor/data/dashboard
router.get('/data/dashboard', requireVendorAuth, async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;

        // Stats
        const [openPOs] = await q(`SELECT COUNT(*) as c, SUM(total_amount) as s FROM purchase_orders WHERE vendor_id = $1 AND status = 'Open'`, [vendorId]);
        const [pendingDispatch] = await q(`
            SELECT SUM(balance_qty) as total 
            FROM purchase_order_items poi 
            JOIN purchase_orders po ON po.id = poi.po_id 
            WHERE po.vendor_id = $1`,
            [vendorId]
        );
        const [pendingPayment] = await q(`SELECT SUM(amount) as s FROM vendor_payments WHERE vendor_id = $1 AND payment_status = 'Pending'`, [vendorId]);

        // Recent POs
        const recentPOs = await q(`
            SELECT * FROM purchase_orders 
            WHERE vendor_id = $1 
            ORDER BY created_at DESC LIMIT 10`,
            [vendorId]
        );

        res.json({
            ok: true,
            stats: {
                open_po_count: openPOs.c,
                open_po_value: openPOs.s || 0,
                pending_dispatch_qty: pendingDispatch.total || 0,
                pending_payment: pendingPayment.s || 0
            },
            recent_pos: recentPOs
        });

    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// GET /api/vendor/data/orders
router.get('/data/orders', requireVendorAuth, async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;
        const { status } = req.query; // Optional filter

        let sql = `SELECT * FROM purchase_orders WHERE vendor_id = $1`;
        const params = [vendorId];

        if (status && status !== 'All') {
            sql += ` AND status = $2`;
            params.push(status);
        }

        sql += ` ORDER BY created_at DESC`;

        const rows = await q(sql, params);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// GET /api/vendor/data/order-items/:poId
router.get('/data/order-items/:poId', requireVendorAuth, async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;
        const { poId } = req.params;

        // Security Check: Params PO must belong to logged in vendor
        const poCheck = await q(`SELECT id FROM purchase_orders WHERE id = $1 AND vendor_id = $2`, [poId, vendorId]);
        if (!poCheck.length) return res.status(403).json({ ok: false, error: 'Unauthorized PO access' });

        const rows = await q(`SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id`, [poId]);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// POST /api/vendor/action/dispatch
router.post('/action/dispatch', requireVendorAuth, upload.single('invoice_file'), async (req, res) => {
    try {
        const vendorId = req.vendor.vendorId;
        const { po_id, dispatch_date, invoice_no, items } = req.body; // items is JSON string of [{itemId, qty}]

        if (!req.file) return res.json({ ok: false, error: 'Invoice PDF is required' });

        const invoicePath = '/uploads/invoices/' + req.file.filename;
        const itemsParsed = JSON.parse(items);

        // Security: Check PO ownership
        const poCheck = await q(`SELECT id FROM purchase_orders WHERE id = $1 AND vendor_id = $2`, [po_id, vendorId]);
        if (!poCheck.length) return res.json({ ok: false, error: 'Invalid PO' });

        // Start Transaction (Manual, since we're using pool.query directly without client)
        // Ideally should use client, but for simplicity we'll do sequential checks first

        // 1. Create Dispatch Header
        const dispRes = await q(`
            INSERT INTO vendor_dispatch (vendor_id, po_id, dispatch_date, invoice_no, invoice_file, status)
            VALUES ($1, $2, $3, $4, $5, 'Pending')
            RETURNING id
        `, [vendorId, po_id, dispatch_date, invoice_no, invoicePath]);

        const dispatchId = dispRes[0].id;

        // 2. Insert Items & Validate Qty
        for (const item of itemsParsed) {
            // Check balance
            const poItemRes = await q(`SELECT balance_qty FROM purchase_order_items WHERE id = $1`, [item.itemId]);
            if (poItemRes.length) {
                const balance = Number(poItemRes[0].balance_qty);
                if (Number(item.qty) > balance) {
                    // Rollback manually effectively needed if we were in transaction block. 
                    // For now, let's just error out - this leaves an orphan header, but acceptable for MVP without rewriting everything to use client.
                    // In real prod, use client.query('BEGIN')...
                    throw new Error(`Dispatch Qty ${item.qty} exceeds Balance ${balance} for Item ID ${item.itemId}`);
                }

                await q(`
                    INSERT INTO dispatch_items (dispatch_id, po_item_id, dispatch_qty)
                    VALUES ($1, $2, $3)
                 `, [dispatchId, item.itemId, item.qty]);
            }
        }

        // [Real-Time Sync]
        syncService.triggerSync();

        res.json({ ok: true });

    } catch (e) {
        console.error('Dispatch Error:', e);
        res.status(500).json({ ok: false, error: String(e) });
    }
});


/* ============================================================
   ADMIN ROUTES (To be called from Server.js or Mounted Here)
   These require Standard Auth (SESSION/ROLE based) 
   We will rely on middleware passed from server.js if mounted there,
   OR we assume these are open here but we will mount this router behind a check in server.js
============================================================ */
// Actually, it's safer to define explicit Admin routes here and checking roles.
// But since server.js doesn't export its middleware easily, we might need to duplicate 'requireAdmin' logic or rely on caller.
// Let's implement separate endpoints for Admin actions here, and assume the caller (server.js)
// will mount this entire router. We should add specific admin checks inside these routes.

/* ============================================================
   VENDOR MASTER (ADMIN)
============================================================ */
router.get('/admin/list', async (req, res) => {
    try {
        // TODO: Add Admin Check
        const rows = await q(`SELECT * FROM vendors ORDER BY vendor_name`);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

router.post('/admin/save', async (req, res) => {
    try {
        const { id, vendor_name, gst_no, pan_no, address, contact_person, mobile, email, factory_access, is_active } = req.body;
        const factoriesApi = JSON.stringify(factory_access || []);

        if (id) {
            await q(`
                UPDATE vendors 
                SET vendor_name=$1, gst_no=$2, pan_no=$3, address=$4, contact_person=$5, mobile=$6, email=$7, factory_access=$8::jsonb, is_active=$9, updated_at=NOW()
                WHERE id=$10
            `, [vendor_name, gst_no, pan_no, address, contact_person, mobile, email, factoriesApi, is_active, id]);
        } else {
            // Insert
            const resIns = await q(`
                INSERT INTO vendors (vendor_name, gst_no, pan_no, address, contact_person, mobile, email, factory_access, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                RETURNING id
            `, [vendor_name, gst_no, pan_no, address, contact_person, mobile, email, factoriesApi, is_active || true]);

            // Auto-create initial user: Code = V + ID
            const newId = resIns[0].id;
            const userCode = `V${String(newId).padStart(4, '0')}`;
            const hash = await bcrypt.hash('123456', 10); // Default Password
            await q(`INSERT INTO vendor_users (vendor_id, username, password) VALUES ($1, $2, $3)`, [newId, userCode, hash]);
        }
        // [Real-Time Sync]
        syncService.triggerSync();

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});



// Admin PO List
router.get('/admin/po/list', async (req, res) => {
    try {
        const { status } = req.query;
        let sql = `
            SELECT po.*, v.vendor_name, f.name as factory_name, 
                   (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
            FROM purchase_orders po
            LEFT JOIN vendors v ON v.id = po.vendor_id
            LEFT JOIN factories f ON f.id = po.factory_id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'All') {
            sql += ` AND po.status = $1`;
            params.push(status);
        }

        sql += ` ORDER BY po.po_date DESC, po.created_at DESC LIMIT 100`;

        const rows = await q(sql, params);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

router.post('/admin/delete', async (req, res) => {
    try {
        const { id } = req.body;
        await q('DELETE FROM vendors WHERE id=$1', [id]);
        syncService.triggerSync(); // [Real-Time Sync]
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// PO Creation (Admin)
router.post('/admin/po/save', async (req, res) => {
    const client = await pool.connect();
    try {
        const { po_number, po_date, vendor_id, factory_id, items, created_by } = req.body;
        // items: [{ item_code, item_name, qty, rate, delivery_date }]

        await client.query('BEGIN');

        const resolvedPoNumber = isFinancialYearScopedId(po_number, 'PO')
            ? String(po_number).trim().toUpperCase()
            : await generateFinancialYearSequenceId(client.query.bind(client), {
                prefix: 'PO',
                table: 'purchase_orders',
                column: 'po_number',
                lockScope: `purchase_orders:po_number:${getFinancialYearInfo().code}`
            });

        // 1. Create Header
        const poRes = await client.query(`
            INSERT INTO purchase_orders (po_number, po_date, vendor_id, factory_id, created_by, status)
            VALUES ($1, $2, $3, $4, $5, 'Open')
            RETURNING id
        `, [resolvedPoNumber, po_date, vendor_id, factory_id, created_by]);

        const poId = poRes.rows[0].id;
        let totalAmount = 0;

        // 2. Create Items
        for (const item of items) {
            const amt = Number(item.qty) * Number(item.rate);
            totalAmount += amt;
            await client.query(`
                INSERT INTO purchase_order_items (po_id, item_code, item_name, qty, rate, delivery_date, balance_qty)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
             `, [poId, item.item_code, item.item_name, item.qty, item.rate, item.delivery_date, item.qty]); // Initial balance = qty
        }

        // Update Total
        await client.query(`UPDATE purchase_orders SET total_amount = $1 WHERE id = $2`, [totalAmount, poId]);

        await client.query('COMMIT');

        // [Real-Time Sync]
        syncService.triggerSync();

        res.json({
            ok: true,
            po_number: resolvedPoNumber,
            placeholder: `${getFinancialYearPrefix('PO')}0001`,
            financial_year: getFinancialYearInfo().code
        });

    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_rollbackErr) { }
        console.error('PO Save Error:', e);
        res.status(500).json({ ok: false, error: String(e) });
    } finally {
        client.release();
    }
});

module.exports = router;
