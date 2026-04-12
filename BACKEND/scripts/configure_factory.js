const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');
const EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const DEFAULT_MAIN_URL = ''; // Default to empty for local only

console.log('--- JPSMS FACTORY SETUP (LOCAL ONLY) ---\n');

async function setup() {
    // 1. Check if .env exists
    if (fs.existsSync(ENV_PATH)) {
        console.log('✅ Configuration file (.env) already exists.');
        const content = fs.readFileSync(ENV_PATH, 'utf8');
        if (content.includes('LOCAL_FACTORY_ID')) {
            console.log('   Factory ID seems to be set.');
            rl.close();
            return;
        }
    } else {
        console.log('Creating .env file from template...');
        fs.copyFileSync(EXAMPLE_PATH, ENV_PATH);
    }

    // 2. Ask for Details
    askQuestions();
}

const questions = [
    { key: 'LOCAL_FACTORY_ID', q: 'Enter this Factory\'s ID (e.g. 4): ' },
    // { key: 'SYNC_API_KEY', q: 'Enter Sync API Key (Leave empty to use default): ' } // Skipped for Standalone
];

const answers = {};
let qIndex = 0;

function askQuestions() {
    if (qIndex >= questions.length) {
        return writeConfig();
    }
    const curr = questions[qIndex];
    rl.question(curr.q, (ans) => {
        if (curr.key === 'LOCAL_FACTORY_ID' && !ans.trim()) {
            console.log('Factory ID is required!');
            return askQuestions();
        }
        answers[curr.key] = ans.trim();
        qIndex++;
        askQuestions();
    });
}

function writeConfig() {
    let env = fs.readFileSync(ENV_PATH, 'utf8');

    // Update Factory ID
    env = env.replace(/LOCAL_FACTORY_ID=.*/g, `LOCAL_FACTORY_ID=${answers.LOCAL_FACTORY_ID}`);

    // Update Server Type
    env = env.replace(/SERVER_TYPE=.*/g, `SERVER_TYPE=STANDALONE`);

    // Update URL
    env = env.replace(/MAIN_SERVER_URL=.*/g, `MAIN_SERVER_URL=`);

    // Update Key if provided


    fs.writeFileSync(ENV_PATH, env);
    console.log('\n✅ Configuration Saved!');
    console.log(`   Factory ID: ${answers.LOCAL_FACTORY_ID}`);
    console.log(`   Server Type: STANDALONE`);
    console.log(`   Main Server: (Disconnected)`);
    rl.close();
}

setup();
