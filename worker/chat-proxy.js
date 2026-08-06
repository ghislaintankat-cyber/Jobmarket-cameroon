// ===== JobMarket Cameroon : proxy sécurisé pour l'assistant IA =====
//
// Rôle : le chat intégré (index.html, sendChatMessage/callChatAI) a besoin
// d'appeler un vrai modèle de langage (Llama 3.3 70B via Groq, gratuit,
// sans carte bancaire) — mais la clé API Groq ne doit JAMAIS apparaître
// dans index.html, qui est un fichier public sur GitHub. N'importe qui
// pourrait la copier et l'utiliser à volonté, épuisant le quota gratuit
// partagé (ou pire, à vos frais si le compte passe un jour en payant).
//
// Ce worker reçoit l'historique de conversation depuis le client, ajoute
// le prompt système (gardé ici, pas côté client, pour rester la seule
// source de vérité), appelle Groq avec la clé secrète stockée dans les
// variables Cloudflare, et renvoie uniquement la réponse texte au client.
//
// Le quota gratuit Groq (~1000 requêtes/jour sur llama-3.3-70b-versatile,
// à la date de cette intégration) est PARTAGÉ par toute l'app — un budget
// journalier prudent est appliqué ici pour ne jamais s'en approcher, quel
// que soit le volume réel de conversations. Si le budget est atteint, le
// worker répond avec fallback:true plutôt qu'une erreur, pour que le
// client bascule proprement sur l'assistant local (règles simples,
// toujours disponible) au lieu d'un message d'erreur.

const ALLOWED_ORIGIN = "https://ghislaintankat-cyber.github.io";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Marge large sous le plafond réel (~1000/jour) : laisse de la place pour
// d'autres usages éventuels de la même clé, et absorbe les pics sans
// jamais risquer un blocage de la clé par Groq pour la journée entière.
const DAILY_BUDGET = 400;

const CHAT_SYSTEM_PROMPT = `Tu es l'assistant du support client de JobMarket Cameroon, une application qui met en relation des particuliers avec des artisans et prestataires de proximité (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique, etc.).

Tu peux aider avec :
- Comment publier un job / une demande de service sur la carte
- Comment trouver un artisan proche (filtres par catégorie, distance, itinéraire)
- Comment contacter ou évaluer un artisan
- Des questions sur le compte, les notifications, ou l'utilisation générale de l'application
- Des conseils généraux pour bien décrire un job ou choisir le bon prestataire

Sur les notifications, plus précisément :
- Elles se règlent dans le compte, section "Notifications" (icône cloche) : on peut y choisir les catégories de jobs pour lesquelles on veut être alerté (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique), et un curseur "Distance maximale" (5 à 100 km) pour ne recevoir que les jobs proches de sa position.
- Le curseur de distance ne fonctionne que si la géolocalisation de l'app est activée ; sans position connue, l'utilisateur continue de recevoir toutes les notifications de ses catégories choisies, sans filtrage par distance.
- Si les notifications ne s'affichent jamais du tout, la cause la plus fréquente est que le navigateur a été refusé au popup d'autorisation : il faut alors l'activer manuellement dans les réglages du navigateur (l'app ne peut pas redemander toute seule après un refus).

Réponds toujours de façon brève et directe (2-4 phrases maximum sauf si la question exige plus de détail), dans la langue utilisée par la personne.

Si la demande concerne un problème de compte nécessitant une action humaine (paiement contesté, signalement d'abus, suppression de compte), explique brièvement ce que tu peux faire et précise qu'un agent humain prendra le relais si nécessaire — ne prétends jamais avoir effectué une action que tu ne peux pas réellement faire (pas d'accès aux comptes, paiements, ou données réelles).

Si la question sort complètement du cadre de JobMarket Cameroon, dis-le poliment et recentre la conversation.`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return jsonResponse({ error: "No messages provided" }, 400);
    }

    // Budget journalier partagé, suivi via KV. Best-effort comme les
    // autres workers de cette app : si le KV est indisponible, on laisse
    // passer plutôt que de bloquer l'assistant pour une raison
    // d'infrastructure secondaire.
    if (env.CHAT_BUDGET_KV) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const key = `chat-count-${today}`;
        const current = parseInt((await env.CHAT_BUDGET_KV.get(key)) || "0", 10);
        if (current >= DAILY_BUDGET) {
          return jsonResponse({ fallback: true, reason: "daily-budget-reached" }, 200);
        }
        await env.CHAT_BUDGET_KV.put(key, String(current + 1), { expirationTtl: 172800 }); // 2 jours, large marge
      } catch (err) {
        console.warn("Budget KV indisponible, on continue sans limiter", err);
      }
    }

    // Ne garder que les 10 derniers échanges : suffisant pour le contexte
    // d'un chat de support, et ça borne le coût/latence de chaque appel.
    const trimmedMessages = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000)
    }));

    try {
      const groqRes = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...trimmedMessages],
          temperature: 0.4,
          max_tokens: 400
        })
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        console.error("Groq API error", groqRes.status, errText);
        // 429 (quota Groq atteint côté leur infra) ou toute autre erreur :
        // on bascule sur l'assistant local plutôt que d'afficher une
        // erreur brute à la personne.
        return jsonResponse({ fallback: true, reason: "groq-error" }, 200);
      }

      const data = await groqRes.json();
      const reply = data.choices?.[0]?.message?.content;
      if (!reply) {
        return jsonResponse({ fallback: true, reason: "empty-response" }, 200);
      }

      return jsonResponse({ reply });
    } catch (err) {
      console.error("Erreur worker chat-proxy", err);
      return jsonResponse({ fallback: true, reason: "worker-error" }, 200);
    }
  }
};
