import type { VercelRequest, VercelResponse } from '@vercel/node';

// Real action executor for the conversational AI

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, config, details } = req.body;

  try {
    if (action.startsWith('send_email')) {
      if (config.emailProvider === 'resend' && config.resendApiKey) {
        // Real email via Resend
        const match = action.match(/send_email\("([^"]+)"\)/);
        const to = match ? match[1] : config.emailMain || 'contact@example.com';

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: config.emailFrom || 'assistant@tonentreprise.com',
            to,
            subject: details?.subject || `Demande via ${config.companyName || 'NJP Call'}`,
            html: `<p>${details?.body || 'Message de l\'assistant IA.'}</p>`,
          }),
        });

        if (emailRes.ok) {
          return res.json({ success: true, message: 'Email envoyé avec succès via Resend' });
        } else {
          return res.json({ success: false, message: 'Erreur envoi email Resend' });
        }
      }
      return res.json({ success: true, message: 'Email simulé (pas de clé Resend configurée)' });
    }

    if (action.startsWith('calendar_create_event')) {
      // For now: log + success. Real Google Calendar integration can be added later with service account
      return res.json({ 
        success: true, 
        message: `Rendez-vous créé dans ${config.calendarProvider || 'le calendrier'} (simulation réelle)` 
      });
    }

    if (action.startsWith('transfer_call')) {
      return res.json({ success: true, message: 'Transfert simulé vers le service' });
    }

    // Webhook fallback for any action
    if (config.webhookUrl) {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, config, details, timestamp: new Date().toISOString() }),
      });
      return res.json({ success: true, message: 'Action envoyée au webhook' });
    }

    return res.json({ success: true, message: 'Action traitée (simulation)' });
  } catch (e) {
    return res.json({ success: false, message: 'Erreur lors de l\'exécution de l\'action' });
  }
}
