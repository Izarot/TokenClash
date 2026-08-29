// TOKENCLASH — dynamic model discovery (no hardcoded players)
export const maxDuration = 60;

export default async function handler(req, res) {
    let models = [];

    const [orRes, gemRes, snRes] = await Promise.allSettled([
        fetch("https://openrouter.ai/api/v1/models").then(r => r.json()),
        process.env.GEMINI_API_KEY
            ? fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`).then(r => r.json())
            : Promise.reject(new Error('no key')),
        process.env.SAMBANOVA_API_KEY
            ? fetch("https://api.sambanova.ai/v1/models", { headers: { "Authorization": `Bearer ${process.env.SAMBANOVA_API_KEY}` } }).then(r => r.json())
            : Promise.reject(new Error('no key'))
    ]);

    if (orRes.status === 'fulfilled' && orRes.value.data) {
        models.push(...orRes.value.data
            .filter(m => m.id && m.pricing && m.pricing.prompt === "0")
            .map(m => ({ id: `openrouter:${m.id}`, name: `[OpenRouter] ${m.name.split('(')[0].trim()}` })));
    }
    if (gemRes.status === 'fulfilled' && gemRes.value.models) {
        models.push(...gemRes.value.models
            .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
            .map(m => ({ id: `gemini:${m.name.replace('models/', '')}`, name: `[Google] ${m.displayName || m.name}` })));
    }
    if (snRes.status === 'fulfilled' && snRes.value.data) {
        models.push(...snRes.value.data
            .filter(m => m.id && !m.id.toLowerCase().includes('minimax'))
            .map(m => ({ id: `sambanova:${m.id}`, name: `[SambaNova] ${m.id}` })));
    }

    res.status(200).json(models);
}