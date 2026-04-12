const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { validateToken, whitelistIP } = require('../middleware/erp.auth');
const erpService = require('../services/erp.service');
const crypto = require('crypto');

// --- 1. Validation Schemas (Zod) ---

const MouldPlanSchema = z.object({
    mould_details: z.array(z.object({
        plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid Date (YYYY-MM-DD)"),
        machine_name: z.string(),
        mould_code: z.string(),
        mould_name: z.string().optional(),
        plan_qty: z.number().min(0),
        or_jr_no: z.string()
    }))
});

const JobCardSchema = z.object({
    job_cards: z.array(z.object({
        job_card_no: z.string(),
        or_jr_no: z.string(),
        mould_code: z.string(),
        required_qty: z.number().optional(),
        batch_no: z.string().optional()
    }))
});

const StatusUpdateSchema = z.object({
    updates: z.array(z.object({
        or_jr_no: z.string(),
        status: z.string()
    }))
});

const BomSchema = z.object({
    product_code: z.string(),
    erp_bom_id: z.string(),
    components: z.array(z.object({
        component_code: z.string(),
        description: z.string().optional(),
        qty_per_unit: z.number(),
        uom: z.string()
    }))
});


// --- 2. Middleware Stack ---
router.use(validateToken);
router.use(whitelistIP);

// --- 3. Routes ---

// A. Mould Plan Summary
router.post('/mould-plan-summary', async (req, res) => {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    try {
        const validated = MouldPlanSchema.parse(req.body);
        await erpService.upsertMouldPlan(validated);

        await erpService.logSync('/mould-plan-summary', 'SUCCESS', payloadHash);
        res.json({ ok: true, message: 'Plan synced successfully' });
    } catch (e) {
        const errMsg = e instanceof z.ZodError ? JSON.stringify(e.errors) : e.message;
        await erpService.logSync('/mould-plan-summary', 'FAILED', payloadHash, errMsg);
        res.status(400).json({ ok: false, error: errMsg });
    }
});

// B. Job Card Details
router.post('/jc-details', async (req, res) => {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    try {
        const validated = JobCardSchema.parse(req.body);
        await erpService.upsertJcDetails(validated);

        await erpService.logSync('/jc-details', 'SUCCESS', payloadHash);
        res.json({ ok: true, message: 'Job Cards synced' });
    } catch (e) {
        const errMsg = e instanceof z.ZodError ? JSON.stringify(e.errors) : e.message;
        await erpService.logSync('/jc-details', 'FAILED', payloadHash, errMsg);
        res.status(400).json({ ok: false, error: errMsg });
    }
});

// C. Status Updates
router.post('/or-jr-status', async (req, res) => {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    try {
        const validated = StatusUpdateSchema.parse(req.body);
        await erpService.upsertOrJr(validated);

        await erpService.logSync('/or-jr-status', 'SUCCESS', payloadHash);
        res.json({ ok: true, message: 'Status updated' });
    } catch (e) {
        const errMsg = e instanceof z.ZodError ? JSON.stringify(e.errors) : e.message;
        await erpService.logSync('/or-jr-status', 'FAILED', payloadHash, errMsg);
        res.status(400).json({ ok: false, error: errMsg });
    }
});

// D. BOM Master
router.post('/bom-master', async (req, res) => {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    try {
        const validated = BomSchema.parse(req.body);
        const result = await erpService.createBomVersion(validated);

        await erpService.logSync('/bom-master', 'SUCCESS', payloadHash);
        res.json({ ok: true, message: 'BOM Version Created', version: result.version });
    } catch (e) {
        const errMsg = e instanceof z.ZodError ? JSON.stringify(e.errors) : e.message;
        await erpService.logSync('/bom-master', 'FAILED', payloadHash, errMsg);
        res.status(400).json({ ok: false, error: errMsg });
    }
});

module.exports = router;
