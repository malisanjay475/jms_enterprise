const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAI = null;
let model = null;

exports.init = (apiKey) => {
    if (!apiKey) {
        console.warn("AI Service: No API Key provided.");
        return;
    }
    genAI = new GoogleGenerativeAI(apiKey);
    // Using 'gemini-flash-latest' as confirmed by API list
    model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    console.log("AI Service: Initialized Gemini Flash (Latest)");
};

exports.generateSchedule = async (machines, orders) => {
    if (!model) throw new Error("AI Model not initialized");

    const prompt = `
    You are an expert Production Planner.
    I need you to assign the following URGENT PENDING ORDERS to the available MACHINES.

    CONSTRAINTS:
    1. One order per machine.
    2. Suggest a planned_qty matching the remaining_qty.
    3. Return valid JSON only. Array of objects: { machine_id, work_order_id, planned_qty, reason }.
    
    MACHINES (Available):
    ${JSON.stringify(machines.map(m => ({ id: m.id, name: m.machine_name, status: m.status })))}

    PENDING ORDERS (Urgent):
    ${JSON.stringify(orders.map(o => ({ id: o.full_order_number, item: o.item_name, remaining: o.plan_balance })))}

    Respond strictly with JSON array.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("AI Generation Error:", error);
        throw new Error("Failed to generate plan: " + error.message);
    }
};

/**
 * Explain a set of Smart Suggestions (mould-alignment moves) in plain language.
 * `suggestions` is an array of { type:'cross'|'reorder', mould, fromCode, toCode, saved, reason }.
 * Returns a friendly string. Throws if the AI model is not initialized so the
 * caller can fall back to a deterministic summary.
 */
exports.explainSuggestions = async (suggestions = [], username = 'User') => {
    if (!model) throw new Error("AI Model not initialized");

    const totalSaved = suggestions.reduce((s, x) => s + (Number(x.saved) || 0), 0);
    const compact = suggestions.map((s, i) => ({
        n: i + 1,
        action: s.type === 'cross' ? 'move' : 'regroup',
        mould: s.mould || null,
        from: s.fromCode || null,
        to: s.toCode || null,
        saves: Number(s.saved) || 0,
        why: s.reason || ''
    }));

    const prompt = `
    You are JOY ⚡️, a friendly production-planning assistant for a plastic injection moulding factory.
    The user is "${username}". They opened the Smart Suggestions panel in the Excel-view planning timeline.

    These suggestions reduce unnecessary MOULD CHANGES by grouping the same mould together on a machine
    (a mould change costs setup time, so fewer changes = more productivity).

    SUGGESTIONS (JSON): ${JSON.stringify(compact)}
    TOTAL MOULD CHANGES SAVED IF ALL APPLIED: ${totalSaved}

    Write a short, encouraging explanation for the user:
    - Start with one line on the overall benefit (how many mould changes are saved).
    - Then a brief bullet for each suggestion: what to do and why, in simple plain English.
    - If there are no suggestions, congratulate them — the plan is already optimal.
    - Keep it concise. Use a few emojis (⚡️✨🔧). No markdown headings, plain text with simple "- " bullets is fine.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
};

exports.askQuestion = async (question, username = 'User', context = {}) => {
    if (!model) throw new Error("AI Model not initialized");

    const schemaContext = `
    TABLE machines (machine, machine_name, building, line, status, is_active, is_maintenance);
    TABLE orders (id, order_no, full_order_number, item_name, mould_code, plan_balance, qty, priority, status);
    TABLE users (username, role_code);
    `;

    const prompt = `
    You are JOY, a helpful logic assistant for JPSMS.
    The user is "${username}".
    CURRENT CONTEXT: User is viewing "${context.page || 'Dashboard'}" (URL: ${context.url || '/'}).
    
    1. If the user greets or asks a general question (e.g., "Hi", "Who are you?", "Thanks"), return type "text".
    2. If the user asks for DATA (e.g., "Show machines", "List orders"), return type "sql" with a READ-ONLY SQL query.
    3. If the user asks about the CURRENT PAGE, use the CONTEXT to explain what they can do here.

    SCHEMA:
    ${schemaContext}
    
    QUESTION: "${question}"
    
    OUTPUT FORMAT (Strict JSON):
    { "type": "sql" | "text", "content": "SQL Query OR Chat Response" }
    
    RULES:
    - No Markdown.
    - SQL must be valid PostgreSQL.
    - If "text", be friendly and brief. Use emojis ⚡️✨.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        // Clean markdown
        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean);
    } catch (error) {
        console.error("AI Chat Error:", error);
        // Fallback for non-JSON responses
        return { type: 'text', content: "I'm having trouble thinking right now. Please try again!" };
    }
};
