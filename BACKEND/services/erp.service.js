const { Pool } = require('pg');
require('dotenv').config();
const {
    getFinancialYearInfo,
    generateFinancialYearSequenceId
} = require('../utils/financialYearId');

// Re-use connection pool logic or import from server if possible, 
// using generic pool for now to ensure standalone functionality
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Sanjay@541##',
    database: process.env.DB_NAME || 'jpsms'
});

const SERVICE_NAME = 'ERP_SERVICE';

/**
 * Helper: Log Sync Activity
 */
async function logSync(endpoint, status, payloadHash, error = null) {
    try {
        await pool.query(
            `INSERT INTO erp_sync_log (endpoint, status, payload_hash, error_message) VALUES ($1, $2, $3, $4)`,
            [endpoint, status, payloadHash, error]
        );
    } catch (e) {
        console.error('[ERP Log] Failed to log:', e.message);
    }
}

/**
 * 1. UPSERT MOULD PLAN
 * Target Table: plan_board
 * Logic: Match by 'erp_ref_id' OR (order_no + mould + date).
 * For now, we assume simple insert/update based on unique keys if defined.
 */
async function upsertMouldPlan(payload) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const item of payload.mould_details) {
            // Mapping fields
            // JPSMS: plan_id, machine, mould_name, plan_qty
            // ERP: plan_date, machine_name, mould_code

            // Generate a plan_id if not exists?
            // Usually Plan Board ID is JPSMS internal.
            // We use 'erp_ref_id' (which we added in migration) to track uniqueness.
            // If ERP doesn't send ID, we construct one: MD5(machine+date+mould)

            const erpRef = item.or_jr_no + '_' + item.mould_code + '_' + item.plan_date;

            const sql = `
                INSERT INTO plan_board 
                (machine, mould_name, item_code, plan_qty, start_date, status, erp_ref_id, order_no)
                VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $7)
                ON CONFLICT (plan_id) DO NOTHING -- Plan ID is not known here, so we rely on finding it first?
            `;

            // BETTER: Check if exists via erp_ref_id
            const check = await client.query('SELECT id FROM plan_board WHERE erp_ref_id = $1', [erpRef]);

            if (check.rows.length > 0) {
                // Update
                await client.query(`
                    UPDATE plan_board SET 
                        plan_qty = $1, 
                        updated_at = NOW()
                    WHERE erp_ref_id = $2
                `, [item.plan_qty, erpRef]);
            } else {
                // Insert
                const planId = await generateFinancialYearSequenceId(client.query.bind(client), {
                    prefix: 'PLN',
                    table: 'plan_board',
                    column: 'plan_id',
                    lockScope: `plan_board:plan_id:${getFinancialYearInfo().code}`
                });

                await client.query(`
                    INSERT INTO plan_board 
                    (plan_id, machine, mould_name, item_code, plan_qty, start_date, status, erp_ref_id, order_no)
                    VALUES ($1, $2, $3, $4, $5, $6, 'PLANNED', $7, $8)
                 `, [
                    planId,
                    item.machine_name,
                    item.mould_name,
                    item.mould_code,
                    item.plan_qty,
                    item.plan_date,
                    erpRef,
                    item.or_jr_no
                ]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * 2. UPSERT JOB CARD DETAILS
 * Target Table: jc_details (JSONB)
 */
async function upsertJcDetails(payload) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const jc of payload.job_cards) {
            // jc has job_card_no
            // We use the JSONB unique index on data->>'job_card_no'

            // Check if exists
            const check = await client.query(`
                SELECT id FROM jc_details WHERE data->>'job_card_no' = $1
            `, [jc.job_card_no]);

            if (check.rows.length > 0) {
                // Update JSON
                await client.query(`
                    UPDATE jc_details SET data = $1, updated_at = NOW()
                    WHERE id = $2
                `, [JSON.stringify(jc), check.rows[0].id]);
            } else {
                // Insert
                await client.query(`
                    INSERT INTO jc_details (data) VALUES ($1)
                `, [JSON.stringify(jc)]);
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * 3. UPDATE OR/JR STATUS
 * Target Table: or_jr_report (Assumed table) or just log it if table structure strictly varies
 */
async function upsertOrJr(payload) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // We might need to check if 'or_jr_report' table exists and has status column
        // Assuming it does from previous analysis

        for (const update of payload.updates) {
            // Try Update
            await client.query(`
                UPDATE or_jr_report 
                SET status = $1
                WHERE or_jr_no = $2
             `, [update.status, update.or_jr_no]);
        }

        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * 4. CREATE BOM VERSION
 * Target: bom_master, bom_components
 */
async function createBomVersion(payload) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get current max version
        const res = await client.query(`
            SELECT MAX(version) as max_v FROM bom_master WHERE product_code = $1
        `, [payload.product_code]);

        const nextVersion = (res.rows[0].max_v || 0) + 1;

        // 2. Deactivate previous
        await client.query(`
            UPDATE bom_master SET is_active = FALSE WHERE product_code = $1
        `, [payload.product_code]);

        // 3. Insert New Master
        const masterRes = await client.query(`
            INSERT INTO bom_master (erp_bom_id, product_code, version, is_active)
            VALUES ($1, $2, $3, TRUE)
            RETURNING id
        `, [payload.erp_bom_id, payload.product_code, nextVersion]);

        const masterId = masterRes.rows[0].id;

        // 4. Insert Components
        for (const comp of payload.components) {
            await client.query(`
                INSERT INTO bom_components (bom_master_id, component_code, description, qty_per_unit, uom)
                VALUES ($1, $2, $3, $4, $5)
            `, [masterId, comp.component_code, comp.description || '', comp.qty_per_unit, comp.uom]);
        }

        await client.query('COMMIT');
        return { version: nextVersion };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}


module.exports = {
    logSync,
    upsertMouldPlan,
    upsertJcDetails,
    upsertOrJr,
    createBomVersion
};
