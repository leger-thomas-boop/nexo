import webpush from 'web-push';

export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BECE3eNzFNB1bx8_aYPnCy4ucSfuq9adCIcQ0msHOGBvFddBYHdiXqtb2Acn-xLsOrJqyHWsfEOzgOTINyc8zTc';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'x0-I-xurXGYvNpeZbHYBpeMqjHseHdHgMFHtSK1ADns';

webpush.setVapidDetails('mailto:contact@nexo-app.fr', VAPID_PUBLIC, VAPID_PRIVATE);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  // ── Inscription d'un abonnement push (appelé par le client) ────────────
  if (action === 'subscribe') {
    const { subscription, userEmail } = req.body;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Subscription invalide' });
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE,
          Authorization: `Bearer ${SUPABASE_SERVICE}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          subscription: subscription,
          user_email: userEmail || null,
          created_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Désabonnement ────────────────────────────────────────────────────
  if (action === 'unsubscribe') {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` }
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Envoi d'une notification à tous les abonnés (protégé côté UI admin) ──
  if (action === 'send') {
    const { title, body, url, targetEmail } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Titre et message requis' });

    try {
      let query = `${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,subscription`;
      if (targetEmail) query += `&user_email=eq.${encodeURIComponent(targetEmail)}`;

      const subsRes = await fetch(query, {
        headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` }
      });
      const subs = await subsRes.json();

      if (!Array.isArray(subs) || subs.length === 0) {
        return res.status(200).json({ sent: 0, failed: 0, message: 'Aucun abonné trouvé.' });
      }

      const payload = JSON.stringify({ title, body, url: url || '/' });
      let sent = 0, failed = 0;
      const deadEndpoints = [];

      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification(s.subscription, payload);
          sent++;
        } catch (err) {
          failed++;
          if (err.statusCode === 404 || err.statusCode === 410) deadEndpoints.push(s.endpoint);
        }
      }));

      if (deadEndpoints.length > 0) {
        await Promise.all(deadEndpoints.map(ep =>
          fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, {
            method: 'DELETE',
            headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` }
          }).catch(() => {})
        ));
      }

      return res.status(200).json({ sent, failed, total: subs.length });
    } catch (e) {
      console.error('[Push] send error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Action inconnue' });
}
