// ============================================================
// TOKENCLASH — api/turn.js : The Player Brain
// State in (player view), validated move out.
// Keys stay server-side. Provider routing by prefix, same
// doctrine as The Conclave. No hardcoded models.
// ============================================================

export const maxDuration = 60;

const SYSTEM_PROMPT = (name, view, tableChat) => `You are "${name}", an AI playing UNO against other AIs, watched by a live audience.

GAME STATE:
- Your hand: ${JSON.stringify(view.yourHand.map(c => `${c.color} ${c.value} (id: ${c.id})`))}
- Top of discard: ${view.topDiscard}
- Active color: ${view.activeColor}
- Opponents: ${view.opponents.map(o => `${o.name}: ${o.cards} cards`).join(', ')}
- Turn direction: ${view.direction}
 ${view.drawnCardId ? `- You just drew a playable card. You may play ONLY that card (id: ${view.drawnCardId}) or pass.` : ''}

TABLE CHAT (recent):
 ${tableChat.length ? tableChat.map(t => `- ${t}`).join('\n') : '- (silent so far)'}

STRATEGY HINTS: Track opponents' card counts. If someone has 1 card, burn your Skip/+2/+4 on THEM. Match the active color to keep flexibility. Wilds let you choose color — pick your most common one.

RESPOND WITH ONLY THIS JSON — nothing else, no markdown:
{"card": "<exact card id from your hand>"} to play, OR {"draw": true} to draw, OR {"pass": true} if you just drew a playable card and choose not to play it.
Optional: add "taunt": "<one short sentence for the table>" — you're being watched, make it entertaining.`;

function extractJSON(text) {
    if (!text) return null;
    const cleaned = text.replace(/```(?:json)?/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)); }
    catch { return null; }
}

async function callProvider(modelId, messages) {
    const [provider, ...rest] = modelId.split(':');
    const actualModelId = rest.join(':');
    let url, headers, body;

    switch (provider) {
        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModelId}:generateContent?key=${process.env.GEMINI_API_KEY}`;
            headers = { "Content-Type": "application/json" };
            body = { contents: messages, generationConfig: { maxOutputTokens: 300, temperature: 0.8 } };
            break;
        case 'openrouter':
            url = "https://openrouter.ai/api/v1/chat/completions";
            headers = { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://vercel.app", "X-Title": "TokenClash" };
            body = { model: actualModelId, messages: messages, max_tokens: 300 };
            break;
        case 'sambanova':
            url = "https://api.sambanova.ai/v1/chat/completions";
            headers = { "Authorization": `Bearer ${process.env.SAMBANOVA_API_KEY}`, "Content-Type": "application/json" };
            body = { model: actualModelId, messages: messages, max_tokens: 300 };
            break;
        case 'github':
            url = "https://models.inference.ai.azure.com/chat/completions?api-version=2024-05-01-preview";
            headers = { "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json" };
            body = { model: actualModelId, messages: messages, max_tokens: 300 };
            break;
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    if (provider === 'gemini') {
        if (!data.candidates?.[0]?.content) throw new Error("Empty response");
        return data.candidates[0].content.parts[0].text;
    }
    if (!data.choices?.[0]?.message?.content) throw new Error("Empty response");
    return data.choices[0].message.content;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { model, playerName, view, tableChat } = req.body;
    if (!model || !view) return res.status(400).json({ error: "Missing model or view" });

    try {
        const messages = [
            { role: "user", parts: [{ text: SYSTEM_PROMPT(playerName, view, tableChat || []) }] },
            ...view.yourHand ? [] : []
        ];

        // Gemini native format; OpenAI-style gets converted inside callProvider via body shape
        let text;
        if (model.startsWith('gemini:')) {
            text = await callProvider(model, messages);
        } else {
            const [provider, ...rest] = model.split(':');
            const actualModelId = rest.join(':');
            const sys = SYSTEM_PROMPT(playerName, view, tableChat || []);
            text = await callProvider(model, [
                { role: "system", content: sys },
                { role: "user", content: "Your move. Respond with the JSON only." }
            ]);
        }

        const parsed = extractJSON(text);

        if (!parsed || (!parsed.card && !parsed.draw && !parsed.pass)) {
            // Garbage output = illegal move. The ENGINE will punish it.
            return res.status(200).json({ status: 'invalid', taunt: null, detail: 'Model output was not valid JSON.' });
        }

        // Sanity: card must reference something; engine does the real validation
        const move = {};
        if (parsed.card) move.card = String(parsed.card);
        if (parsed.draw) move.draw = true;
        if (parsed.pass) move.pass = true;
        if (parsed.chosenColor) move.chosenColor = String(parsed.chosenColor);

        return res.status(200).json({
            status: 'move',
            move,
            taunt: typeof parsed.taunt === 'string' ? parsed.taunt.slice(0, 140) : null
        });

    } catch (e) {
        let msg = e.message;
        if (e.name === 'AbortError') msg = "Model timed out (20s).";
        return res.status(200).json({ status: 'error', error: msg });
    }
}