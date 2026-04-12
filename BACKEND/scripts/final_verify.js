const http = require('http');

const url = 'http://localhost:3000/api/dpr/job-summary?orderNo=JR/JG/2526/5788&mouldNo=4%20SIDE%20LOCK%209000%20RECTANGLE%20BTM';

http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const j = JSON.parse(data);
            console.log('--- API VERIFICATION ---');
            console.log('Status:', res.statusCode);
            if (j.data) {
                console.log('Logs Count:', j.data.logs ? j.data.logs.length : 'N/A');
                console.log('Metadata Mould Name:', j.data.metadata.mouldName);
                console.log('SQL Check (ILIKE):', j.data.debugInfo && j.data.debugInfo.sql.includes('ILIKE'));
                console.log('Sample Log:', j.data.logs[0] ? j.data.logs[0].good_qty : 'None');
            } else {
                console.log('Response Error:', j.error || 'No data');
            }
        } catch (e) {
            console.error('Parse Error:', e.message);
            console.log('Raw Data Segment:', data.substring(0, 200));
        }
    });
}).on('error', (err) => {
    console.error('HTTP Error:', err.message);
});
