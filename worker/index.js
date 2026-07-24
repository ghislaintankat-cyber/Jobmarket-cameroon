// ===== Relais "notif instantanée" (Cloudflare Workers, gratuit, sans CB) =====
//
// Rôle : recevoir un signal "un job vient d'être publié" depuis index.html,
// et déclencher IMMÉDIATEMENT le workflow GitHub Actions notify.yml (au lieu
// d'attendre son prochain passage cron). notify.yml appelle ensuite
// scripts/sendNotifications.js comme d'habitude — rien ne change côté envoi
// des notifications, on gagne juste le délai d'attente du cron.
//
// Pourquoi passer par ici plutôt qu'appeler l'API GitHub directement depuis
// index.html : ça exigerait d'exposer un token GitHub dans le code source
// public de l'app, ce que n'importe qui pourrait alors utiliser pour
// déclencher vos workflows à volonté. Ici, le token GitHub reste un secret
// Cloudflare, jamais visible du navigateur — c'est la vraie protection.
//
// X-Trigger-Secret ci-dessous n'en est PAS une : il est lisible en clair
// dans index.html (voir NOTIFY_TRIGGER_SECRET), donc n'importe qui peut le
// copier. Il reste utile comme frein basique, mais la vraie protection
// contre l'abus, c'est la limite de fréquence (KV) plus bas.

const MIN_INTERVAL_MS = 20_000; // 20s : borne l'abus et coalesce les publications rapprochées en un seul run.

// Domaine depuis lequel index.html appelle ce worker. Le navigateur exige
// que CE domaine exact soit renvoyé dans Access-Control-Allow-Origin,
// sinon il bloque la réponse même si le serveur a tout bien traité — c'est
// ça qui cassait le déclenchement instantané (voir CORS ci-dessous).
const ALLOWED_ORIGIN = 'https://ghislaintankat-cyber.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Trigger-Secret, Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

export default {
  async fetch(request, env) {
    // Requête préliminaire ("preflight") que le navigateur envoie
    // automatiquement avant tout POST avec un en-tête personnalisé
    // (X-Trigger-Secret). Sans cette réponse, le navigateur bloque
    // TOUJOURS la vraie requête, silencieusement, sans que le code
    // JS de index.html ne voie d'erreur explicite.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    const provided = request.headers.get('X-Trigger-Secret');
    if (!provided || provided !== env.TRIGGER_SECRET) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
    }

    // Limite de fréquence globale via KV. Best-effort : si le KV est
    // indisponible, on continue sans limiter plutôt que de bloquer la
    // fonctionnalité — le pire cas reste "un déclenchement GitHub en
    // trop", jamais "notification perdue".
    if (env.RATE_LIMIT_KV) {
      try {
        const last = await env.RATE_LIMIT_KV.get('last-dispatch');
        const now = Date.now();
        if (last && (now - Number(last)) < MIN_INTERVAL_MS) {
          return new Response('Coalesced (rate-limited)', { status: 200, headers: corsHeaders() });
        }
        await env.RATE_LIMIT_KV.put('last-dispatch', String(now), { expirationTtl: 60 });
      } catch (err) {
        console.warn('Rate limit KV indisponible, on continue sans limiter', err);
      }
    }

    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GH_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'jobmarket-notify-trigger',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ event_type: 'new-job' })
        }
      );

      if (!ghRes.ok) {
        const text = await ghRes.text();
        console.error('GitHub dispatch failed', ghRes.status, text);
        return new Response('GitHub dispatch failed, cron de secours prendra le relais', { status: 502, headers: corsHeaders() });
      }

      return new Response('OK', { status: 200, headers: corsHeaders() });
    } catch (err) {
      console.error('Worker error', err);
      return new Response('Erreur relais, cron de secours prendra le relais', { status: 500, headers: corsHeaders() });
    }
  }
};
