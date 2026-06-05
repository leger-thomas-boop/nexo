import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.body;

  try {
    if (event.type === 'checkout.session.completed') {
      const email = event.data.object.customer_email;
      await supabase.from('profiles')
        .update({ is_premium: true })
        .eq('email', email);
    }

    if (event.type === 'customer.subscription.deleted') {
      const email = event.data.object.customer_email;
      await supabase.from('profiles')
        .update({ is_premium: false })
        .eq('email', email);
    }

    res.status(200).json({ received: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
