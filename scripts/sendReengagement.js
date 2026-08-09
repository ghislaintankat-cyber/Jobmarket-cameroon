// ===== JobMarket Cameroon : relance des utilisateurs inactifs =====
//
// Rôle : une fois par jour, repérer les personnes qui n'ont pas ouvert
// l'app depuis plusieurs jours et leur envoyer UN SEUL résumé
// ("N jobs pourraient vous intéresser") plutôt que de les laisser
// disparaître silencieusement. Volontairement séparé de
// scripts/sendNotifications.js (qui gère les push instantanés/cron normal)
// pour garder les deux logiques simples et indépendantes.
//
// Ne duplique PAS les push déjà reçus : ce script ne regarde pas
// "notifiedTo" (qui veut juste dire "un push a été tenté", pas "la
// personne l'a vu"). À la place, il se base sur le vrai signal
// d'inactivité : profiles/{uid}/lastActiveAt, écrit par index.html
// (writePresenceState) à chaque fois que l'app est au premier plan.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// En dessous de ce délai sans avoir eu l'app au premier plan, on considère
// que la personne suit déjà l'app normalement via les push instantanés
// existants — pas besoin de la relancer.
const INACTIVE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 jours

// Un job publié il y a plus longtemps que ça n'est plus assez "frais" pour
// donner envie de revenir, on ne le compte pas dans le résumé.
const DIGEST_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // 4 jours

// On ne renvoie pas de résumé à quelqu'un qui vient d'en recevoir un, même
// s'il reste inactif — sinon on le noie sous les rappels et il finit par
// désactiver les notifications complètement (l'effet inverse de ce qu'on veut).
const REENGAGE_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000; // 4 jours

const DEFAULT_MAX_DISTANCE_KM = 25;

// Mêmes règles que scripts/sendNotifications.js (catégorie via "icon",
// distance par haversine) — dupliquées ici volontairement pour garder ce
// script autonome. Si vous changez l'une, pensez à reporter sur l'autre.
function wantsCategory(uid, category, notifyPrefsMap) {
  const prefs = notifyPrefsMap[uid];
  if (!prefs) return true;
  return prefs[category] !== false;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function wantsDistance(uid, job, profilesMap, notifyPrefsMap) {
  if (typeof job.lat !== "number" || typeof job.lng !== "number") return true;
  const profile = profilesMap[uid];
  if (!profile || typeof profile.lat !== "number" || typeof profile.lng !== "number") return true;
  const prefs = notifyPrefsMap[uid] || {};
  const maxDistanceKm = typeof prefs.maxDistanceKm === "number" ? prefs.maxDistanceKm : DEFAULT_MAX_DISTANCE_KM;
  return distanceKm(profile.lat, profile.lng, job.lat, job.lng) <= maxDistanceKm;
}

// Textes volontairement simples (pas de grammaire plurielle fine par
// langue) : "(s)" générique comme le fait déjà buildNotificationData dans
// scripts/sendNotifications.js pour "et X autre(s)".
const REENGAGE_I18N = {
  fr: {
    title: (n) => `${n} job(s) pourrai(en)t vous intéresser`,
    body: (n) => `${n} nouvelle(s) offre(s) publiée(s) récemment dans vos catégories. Jetez-y un œil !`
  },
  en: {
    title: (n) => `${n} job(s) you might like`,
    body: (n) => `${n} new listing(s) recently posted in your categories. Take a look!`
  },
  it: {
    title: (n) => `${n} lavoro/i che potrebbero interessarti`,
    body: (n) => `${n} nuovo/i annuncio/i pubblicato/i di recente nelle tue categorie. Dai un'occhiata!`
  },
  de: {
    title: (n) => `${n} Job(s), die Sie interessieren könnten`,
    body: (n) => `${n} neue(s) Angebot(e) kürzlich in Ihren Kategorien veröffentlicht. Schauen Sie vorbei!`
  },
  zh: {
    title: (n) => `${n} 个您可能感兴趣的工作`,
    body: (n) => `您关注的分类中最近发布了 ${n} 个新工作，快去看看吧！`
  }
};

function buildDigestData(count, lang) {
  const s = REENGAGE_I18N[lang] || REENGAGE_I18N.fr;
  return {
    title: s.title(count),
    body: s.body(count),
    type: "reengagement-digest",
    variant: "digest",
    lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
  };
}

// Alimente notifStats/{date}/sent (même compteur partagé que
// scripts/sendNotifications.js), pour le dashboard admin. Non bloquant.
async function bumpSentStat(variant, count) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await db.ref(`notifStats/${today}/${variant}/sent`).transaction((current) => (current || 0) + count);
  } catch (e) {
    console.warn("bumpSentStat error (non bloquant)", e);
  }
}

async function sendReengagement() {
  try {
    const now = Date.now();

    const [tokensSnap, jobsSnap, profilesSnap, prefsSnap, reengageSnap] = await Promise.all([
      db.ref("notificationTokens").once("value"),
      db.ref("jobs").once("value"),
      db.ref("profiles").once("value"),
      db.ref("notifyPrefs").once("value"),
      db.ref("reengagement").once("value")
    ]);

    const tokensMap = tokensSnap.val() || {};
    const jobs = jobsSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};
    const notifyPrefsMap = prefsSnap.val() || {};
    const reengageMap = reengageSnap.val() || {};

    const entries = Object.entries(tokensMap)
      .filter(([, token]) => typeof token === "string" && token.length > 0)
      .map(([uid, token]) => ({ uid, token }));

    if (!entries.length) {
      console.log("Aucun token de notification enregistré, rien à faire.");
      return;
    }

    const recentJobs = Object.entries(jobs).filter(
      ([, job]) => (now - (job.timestamp || 0)) <= DIGEST_WINDOW_MS
    );
    if (!recentJobs.length) {
      console.log("Aucun job récent dans la fenêtre du digest, rien à envoyer.");
      return;
    }

    const updates = {};
    let sentCount = 0;
    let skippedActive = 0;
    let skippedCooldown = 0;
    let skippedNoMatch = 0;
    let skippedUnknownActivity = 0;

    for (const { uid, token } of entries) {
      const profile = profilesMap[uid] || {};

      // Champ récent : les comptes qui n'ont pas encore rouvert l'app depuis
      // le déploiement de cette fonctionnalité n'ont pas encore de valeur.
      // On ne présume JAMAIS qu'une absence de donnée = inactivité — sinon
      // tout le monde se fait traiter comme "inactif depuis toujours" au
      // premier passage, ce qui a effectivement causé un envoi à tort à
      // tous les utilisateurs.
      if (typeof profile.lastActiveAt !== "number") { skippedUnknownActivity++; continue; }
      const lastActiveAt = profile.lastActiveAt;
      if ((now - lastActiveAt) < INACTIVE_THRESHOLD_MS) { skippedActive++; continue; } // suit déjà l'app normalement

      const lastReengagedAt = reengageMap[uid] || 0;
      if ((now - lastReengagedAt) < REENGAGE_COOLDOWN_MS) { skippedCooldown++; continue; } // résumé déjà envoyé récemment

      const matchingJobs = recentJobs.filter(([, job]) => {
        const category = (job.icon || "").toLowerCase();
        return wantsCategory(uid, category, notifyPrefsMap) && wantsDistance(uid, job, profilesMap, notifyPrefsMap);
      });
      if (!matchingJobs.length) { skippedNoMatch++; continue; } // rien de pertinent à proposer, inutile de relancer

      const lang = profile.lang || "fr";
      const data = buildDigestData(matchingJobs.length, lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`reengagement/${uid}`] = now;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`notificationTokens/${uid}`] = null; // token mort, nettoyage au passage
          } else {
            console.error(`❌ Erreur d'envoi digest pour ${uid} (${code || "inconnue"}):`, res.error && res.error.message);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi digest pour ${uid}, on retentera au prochain passage:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    if (sentCount > 0) await bumpSentStat("digest", sentCount);

    console.log(
      `✅ ${sentCount} digest(s) de relance envoyé(s). ` +
      `(${skippedActive} déjà actif(s), ${skippedCooldown} en cooldown, ${skippedNoMatch} sans job pertinent, ${skippedUnknownActivity} sans donnée d'activité)`
    );
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

// Même raison qu'à la fin de scripts/sendNotifications.js : fermer
// explicitement la connexion Firebase pour que le processus Node se
// termine, avec un filet de sécurité différé pour laisser les derniers
// logs s'écrire avant un éventuel process.exit() forcé.
sendReengagement().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
