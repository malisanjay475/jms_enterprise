const http = require('http');

http.get('http://localhost:3000/api/dpr/job-summary?orderNo=JR/JG/2526/5788&mouldNo=4%20SIDE%20LOCK%209000%20RECTANGLE%20BTM', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Status:', res.statusCode);
            console.log('Logs Length:', json.data?.logs?.length);
            if (json.data?.logs?.length > 0) {
                console.log('Sample Log Good Qty:', json.data.logs[0].good_qty);
            }
        } catch(e) { console.error('Error parsing JSON:', data.substring(0, 100)); }
    });
});
