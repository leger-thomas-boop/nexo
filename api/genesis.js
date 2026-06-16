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
    const OPENAI_KEY = process.env.OPENAI_API_KEY;

    // ── Vérification Premium ──────────────────────────────────────────────
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(userEmail)}&select=is_premium`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const profiles = await profileRes.json();
    if (!profiles[0]) return res.status(404).json({ error: 'Profil introuvable' });
    if (!profiles[0].is_premium) return res.status(403).json({ error: 'Réservé aux membres Premium' });

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : (lastUserMsg?.content?.find(c => c.type === 'text')?.text || '');

    const NEXO_EXPERTS = ['sofia','marcus','alex','max','koda','nova'];

    // ── ÉTAPE 1 : Haiku orchestre (scoring + routing) ─────────────────────
    // Score each IA 0-100 based on how well suited it is for THIS specific question.
    // Also handles expert routing if first message.
    const orchestratorPrompt = `Tu es l'orchestrateur de Genesis, une IA premium qui choisit la meilleure IA pour chaque question.

Question : "${userText}"

${isFirstMessage ? `
== ROUTING EXPERT NEXO ==
Si la question relève clairement d'UN domaine spécialisé Nexo, redirige :
- sofia : budget, épargne, dettes, investissements
- marcus : licenciement, arrêt maladie, contrat, employeur, salaire, prud'hommes, durée du travail
- alex : auto-entreprise, URSSAF, SASU, TVA, comptabilité, création d'entreprise
- max : impression 3D, filament, réglages imprimante, modélisation
- koda : code, bugs, API, Vercel, Supabase, JavaScript, React
- nova : génération d'image, retouche photo, logo, cartoon

Règle : un expert dédié est TOUJOURS meilleur que Genesis sur son domaine propre.
→ route="redirect" si domaine clair (confidence > 0.75)
→ route="ambiguous" si deux domaines plausibles
→ route="answer" si multi-domaines, demande explicite à Genesis, ou aucun domaine ne correspond
` : ''}

== SCORING DES MODÈLES IA ==
${isFirstMessage ? 'Si route="redirect" ou "ambiguous", score tous à 0 et model="none".\nSinon :' : ''}

Évalue chaque IA sur cette question précise avec un score de 0 à 100 :
- claude_score : Force sur précision, raisonnement profond, nuance, analyse, droit, psychologie, code, questions sensibles, sujets complexes nécessitant de la rigueur
- gpt_score : Force sur créativité, brainstorming, idées originales, écriture créative, storytelling, marketing, humour, listes d'idées variées, culture pop

Règles de décision automatique :
- Si claude_score ≥ gpt_score+15 → model="claude"
- Si gpt_score ≥ claude_score+15 → model="gpt"
- Si les deux sont proches (écart < 15) → model="fusion" (les deux s'unissent)

Génère aussi 2-3 "reasoning_steps" courtes (5-8 mots max chacune) qui décrivent ce que Genesis détecte dans la question, pour afficher en live à l'utilisateur pendant l'analyse. Ex: ["Analyse juridique détectée", "Précision requise", "Claude sélectionné — 94%"]

Réponds UNIQUEMENT avec ce JSON valide, sans backticks :
{
  "route": "answer",
  "expertId": null,
  "expertId2": null,
  "confidence": 0,
  "reason": "",
  "claude_score": 80,
  "gpt_score": 40,
  "model": "claude",
  "reasoning_steps": ["Étape 1", "Étape 2", "Modèle sélectionné"]
}`;

    const orchestRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: orchestratorPrompt }] })
    });
    const orchestData = await orchestRes.json();
    let decision = { route: 'answer', expertId: null, expertId2: null, confidence: 0, reason: '', claude_score: 80, gpt_score: 40, model: 'claude', reasoning_steps: [] };
    try {
      const raw = (orchestData.content?.[0]?.text || '').trim().replace(/^```json\s*|```\s*$/g, '');
      decision = { ...decision, ...JSON.parse(raw) };
    } catch (e) {}

    // Enforce scoring rule
    if (decision.model !== 'none') {
      const diff = decision.claude_score - decision.gpt_score;
      if (diff >= 15) decision.model = 'claude';
      else if (diff <= -15) decision.model = 'gpt';
      else decision.model = 'fusion';
    }

    // ── Redirection expert Nexo ───────────────────────────────────────────
    if (isFirstMessage && decision.route === 'redirect' && decision.confidence > 0.75 && NEXO_EXPERTS.includes(decision.expertId)) {
      return res.status(200).json({ redirect: { expertId: decision.expertId, reason: decision.reason } });
    }
    if (isFirstMessage && decision.route === 'ambiguous' && NEXO_EXPERTS.includes(decision.expertId) && NEXO_EXPERTS.includes(decision.expertId2)) {
      return res.status(200).json({ ambiguous: { expertId: decision.expertId, expertId2: decision.expertId2, reason: decision.reason } });
    }

    const model = ['claude','gpt','fusion'].includes(decision.model) ? decision.model : 'claude';
    const reasoningSteps = Array.isArray(decision.reasoning_steps) ? decision.reasoning_steps : [];

    // ── Appel Claude ──────────────────────────────────────────────────────
    async function callClaude() {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1500,
          system: system,
          messages: messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }]
        })
      });
      const d = await r.json();
      return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') || null;
    }

    // ── Appel GPT ─────────────────────────────────────────────────────────
    async function callGPT() {
      if (!OPENAI_KEY) return null;
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
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1500, messages: oaiMessages })
      });
      const d = await r.json();
      return d.choices?.[0]?.message?.content || null;
    }

    // ── Exécution selon la décision ───────────────────────────────────────
    if (model === 'claude') {
      const text = await callClaude();
      if (!text) return res.status(500).json({ error: 'Aucune réponse de Claude' });
      return res.status(200).json({ text, models: ['claude'], claude_score: decision.claude_score, gpt_score: decision.gpt_score, reasoning_steps: reasoningSteps });
    }

    if (model === 'gpt') {
      const text = await callGPT();
      if (!text) {
        const fallback = await callClaude();
        return res.status(200).json({ text: fallback || 'Erreur', models: ['claude'], claude_score: decision.claude_score, gpt_score: decision.gpt_score, reasoning_steps: reasoningSteps });
      }
      return res.status(200).json({ text, models: ['gpt'], claude_score: decision.claude_score, gpt_score: decision.gpt_score, reasoning_steps: reasoningSteps });
    }

    // model === 'fusion'
    const [claudeText, gptText] = await Promise.all([callClaude(), callGPT()]);
    if (!claudeText && !gptText) return res.status(500).json({ error: 'Aucune réponse des modèles IA' });
    if (!gptText) return res.status(200).json({ text: claudeText, models: ['claude'], reasoning_steps: reasoningSteps });
    if (!claudeText) return res.status(200).json({ text: gptText, models: ['gpt'], reasoning_steps: reasoningSteps });

    const fusionPrompt = `Question : "${userText}"

Réponse Claude :
${claudeText}

Réponse ChatGPT :
${gptText}

Fusionne en une seule réponse : garde le meilleur des deux, sois concis et direct. Ne mentionne jamais les noms des IA. Réponds directement.`;

    const fusionRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: fusionPrompt }] })
    });
    const fusionData = await fusionRes.json();
    const fusedText = fusionData.content?.[0]?.text || claudeText;

    return res.status(200).json({ text: fusedText, models: ['claude', 'gpt'], claude_score: decision.claude_score, gpt_score: decision.gpt_score, reasoning_steps: reasoningSteps });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
