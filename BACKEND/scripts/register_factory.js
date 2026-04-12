const fetch = require('node-fetch');
const readline = require('readline');

// CONFIG
const MAIN_SERVER_URL = 'http://72.62.228.195:3000';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('--- REGISTER NEW FACTORY ON VPS ---');
console.log(`Target VPS: ${MAIN_SERVER_URL}\n`);

const questions = [
    { key: 'name', q: 'Factory Name (e.g. "Mumbai Unit"): ' },
    { key: 'code', q: 'Factory Code (e.g. "MUM01"): ' },
    { key: 'location', q: 'Location (e.g. "Mumbai"): ' }
];

const answers = {};
let qIndex = 0;

function ask() {
    if (qIndex >= questions.length) {
        return submit();
    }
    const curr = questions[qIndex];
    rl.question(curr.q, (ans) => {
        if (!ans.trim()) {
            console.log('Value required!');
            return ask();
        }
        answers[curr.key] = ans.trim();
        qIndex++;
        ask();
    });
}

async function submit() {
    rl.close();
    console.log('\nRegistering...');

    try {
        const payload = {
            name: answers.name,
            code: answers.code,
            location: answers.location,
            is_active: true
        };

        const res = await fetch(`${MAIN_SERVER_URL}/api/factories/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const json = await res.json();

        if (json.ok) {
            console.log('\n✅ SUCCESS! Factory Registered.');
            console.log('You can now use this Factory ID in your new Local Server .env file.');
            // Ideally we should print the ID, but the API might not return it if it's an INSERT without returning.
            // Let's fetch the list to show the ID.
            await showList();
        } else {
            console.error('\n❌ FAILED:', json.error);
        }

    } catch (e) {
        console.error('\n❌ ERROR:', e.message);
    }
}

async function showList() {
    console.log('\n--- CURRENT FACTORY LIST ---');
    try {
        const res = await fetch(`${MAIN_SERVER_URL}/api/factories`);
        const json = await res.json();
        if (json.ok) {
            console.table(json.data);
            console.log('\nUse the "id" from above for your LOCAL_FACTORY_ID setting.');
        }
    } catch (e) {
        console.log('Could not fetch list.');
    }
}

ask();
