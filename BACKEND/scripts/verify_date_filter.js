const http = require('http');

const orderNo = 'JR/JG/2526/5788';
// Use a date that has logs
const date = '2026-03-31'; 
const url = `http://localhost:3000/api/dpr/job-summary?orderNo=${encodeURIComponent(orderNo)}&date=${date}`;

http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const j = JSON.parse(data);
            console.log('--- DATE FILTER VERIFICATION ---');
            console.log('Status:', res.statusCode);
            if (j.data) {
                console.log('Logs Count for', date, ':', j.data.logs.length);
                if (j.data.logs.length > 0) {
                    const sample = j.data.logs[0];
                    console.log('Sample Log Date:', sample.dpr_date);
                }
                console.log('Hourly Trend Length:', j.data.trends.hourly.length);
            } else {
                console.log('Error:', j.error);
            }
        } catch (e) {
            console.error('Parse Error');
        }
    });
});
