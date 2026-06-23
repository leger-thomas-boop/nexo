export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
  const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    const { userEmail, userId } = req.body;
    if (!userEmail || !userId) return res.status(400).json({ error: 'userEmail et userId requis' });

    // Récupère les 60 derniers messages utilisateur (tous experts confondus)
    const msgsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/messages?user_id=eq.${userId}&order=created_at.desc&limit=60&select=expert,role,content,created_at`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const msgs = await msgsRes.json();
    if (!Array.isArray(msgs) || msgs.length < 4) {
      return res.status(200).json({ skipped: true, reason: 'Pas assez de messages pour générer un résumé.' });
    }

    // Construit un transcript condensé pour l'IA (du plus ancien au plus récent)
    const transcript = msgs.reverse().map(m => {
      const text = typeof m.content === 'string' ? m.content : '[contenu multimédia]';
      return `[${m.expert}] ${m.role === 'user' ? 'Utilisateur' : 'IA'}: ${text.slice(0, 200)}`;
    }).join('\n');

    const prompt = `Voici un historique de conversations entre un utilisateur et différentes IA spécialisées de l'app Nexo.

${transcript}

Génère un résumé très concis (max 100 mots) des informations importantes à retenir sur cet utilisateur pour personnaliser les futures conversations : ses centres d'intérêt récurrents, son contexte (travail, projets en cours), ses préférences, et les sujets qu'il aborde souvent. Reste factuel, pas de psychologisation. Si rien de notable ne ressort, réponds juste "Aucune information particulière à retenir."

Réponds uniquement avec le résumé, sans préambule.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const aiData = await aiRes.json();
    const summary = aiData.content?.[0]?.text?.trim() || null;

    if (summary) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(userEmail)}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ memory_summary: summary, memory_updated_at: new Date().toISOString() })
      });
    }

    return res.status(200).json({ summary });
  } catch (error) {
    console.error('[Memory] crash:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
