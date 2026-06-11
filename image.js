export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // DEBUG - à supprimer après
  return res.status(200).json({
    service_key_length: process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.length : 0,
    service_key_start: process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.substring(0, 20) : 'VIDE',
    replicate_length: process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.length : 0
  });
}
