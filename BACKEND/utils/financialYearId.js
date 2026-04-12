'use strict';

const INDIA_TIME_ZONE = 'Asia/Kolkata';

function normalizeDateInput(dateInput = new Date()) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Invalid date supplied for financial year calculation');
    }
    return date;
}

function getIndiaDateParts(dateInput = new Date()) {
    const date = normalizeDateInput(dateInput);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: INDIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const lookup = {};

    for (const part of parts) {
        if (part.type !== 'literal') {
            lookup[part.type] = part.value;
        }
    }

    return {
        year: Number(lookup.year),
        month: Number(lookup.month),
        day: Number(lookup.day)
    };
}

function getFinancialYearInfo(dateInput = new Date()) {
    const { year, month } = getIndiaDateParts(dateInput);
    const startYear = month >= 4 ? year : year - 1;
    const endYear = startYear + 1;

    return {
        startYear,
        endYear,
        code: `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`,
        timeZone: INDIA_TIME_ZONE
    };
}

function getFinancialYearPrefix(prefix, dateInput = new Date()) {
    const cleanPrefix = String(prefix || '').trim().toUpperCase();
    if (!cleanPrefix) throw new Error('ID prefix is required');
    return `${cleanPrefix}-${getFinancialYearInfo(dateInput).code}-`;
}

function isFinancialYearScopedId(value, prefix) {
    const cleanPrefix = String(prefix || '').trim().toUpperCase();
    const raw = String(value || '').trim().toUpperCase();
    if (!cleanPrefix || !raw) return false;
    const pattern = new RegExp(`^${cleanPrefix}-\\d{4}-\\d+$`);
    return pattern.test(raw);
}

async function runQuery(queryFn, text, params) {
    const result = await queryFn(text, params);
    if (Array.isArray(result)) return result;
    return result && Array.isArray(result.rows) ? result.rows : [];
}

async function generateFinancialYearSequenceId(queryFn, options) {
    const {
        prefix,
        table,
        column,
        pad = 4,
        date = new Date(),
        lockScope
    } = options || {};

    const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (!identifierPattern.test(String(table || ''))) throw new Error(`Unsafe table identifier: ${table}`);
    if (!identifierPattern.test(String(column || ''))) throw new Error(`Unsafe column identifier: ${column}`);

    const fyPrefix = getFinancialYearPrefix(prefix, date);
    const queryPrefix = `${fyPrefix}%`;
    const scopeKey = lockScope || `${table}:${column}:${fyPrefix}`;

    await runQuery(queryFn, 'SELECT pg_advisory_xact_lock(hashtext($1))', [scopeKey]);

    const rows = await runQuery(
        queryFn,
        `SELECT ${column} AS value
           FROM ${table}
          WHERE ${column} LIKE $1
          ORDER BY COALESCE(NULLIF(substring(${column} FROM '([0-9]+)$'), ''), '0')::int DESC
          LIMIT 1`,
        [queryPrefix]
    );

    const lastValue = String(rows[0] && rows[0].value || '').trim().toUpperCase();
    const match = lastValue.match(/(\d+)$/);
    const nextNumber = match ? Number(match[1]) + 1 : 1;

    return `${fyPrefix}${String(nextNumber).padStart(pad, '0')}`;
}

module.exports = {
    INDIA_TIME_ZONE,
    getFinancialYearInfo,
    getFinancialYearPrefix,
    isFinancialYearScopedId,
    generateFinancialYearSequenceId
};
