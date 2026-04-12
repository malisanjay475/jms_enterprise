const { Pool } = require('pg');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Sanjay@541##',
    database: process.env.DB_NAME || 'jpsms'
});

const JOB_CARD = 'JR/JG/2526/5788';
const PLAN_ID = 'PLN-1774617808725';
const MOULD_NAME = '4 SIDE LOCK 9000 RECTANGLE BTM';
const MACHINE = 'B -L3>AKAR-110-10';
const REPORT_PATH = path.join(__dirname, '..', 'REPORTS', `Mould_Production_Report_5788.xlsx`);

async function generateReport() {
    console.log(`Generating report for ${JOB_CARD} (Plan: ${PLAN_ID})...`);
    
    try {
        const query = `
            SELECT 
                dpr_date, 
                shift, 
                hour_slot, 
                colour, 
                shots, 
                good_qty, 
                reject_qty, 
                remarks, 
                created_by,
                created_at,
                jobcard_no as db_jobcard,
                mould_no as db_mould
            FROM dpr_hourly
            WHERE plan_id = $1 OR (jobcard_no LIKE '%5788%' AND machine = $2)
            ORDER BY dpr_date ASC, shift DESC, created_at ASC
        `;
        
        const res = await pool.query(query, [PLAN_ID, MACHINE]);
        const rows = res.rows;
        
        if (rows.length === 0) {
            console.log('No data found for this Job Card and Mould.');
            return;
        }

        // 1. Prepare Details Sheet
        const detailsData = rows.map(r => ({
            'Date': r.dpr_date.toISOString().split('T')[0],
            'Shift': r.shift,
            'Hour Slot': r.hour_slot,
            'Colour': r.colour,
            'Shots': Number(r.shots) || 0,
            'Good Qty': Number(r.good_qty) || 0,
            'Reject Qty': Number(r.reject_qty) || 0,
            'Remarks': r.remarks || '',
            'Entered By': r.created_by,
            'Entry Time': r.created_at
        }));

        // 2. Prepare Summary Sheet
        const summaryByColour = {};
        const summaryByShift = { 'DAY': { shots: 0, good: 0, reject: 0 }, 'NIGHT': { shots: 0, good: 0, reject: 0 } };

        rows.forEach(r => {
            const colour = r.colour || 'UNKNOWN';
            if (!summaryByColour[colour]) {
                summaryByColour[colour] = { shots: 0, good: 0, reject: 0 };
            }
            const s = Number(r.shots) || 0;
            const g = Number(r.good_qty) || 0;
            const rej = Number(r.reject_qty) || 0;

            summaryByColour[colour].shots += s;
            summaryByColour[colour].good += g;
            summaryByColour[colour].reject += rej;

            const shift = (r.shift || '').toUpperCase();
            if (summaryByShift[shift]) {
                summaryByShift[shift].shots += s;
                summaryByShift[shift].good += g;
                summaryByShift[shift].reject += rej;
            }
        });

        const colourSummaryData = Object.keys(summaryByColour).map(c => ({
            'Colour': c,
            'Total Shots': summaryByColour[c].shots,
            'Total Good Qty': summaryByColour[c].good,
            'Total Reject Qty': summaryByColour[c].reject
        }));

        const shiftSummaryData = Object.keys(summaryByShift).map(s => ({
            'Shift': s,
            'Total Shots': summaryByShift[s].shots,
            'Total Good Qty': summaryByShift[s].good,
            'Total Reject Qty': summaryByShift[s].reject
        }));

        // Create Workbook
        const wb = xlsx.utils.book_new();
        
        const wsDetails = xlsx.utils.json_to_sheet(detailsData);
        xlsx.utils.book_append_sheet(wb, wsDetails, 'Production Details');

        const wsColourSummary = xlsx.utils.json_to_sheet(colourSummaryData);
        xlsx.utils.book_append_sheet(wb, wsColourSummary, 'Colour Summary');

        const wsShiftSummary = xlsx.utils.json_to_sheet(shiftSummaryData);
        xlsx.utils.book_append_sheet(wb, wsShiftSummary, 'Shift Summary');

        xlsx.writeFile(wb, REPORT_PATH);
        
        console.log(`Report successfully generated at: ${REPORT_PATH}`);

    } catch (err) {
        console.error('Error generating report:', err);
    } finally {
        await pool.end();
    }
}

generateReport();
