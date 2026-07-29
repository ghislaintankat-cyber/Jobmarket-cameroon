// ===== JobMarket Cameroon : aperçu de partage par job =====
//
// Rôle : les robots qui génèrent les aperçus de lien (WhatsApp, Facebook,
// Twitter...) ne lisent que le HTML brut d'une page, ils n'exécutent jamais
// le JavaScript. Or JobMarket Cameroon est une SPA hébergée sur GitHub
// Pages (pas de serveur), donc il est impossible de faire varier les
// balises <meta og:*> par job directement dans index.html — un lien
// partagé afficherait toujours le même aperçu générique, quel que soit le
// job.
//
// Ce worker sert d'intermédiaire, gratuit et sans domaine personnalisé
// (contrairement à une solution "Cloudflare devant votre domaine", qui
// exigerait de posséder un domaine et d'y faire pointer les DNS) :
//   - Un robot de prévisualisation → on lui sert une page HTML minimale
//     avec les vraies infos du job (titre, description, photo).
//   - Une vraie personne → redirection immédiate vers l'app normale.
//
// Les liens de partage (voir getJobShareLink() dans index.html) pointent
// vers CE worker plutôt que directement vers l'app.

const APP_BASE_URL = "https://ghislaintankat-cyber.github.io/Jobmarket-cameroon/";
const FALLBACK_IMAGE = "https://ghislaintankat-cyber.github.io/Jobmarket-cameroon/icon-512.png";
const FIREBASE_JOBS_URL = "https://jobmarketfuture-default-rtdb.firebaseio.com/jobs";

// Signatures des robots connus qui génèrent des aperçus de lien. Liste non
// exhaustive par nature (de nouveaux crawlers apparaissent), mais couvre
// les plateformes les plus utilisées pour partager un lien JobMarket.
const BOT_USER_AGENTS = [
  "whatsapp", "facebookexternalhit", "facebot", "twitterbot", "linkedinbot",
  "telegrambot", "discordbot", "slackbot", "skypeuripreview", "redditbot",
  "googlebot", "bingbot", "applebot", "pinterest"
];

function isBotRequest(userAgent) {
  const ua = (userAgent || "").toLowerCase();
  return BOT_USER_AGENTS.some((sig) => ua.includes(sig));
}

// Échappement minimal pour insertion sûre dans des attributs HTML — les
// titres/descriptions viennent de contenu utilisateur (jobs publiés par
// n'importe qui), donc jamais d'insertion brute.
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function firstJobImage(job) {
  if (Array.isArray(job.images) && job.images[0]) return job.images[0];
  if (job.image) return job.image;
  return null;
}

function renderPreviewHtml(job, jobId) {
  const title = escapeHtml(job ? job.title : "JobMarket Cameroon");
  const description = escapeHtml(
    truncate(job ? job.desc : "Trouvez des artisans et jobs proches de vous au Cameroun.", 200)
  );
  const image = escapeHtml((job && firstJobImage(job)) || FALLBACK_IMAGE);
  const targetUrl = escapeHtml(`${APP_BASE_URL}#job=${jobId}`);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${title} · JobMarket Cameroon</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="JobMarket Cameroon">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${targetUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0;url=${targetUrl}">
</head>
<body>
<p>Redirection vers <a href="${targetUrl}">JobMarket Cameroon</a>…</p>
</body>
</html>`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Attendu : /job/{jobId} — tout le reste (racine, chemins inconnus)
    // redirige simplement vers l'app.
    const match = url.pathname.match(/^\/job\/([a-zA-Z0-9_-]+)\/?$/);

    if (!match) {
      return Response.redirect(APP_BASE_URL, 302);
    }

    const jobId = match[1];
    const userAgent = request.headers.get("User-Agent");

    if (!isBotRequest(userAgent)) {
      // Vraie personne : on ne lui fait pas perdre de temps sur une page
      // intermédiaire, direction l'app tout de suite.
      return Response.redirect(`${APP_BASE_URL}#job=${jobId}`, 302);
    }

    // Robot de prévisualisation : on va chercher les vraies infos du job.
    // Lecture publique (jobs/.read: true dans les règles Firebase), pas
    // besoin d'authentification.
    let job = null;
    try {
      const res = await fetch(`${FIREBASE_JOBS_URL}/${jobId}.json`);
      if (res.ok) job = await res.json();
    } catch (err) {
      console.error("Erreur récupération job pour aperçu", err);
      // job reste null : renderPreviewHtml gère ce cas avec un aperçu générique
    }

    return new Response(renderPreviewHtml(job, jobId), {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        // Court cache : un job peut être modifié/supprimé, pas la peine de
        // servir un aperçu périmé pendant des heures.
        "Cache-Control": "public, max-age=300"
      }
    });
  }
};
