const http = require('http');

function testAPI(query, desc) {
    return new Promise((resolve) => {
        http.get(`http://localhost:3000/api/dpr/job-summary?${query}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`\n--- Test: ${desc} ---`);
                console.log(`Status: ${res.statusCode}`);
                try {
                    const json = JSON.parse(data);
                    console.log('Success:', json.ok);
                    if (json.ok) {
                        console.log('Plan Qty:', json.data.metadata.planQty);
                        console.log('Efficiency:', json.data.stats.efficiency + '%');
                        console.log('Logs Count:', json.data.logs.length);
                        if (json.data.logs.length > 0) {
                            console.log('Sample Log Audit:', {
                                by: json.data.logs[0].created_by,
                                at: json.data.logs[0].created_at
                            });
                        }
                    } else {
                        console.log('Error Message:', json.error);
                    }
                } catch (e) {
                    console.log('Raw Data:', data.substring(0, 200) + '...');
                }
                resolve();
            });
        }).on('error', err => {
            console.error('Request Error:', err.message);
            resolve();
        });
    });
}

async function runTests() {
    await testAPI('orderNo=JR/JG/2526/5788', 'Full Order (No Mould)');
    await testAPI('orderNo=JR/JG/2526/5788&mouldNo=4%20SIDE%20LOCK%209000%20RECTANGLE%20BTM', 'Specific Mould');
    await testAPI('', 'Missing Order (Error Test)');
}

runTests();
