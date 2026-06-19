export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zoycmayrynkisgiybqij.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    const body = req.body;
    const action = body.action;
    const prompt = body.prompt;

    // ── ACTION: stats ──
    if (action === 'stats') {
      const [msgsRes, profRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/messages?select=expert,role,user_id,content,created_at&limit=1000&order=created_at.desc`,
          { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }),
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,email,is_premium,created_at`,
          { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } })
      ]);
      return res.status(200).json({
        messages: await msgsRes.json(),
        profiles: await profRes.json()
      });
    }

    // ── Rapport IA ──
    if (prompt) {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const aiData = await aiRes.json();
      const text = aiData.content?.[0]?.text || 'Impossible de générer le rapport.';
      return res.status(200).json({ text });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch (error) {
    console.error('[Admin] crash:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
