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
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const OPENAI_KEY    = process.env.OPENAI_API_KEY;
    const GEMINI_KEY    = process.env.GEMINI_API_KEY;

    // ── Premium check ─────────────────────────────────────────────────────
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(userEmail)}&select=is_premium`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const profiles = await profileRes.json();
    // Si le profil n'existe pas encore (nouveau compte), on le crée avec is_premium=false
    if (!profiles[0]) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ email: userEmail.toLowerCase(), is_premium: false })
      });
    }
    const isPremium = profiles[0]?.is_premium === true;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : (lastUserMsg?.content?.find(c => c.type === 'text')?.text || '');

    const NEXO_EXPERTS = ['sofia','marcus','alex','max','koda','nova'];

    // ── Detect short follow-ups ───────────────────────────────────────────
    const followUpWords = /^(oui|non|ok|okay|continue|suite|explique|développe|encore|merci|parfait|super|bien|dis-moi|et alors|pourquoi|comment|vas-y|go|yes|no|more|next|et|aussi|quoi|hein|ah|exact|voilà|d'accord|bien sûr|et donc|et ensuite|c'est tout|génial|cool|intéressant|bonne idée)$/i;
    const isFollowUp = !isFirstMessage && userText.trim().split(/\s+/).length <= 5 && followUpWords.test(userText.trim().replace(/[?!.,]/g, ''));

    // Pour le routing, on évalue uniquement la question actuelle (pas l'historique)
    // afin que l'historique chargé depuis Supabase n'interfère pas avec la décision de routage.
    const routingMessages = isFirstMessage
      ? [{ role: 'user', content: userText }]
      : messages;
    const orchestPrompt = `Tu es l'orchestrateur de Genesis, un système IA premium qui choisit automatiquement le meilleur moteur.

Question : "${userText}"
${isFollowUp ? '\nCONTEXTE : Message court de suivi. Préfère conserver un seul modèle rapide plutôt que la fusion.' : ''}

${isFirstMessage ? `
== ROUTING EXPERT NEXO ==
Redirige vers un expert Nexo uniquement si la question relève clairement d'un seul domaine :
- sofia : budget, épargne, dettes, investissements personnels
- marcus : droit du travail, licenciement, contrat, employeur, salaire, prud'hommes
- alex : auto-entreprise, URSSAF, SASU, TVA, comptabilité, création d'entreprise
- max : impression 3D, filament, réglages imprimante, modélisation
- koda : code, bugs, API, Vercel, Supabase, JavaScript, React
- nova : génération d'image, retouche photo, logo, cartoon
→ route="redirect" si domaine clair (confidence > 0.75)
→ route="ambiguous" si deux domaines plausibles
→ route="answer" sinon
` : ''}

== SCORING 3 MODÈLES (0-100 chacun) ==
${isFirstMessage ? 'Si route=redirect/ambiguous → tous à 0, model="none". Sinon :' : ''}

🧠 CLAUDE — score élevé si :
Analyse juridique, contrats, raisonnement profond, code complexe, débogage difficile, questions sensibles, analyse de documents, philosophie, éthique, psychologie, sujets nécessitant précision et rigueur absolue.

💡 GPT — score élevé si :
Conseils pratiques du quotidien, brainstorming, marketing, créativité, réseaux sociaux, rédaction, copywriting, explications simples, conversation naturelle, humour, idées, recommandations produits/services, lifestyle.

🌐 GEMINI — score élevé si :${geminiAvailable ? `
Recherche internet, actualités récentes, prix du marché, comparatifs récents, données temps réel, événements sportifs, météo, sorties récentes (films/jeux/produits), toute information nécessitant des sources actualisées.` : `
(Non disponible — score 0)` }

== RÈGLE DE SÉLECTION ==
- Si un modèle domine (score >= 25pts de plus que les autres) → ce modèle seul (rapide)
- Si 2 modèles sont proches (écart < 25pts) → fusion des 2 meilleurs
- Si question nécessite vraiment les 3 angles → fusion triple
- Follow-up court → modèle le mieux placé seul (pas de fusion)
- Par défaut si question générale/pratique → GPT

Pour les fusions, indique quels modèles dans "models" : ["claude","gpt"], ["claude","gemini"], ["gpt","gemini"], ou ["claude","gpt","gemini"]

== REASONING STEPS ==
Génère 2-3 étapes courtes (5-8 mots max) décrivant ce que Genesis détecte.
Ex claude: ["Raisonnement juridique détecté", "Précision requise", "Claude sélectionné — 94%"]
Ex gpt: ["Question pratique du quotidien", "Conseil concret requis", "GPT sélectionné — 88%"]
Ex gemini: ["Recherche temps réel nécessaire", "Données récentes requises", "Gemini sélectionné — 92%"]
Ex fusion: ["Sujet complexe multi-angles", "Recherche + analyse requises", "Fusion Claude + Gemini"]

Si route="answer" mais qu'un expert Nexo aurait pu apporter une vraie valeur ajoutée (ex: question juridique, finance, code, image), remplis "suggested_expert" avec son nom (sofia/marcus/alex/max/koda/nova). Sinon null.

Réponds UNIQUEMENT avec ce JSON valide, sans backticks :
{
  "route": "answer",
  "expertId": null,
  "expertId2": null,
  "confidence": 0,
  "reason": "",
  "claude_score": 40,
  "gpt_score": 80,
  "gemini_score": 30,
  "model": "gpt",
  "models": ["gpt"],
  "reasoning_steps": ["Étape 1", "Étape 2", "GPT sélectionné — 88%"],
  "suggested_expert": null
}`;

    const orchestRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 350, messages: [{ role: 'user', content: orchestPrompt }] })    });
    const orchestData = await orchestRes.json();
    let dec = {
      route: 'answer', expertId: null, expertId2: null, confidence: 0, reason: '',
      claude_score: 40, gpt_score: 80, gemini_score: 0,
      model: 'gpt', models: ['gpt'], reasoning_steps: [], suggested_expert: null
    };
    try {
      const raw = (orchestData.content?.[0]?.text || '').trim().replace(/^```json\s*|```\s*$/g, '');
      dec = { ...dec, ...JSON.parse(raw) };
    } catch (e) {}

    // Enforce: disable Gemini if key absent
    if (!geminiAvailable) dec.gemini_score = 0;

    // Enforce scoring logic server-side (overrides haiku decision)
    if (dec.model !== 'none') {
      const scores = { claude: dec.claude_score, gpt: dec.gpt_score, gemini: geminiAvailable ? dec.gemini_score : 0 };
      const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
      const [best, second] = sorted;

      if (isFollowUp) {
        // Follow-up: always single best model
        dec.models = [best[0]];
      } else if (best[1] - second[1] >= 25) {
        // Clear winner
        dec.models = [best[0]];
      } else if (best[1] - sorted[2][1] < 15 && !isFollowUp) {
        // All three close → triple fusion only if all above 50
        const allAbove50 = sorted.every(([,s]) => s >= 50);
        dec.models = allAbove50 ? ['claude','gpt','gemini'].filter(m => m !== 'gemini' || geminiAvailable) : [best[0], second[0]];
      } else {
        // Two best
        dec.models = [best[0], second[0]];
      }
    }

    // ── Routing expert Nexo ───────────────────────────────────────────────
    if (isFirstMessage && dec.route === 'redirect' && dec.confidence > 0.75 && NEXO_EXPERTS.includes(dec.expertId)) {
      return res.status(200).json({ redirect: { expertId: dec.expertId, reason: dec.reason } });
    }
    if (isFirstMessage && dec.route === 'ambiguous' && NEXO_EXPERTS.includes(dec.expertId) && NEXO_EXPERTS.includes(dec.expertId2)) {
      return res.status(200).json({ ambiguous: { expertId: dec.expertId, expertId2: dec.expertId2, reason: dec.reason } });
    }

    const selectedModels = dec.model === 'none' ? ['gpt'] : (dec.models?.length ? dec.models : ['gpt']);
    const reasoningSteps = Array.isArray(dec.reasoning_steps) ? dec.reasoning_steps : [];
    console.log(`[Genesis] models=${selectedModels.join('+')} | c=${dec.claude_score} g=${dec.gpt_score} gem=${dec.gemini_score} | followUp=${isFollowUp} | "${userText.slice(0,50)}"`);

    // ── Callers ───────────────────────────────────────────────────────────
    async function callClaude() {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929', max_tokens: 1500, system, messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }]
        })
      });
      const d = await r.json();
      return (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')||null;
    }

    async function callGPT() {
      if (!OPENAI_KEY) return null;
      const oaiMsgs = [{ role: 'system', content: system }];
      for (const m of messages) {
        if (typeof m.content === 'string') { oaiMsgs.push({ role: m.role, content: m.content }); }
        else {
          const parts = m.content.map(c => {
            if (c.type==='text') return { type:'text', text:c.text };
            if (c.type==='image') return { type:'image_url', image_url:{ url:`data:${c.source.media_type};base64,${c.source.data}` } };
            return null;
          }).filter(Boolean);
          oaiMsgs.push({ role: m.role, content: parts });
        }
      }
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1500, messages: oaiMsgs })
      });
      const d = await r.json();
      return d.choices?.[0]?.message?.content||null;
    }

    async function callGemini() {
      if (!GEMINI_KEY) return null;
      const geminiMsgs = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: typeof m.content === 'string'
          ? [{ text: m.content }]
          : m.content.map(c => c.type === 'text' ? { text: c.text } : null).filter(Boolean)
      }));
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: geminiMsgs,
          tools: [{ google_search: {} }]
        })
      });
      const d = await r.json();
      return d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n')||null;
    }

    // ── Execute ───────────────────────────────────────────────────────────
    if (selectedModels.length === 1) {
      const m = selectedModels[0];
      let text = null;
      if (m === 'claude') text = await callClaude();
      else if (m === 'gpt') text = await callGPT();
      else if (m === 'gemini') text = await callGemini();
      // Fallback chain
      if (!text) text = await callGPT() || await callClaude();
      if (!text) return res.status(500).json({ error: 'Aucune réponse disponible' });
      return res.status(200).json({ text, models: selectedModels, claude_score: dec.claude_score, gpt_score: dec.gpt_score, gemini_score: dec.gemini_score, reasoning_steps: reasoningSteps, suggested_expert: dec.suggested_expert||null });
    }

    // ── Fusion (2 or 3 models) ────────────────────────────────────────────
    const calls = {};
    if (selectedModels.includes('claude'))  calls.claude  = callClaude();
    if (selectedModels.includes('gpt'))     calls.gpt     = callGPT();
    if (selectedModels.includes('gemini'))  calls.gemini  = callGemini();

    const results = {};
    await Promise.all(Object.entries(calls).map(async ([name, promise]) => {
      try { results[name] = await promise; } catch(e) { results[name] = null; }
    }));

    const available = Object.entries(results).filter(([,t])=>t).map(([n])=>n);
    if (!available.length) return res.status(500).json({ error: 'Aucune réponse des modèles IA' });
    if (available.length === 1) {
      return res.status(200).json({ text: results[available[0]], models: [available[0]], claude_score: dec.claude_score, gpt_score: dec.gpt_score, gemini_score: dec.gemini_score, reasoning_steps: reasoningSteps, suggested_expert: dec.suggested_expert||null });
    }

    // Build fusion prompt
    const sections = available.map(n => {
      const label = n==='claude'?'Claude':n==='gpt'?'ChatGPT':'Gemini';
      return `--- ${label} ---\n${results[n]}`;
    }).join('\n\n');

    const fusionPrompt = `Question : "${userText}"\n\n${sections}\n\nFusionne ces réponses en une seule : garde le meilleur de chaque, sois concis et direct. Ne mentionne jamais les noms des IA. Réponds directement à l'utilisateur.`;

    // Synthesizer = model with highest score among available
    const synthScores = { claude: dec.claude_score, gpt: dec.gpt_score, gemini: dec.gemini_score };
    const bestSynth = available.sort((a,b) => synthScores[b]-synthScores[a])[0];
    console.log(`[Genesis] fusion synth=${bestSynth} available=${available.join('+')}`);

    let fusedText = null;
    if (bestSynth === 'gpt' && OPENAI_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 800, messages: [
          { role: 'system', content: 'Synthétise plusieurs réponses IA en une seule, concise et naturelle, sans mentionner les IA.' },
          { role: 'user', content: fusionPrompt }
        ]})
      });
      const d = await r.json();
      fusedText = d.choices?.[0]?.message?.content||null;
    } else if (bestSynth === 'gemini' && GEMINI_KEY) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role:'user', parts:[{ text: fusionPrompt }] }] })
      });
      const d = await r.json();
      fusedText = d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n')||null;
    }
    if (!fusedText) {
      // Claude fallback for synthesis
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role:'user', content: fusionPrompt }] })
      });
      const d = await r.json();
      fusedText = d.content?.[0]?.text || results[available[0]];
    }

    return res.status(200).json({ text: fusedText, models: available, claude_score: dec.claude_score, gpt_score: dec.gpt_score, gemini_score: dec.gemini_score, reasoning_steps: reasoningSteps, suggested_expert: dec.suggested_expert||null });

  } catch (error) {
    console.error('[Genesis] crash:', error.message, error.stack);
    return res.status(500).json({ error: error.message });
  }
}
