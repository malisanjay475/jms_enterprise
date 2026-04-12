const fetch = require('node-fetch');
const { Pool } = require('pg');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000/api/erp';
const TOKEN = process.env.ERP_API_TOKEN || 'test-token'; // Ensure this matches .env

async function runTests() {
    console.log('--- STARTING ERP INTEGRATION TESTS ---');
    console.log(`Target: ${BASE_URL}`);

    // 1. Test Auth Failure
    try {
        const res = await fetch(`${BASE_URL}/mould-plan-summary`, { method: 'POST' });
        if (res.status === 401) console.log('✅ Auth Check Passed (401 received without token)');
        else console.error('❌ Auth Check Failed', res.status);
    } catch (e) { console.error('❌ Auth Check Error', e.message); }

    // 2. Test Mould Plan
    try {
        const payload = {
            "mould_details": [{
                "plan_date": "2024-03-01",
                "machine_name": "TEST-MAC-01",
                "mould_code": "TEST-MOULD-01",
                "mould_name": "Test Mould",
                "plan_qty": 100,
                "or_jr_no": "TEST-OR-001"
            }]
        };
        const res = await fetch(`${BASE_URL}/mould-plan-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (res.ok && json.ok) console.log('✅ Mould Plan Sync Passed');
        else console.error('❌ Mould Plan Sync Failed', json);
    } catch (e) { console.error('❌ Mould Plan Error', e.message); }

    // 3. Test BOM Master (Versioning)
    try {
        const payload = {
            "product_code": "TEST-PROD-001",
            "erp_bom_id": "BOM-TEST-V1",
            "components": [
                { "component_code": "COMP-01", "qty_per_unit": 2, "uom": "NOS" }
            ]
        };
        const res = await fetch(`${BASE_URL}/bom-master`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (res.ok && json.ok) console.log(`✅ BOM Sync Passed (Version: ${json.version})`);
        else console.error('❌ BOM Sync Failed', json);
    } catch (e) { console.error('❌ BOM Sync Error', e.message); }

    console.log('--- TESTS COMPLETED ---');
}

runTests();
