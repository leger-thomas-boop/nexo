export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system, userEmail, isFirstMessage } = req.body;
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

    // ── ÉTAPE 1 : Claude décide quel(s) modèle(s) utiliser, ET (si 1er message) ──
    // détecte si la question relève plutôt d'un expert Nexo spécialisé.
    const routerRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `Question de l'utilisateur: "${userText}"

Tâche 1 — Quel(s) modèle(s) IA seraient les mieux placés pour répondre à cette question ? Choisis parmi: "claude", "gpt", "claude+gpt", "gemini", "claude+gemini", "gpt+gemini", "all".
- claude: raisonnement complexe, code, analyse, écriture nuancée
- gpt: créativité, brainstorming, connaissances générales larges
- gemini: recherche d'infos récentes, multimodal, faits factuels

${isFirstMessage ? `Tâche 2 — Nexo possède des IA expertes spécialisées, chacune dédiée à un domaine. Détermine le DOMAINE PRINCIPAL de la question :
- sofia (Finance) : budget, épargne, dettes, investissements
- marcus (Droit du travail) : licenciement, arrêt maladie, contrat de travail, employeur, salaire, prud'hommes, heures de travail
- alex (Entreprise) : auto-entreprise, URSSAF, SASU, TVA, comptabilité, création d'entreprise
- max (Impression 3D) : STL, filament, réglages imprimante, modélisation 3D
- koda (Développement) : code, bugs, API, Vercel, Supabase, JavaScript, React
- nova (Images IA) : génération d'image, retouche photo, logo, visuels, style cartoon
- luna (Assistante générale) : rédaction, culture, explications simples, calculs

RÈGLE PRINCIPALE : si la question porte clairement sur UN de ces domaines, c'est action="redirect" vers l'expert correspondant — MÊME SI la question semble simple et que Genesis pourrait y répondre. La simplicité de la question n'est JAMAIS une raison de la garder : un expert dédié reste toujours la meilleure réponse sur son domaine.

action="answer" UNIQUEMENT si : la question est multi-domaines (mélange clairement 2+ domaines différents), ou l'utilisateur s'adresse explicitement à Genesis / demande explicitement de comparer ou combiner plusieurs IA, ou le sujet ne correspond à AUCUN domaine ci-dessus (discussion générale, actualité, etc. → dans ce cas action="redirect" vers luna).

action="redirect" si UN SEUL domaine est clairement concerné (confidence > 0.75).
action="ambiguous" si DEUX domaines sont plausibles à confiance proche (donne expertId et expertId2).
Si action="redirect", "reason" doit être UNE phrase complète en français du type : "Cette question relève plutôt de Marcus, expert droit du travail. Je vous redirige vers lui pour une réponse plus précise."
Si action="ambiguous", "reason" doit être une phrase du type : "Cette question peut être traitée par Sofia ou Alex. Lequel voulez-vous utiliser ?"` : `Tâche 2 — ignore (réponds action="answer").`}

Réponds UNIQUEMENT avec un JSON valide, rien d'autre, sans \`\`\`, au format exact :
{"models":"claude","route":{"action":"answer","expertId":null,"expertId2":null,"confidence":0,"reason":""}}`
        }]
      })
    });
    const routerData = await routerRes.json();
    let routing = 'claude';
    let route = { action: 'answer', expertId: null, expertId2: null, confidence: 0, reason: '' };
    try {
      const raw = (routerData.content?.[0]?.text || '').trim().replace(/^```json\s*|```$/g, '');
      const parsed = JSON.parse(raw);
      if (parsed.models) routing = String(parsed.models).toLowerCase();
      if (parsed.route) route = { ...route, ...parsed.route };
    } catch (e) { /* on garde les valeurs par défaut */ }
    if (!['claude','gpt','gemini','claude+gpt','claude+gemini','gpt+gemini','all'].includes(routing)) routing = 'claude';

    const NEXO_EXPERTS = ['sofia','marcus','alex','max','koda','nova','luna'];

    // ── Redirection vers un expert Nexo spécialisé (1er message uniquement) ──
    if (isFirstMessage && route.action === 'redirect' && route.confidence > 0.75 && NEXO_EXPERTS.includes(route.expertId)) {
      return res.status(200).json({ redirect: { expertId: route.expertId, reason: route.reason } });
    }
    if (isFirstMessage && route.action === 'ambiguous' && NEXO_EXPERTS.includes(route.expertId) && NEXO_EXPERTS.includes(route.expertId2)) {
      return res.status(200).json({ ambiguous: { expertId: route.expertId, expertId2: route.expertId2, reason: route.reason } });
    }


    let useClaude = routing.includes('claude') || routing === 'all';
    let useGPT = routing.includes('gpt') || routing === 'all';
    const useGemini = (routing.includes('gemini') || routing === 'all') && !!GEMINI_KEY;
    // Sécurité : si aucun modèle n'est finalement sélectionné (ex: "gemini" choisi
    // mais GEMINI_API_KEY absente sur Vercel), Claude répond par défaut.
    if (!useClaude && !useGPT && !useGemini) useClaude = true;

    // ── Cas le plus courant : un seul modèle (Claude) → vrai streaming (comme Claude) ──
    if (useClaude && !useGPT && !useGemini) {
      const streamRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: system,
          messages: messages,
          stream: true,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }]
        })
      });

      if (!streamRes.ok || !streamRes.body) {
        const errData = await streamRes.json().catch(() => ({}));
        return res.status(streamRes.status || 500).json(errData);
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const evt = JSON.parse(jsonStr);
            if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
              res.write(evt.delta.text);
            }
          } catch (e) { /* ligne SSE incomplète/ignorée */ }
        }
      }
      return res.end();
    }

    const calls = [];
    const labels = [];

    // ── Appel Claude (avec web search + vision natif) ──────────────────────
    if (useClaude) {
      const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
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
          body: JSON.stringify({ model: 'gpt-4o', max_tokens: 4096, messages: oaiMessages })
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
    let fusionPrompt = `Voici plusieurs réponses générées par différentes IA à la même question de l'utilisateur ("${userText}"). Fusionne-les en UNE seule réponse de synthèse, claire, COURTE et directe, en gardant le meilleur de chaque sans tout détailler, sans mentionner qu'il s'agit de plusieurs IA, sans dire "réponse 1" ou "réponse 2". Pas de titres ni de longues listes sauf si vraiment nécessaire. Réponds directement à l'utilisateur comme si c'était toi qui répondais.\n\n`;
    labels.forEach((l, i) => { fusionPrompt += `--- Source ${i+1} ---\n${validResults[i]}\n\n`; });

    const fusionRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
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
