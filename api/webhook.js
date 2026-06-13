export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
  const SUPABASE_SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';

  const event = req.body;

  try {
    let email = null;
    let setPremium = null;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // Priorité : client_reference_id (= email du compte Nexo connecté)
      // Fallback : email du moyen de paiement (peut différer avec Apple/Google Pay)
      email = session.client_reference_id || session.customer_email || session.customer_details?.email || null;
      setPremium = true;
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      email = sub.customer_email || null;

      // Si pas d'email direct, on récupère via l'API Stripe avec le customer ID
      if (!email && sub.customer && process.env.STRIPE_SECRET_KEY) {
        const custRes = await fetch(`https://api.stripe.com/v1/customers/${sub.customer}`, {
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
        });
        const custData = await custRes.json();
        email = custData.email || null;
      }
      setPremium = false;
    }

    if (email && setPremium !== null) {
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_SERVICE,
            Authorization: `Bearer ${SUPABASE_SERVICE}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify({ is_premium: setPremium })
        }
      );
      const updateData = await updateRes.json();
      console.log('Webhook update result:', event.type, email, setPremium, JSON.stringify(updateData));
    } else {
      console.log('Webhook ignoré ou email manquant:', event.type, email);
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
