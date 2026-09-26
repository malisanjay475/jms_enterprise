'use strict';

const fs = require('fs');
const path = require('path');

// An untyped "$n IS NULL" gives Postgres nothing to infer the parameter type from, so
// it rejects the WHOLE query ("could not determine data type of parameter $n"). That
// made GET /api/qc/notifications and /api/qc/verify/summary fail on every call from
// 28-Jun to 26-Sep-2026. Cast the parameter where it is tested for NULL: "$n::text IS NULL".
describe('SQL: no untyped "$n IS NULL" parameters', () => {
  const files = [
    path.join(__dirname, '..', 'src', 'legacy', 'registerLegacyRoutes.js')
  ];

  it.each(files)('%s has no "($n IS NULL OR" without a cast', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const hits = src.split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => /\(\$\d+ IS NULL OR/.test(text));
    expect(hits).toEqual([]);
  });
});
