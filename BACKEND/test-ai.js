require('dotenv').config();

async function checkModels() {
    console.log("Checking available models via REST API...");
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("No API Key found in .env");
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.log("ListModels Error Status:", response.status);
            const txt = await response.text();
            console.log("Body:", txt);
            return;
        }

        const data = await response.json();
        console.log("AVAILABLE MODELS FOR THIS KEY:");
        const models = data.models || [];
        if (models.length === 0) {
            console.log("No models found in the list.");
        }
        models.forEach(m => console.log(`- ${m.name}`));

    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

checkModels();
