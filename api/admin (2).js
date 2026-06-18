export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const { action } = req.body;

    if (action === 'stats') {
      // Fetch messages
      const msgsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?select=expert,role,user_id,created_at&limit=1000&order=created_at.desc`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const messages = await msgsRes.json();

      // Fetch profiles
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?select=email,is_premium,created_at`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const profiles = await profRes.json();

      return res.status(200).json({
        messages: Array.isArray(messages) ? messages : [],
        profiles: Array.isArray(profiles) ? profiles : []
      });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
