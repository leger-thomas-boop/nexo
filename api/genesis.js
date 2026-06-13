export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system, userEmail } = req.body;
    if (!userEmail) return res.status(401).json({ error: 'Non autorisé' });

    const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    // Vérifie Premium
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(userEmail)}&select=is_premium`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const profiles = await profileRes.json();
    if (!profiles[0]) return res.status(404).json({ error: 'Profil introuvable' });
    if (!profiles[0].is_premium) return res.status(403).json({ error: 'Réservé aux membres Premium' });

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : (lastUserMsg.content.find(c => c.type === 'text')?.text || '');

    // ── ÉTAPE 1 : Claude décide quel(s) modèle(s) utiliser ──────────────────
    const routerRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `Question de l'utilisateur: "${userText}"

Quel(s) modèle(s) IA seraient les mieux placés pour répondre ? Réponds UNIQUEMENT avec une combinaison parmi: "claude", "gpt", "claude+gpt", "gemini", "claude+gemini", "gpt+gemini", "all".
- claude: raisonnement complexe, code, analyse, écriture nuancée
- gpt: créativité, brainstorming, connaissances générales larges
- gemini: recherche d'infos récentes, multimodal, faits factuels
Réponds avec UN SEUL de ces mots, rien d'autre.`
        }]
      })
    });
    const routerData = await routerRes.json();
    let routing = (routerData.content?.[0]?.text || 'claude').trim().toLowerCase();
    if (!['claude','gpt','gemini','claude+gpt','claude+gemini','gpt+gemini','all'].includes(routing)) routing = 'claude';

    const useClaude = routing.includes('claude') || routing === 'all';
    const useGPT = routing.includes('gpt') || routing === 'all';
    const useGemini = (routing.includes('gemini') || routing === 'all') && !!GEMINI_KEY;

    const calls = [];
    const labels = [];

    // ── Appel Claude (avec web search + vision natif) ──────────────────────
    if (useClaude) {
      const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        system: system,
        messages: messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }]
      };
      calls.push(
        fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body)
        }).then(r => r.json()).then(d => {
          const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
          return text;
        }).catch(() => null)
      );
      labels.push('claude');
    }

    // ── Appel GPT ────────────────────────────────────────────────────────
    if (useGPT) {
      // Convertit les messages format Anthropic -> OpenAI
      const oaiMessages = [{ role: 'system', content: system }];
      for (const m of messages) {
        if (typeof m.content === 'string') {
          oaiMessages.push({ role: m.role, content: m.content });
        } else {
          const parts = m.content.map(c => {
            if (c.type === 'text') return { type: 'text', text: c.text };
            if (c.type === 'image') return { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } };
            return null;
          }).filter(Boolean);
          oaiMessages.push({ role: m.role, content: parts });
        }
      }
      calls.push(
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1500, messages: oaiMessages })
        }).then(r => r.json()).then(d => d.choices?.[0]?.message?.content || null).catch(() => null)
      );
      labels.push('gpt');
    }

    // ── Appel Gemini ─────────────────────────────────────────────────────
    if (useGemini) {
      const geminiParts = [{ text: system + '\n\n' + userText }];
      calls.push(
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: geminiParts }] })
        }).then(r => r.json()).then(d => d.candidates?.[0]?.content?.parts?.[0]?.text || null).catch(() => null)
      );
      labels.push('gemini');
    }

    const results = await Promise.all(calls);
    const validResults = results.filter(r => r);

    if (validResults.length === 0) {
      return res.status(500).json({ error: 'Aucune réponse obtenue des modèles IA' });
    }

    // ── Si une seule source → on renvoie directement ────────────────────────
    if (validResults.length === 1) {
      return res.status(200).json({ text: validResults[0], models: labels });
    }

    // ── Plusieurs sources → Claude fusionne en une réponse unique ──────────
    let fusionPrompt = `Voici plusieurs réponses générées par différentes IA à la même question de l'utilisateur ("${userText}"). Fusionne-les en UNE seule réponse de synthèse, claire et cohérente, en gardant le meilleur de chaque, sans mentionner qu'il s'agit de plusieurs IA, sans dire "réponse 1" ou "réponse 2". Réponds directement à l'utilisateur comme si c'était toi qui répondais.\n\n`;
    labels.forEach((l, i) => { fusionPrompt += `--- Source ${i+1} ---\n${validResults[i]}\n\n`; });

    const fusionRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1800,
        system: system,
        messages: [{ role: 'user', content: fusionPrompt }]
      })
    });
    const fusionData = await fusionRes.json();
    const fusedText = fusionData.content?.[0]?.text || validResults[0];

    return res.status(200).json({ text: fusedText, models: labels });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
