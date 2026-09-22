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
// (20260906l) CHARGEMENT TOLERANT DE LA SOURCE UNIQUE.
// pushTokens.js est un fichier NOUVEAU : s'il est oublie lors du depot sur
// GitHub, un `require` sec ferait planter ce script au demarrage — y compris
// les notifications qui fonctionnent aujourd'hui. On degrade donc en securite
// plutot que de tomber : lecture des deux emplacements, envoi a tous les
// appareils, et SURTOUT aucune suppression de jeton (c'est la suppression qui
// a bloque les appels pendant 16 vagues ; en mode degrade on n'y touche pas).
const { loadTokensMap, sendToUid } = (() => {
  try {
    return require("./pushTokens");
  } catch (e) {
    console.warn("⚠️ scripts/pushTokens.js INTROUVABLE — mode degrade : " +
                 "les notifications partent, mais aucun jeton ne sera nettoye. " +
                 "Depose pushTokens.js dans scripts/ pour retablir le mode normal.");
    const tokensFor = (map, uid) => {
      const v = map && uid ? map[uid] : null;
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    };
    return {
      tokensFor,
      countUsers: (map) => Object.keys(map || {}).length,
      loadTokensMap: async (db) => {
        const out = Object.create(null);
        const add = (uid, tk) => {
          if (!uid || typeof tk !== "string" || !tk.length) return;
          if (!out[uid]) out[uid] = [];
          if (!out[uid].includes(tk)) out[uid].push(tk);
        };
        const [a, b] = await Promise.all([
          db.ref("notificationTokens").once("value"),
          db.ref("notificationTokens_v2").once("value")
        ]);
        Object.entries(a.val() || {}).forEach(([uid, tk]) => add(uid, tk));
        Object.entries(b.val() || {}).forEach(([uid, devs]) => {
          if (!devs || typeof devs !== "object") return;
          Object.values(devs).forEach((d) => add(uid, d && typeof d === "object" ? d.token : d));
        });
        return out;
      },
      sendToUid: async (messaging, db, uid, map, data) => {
        const tokens = tokensFor(map, uid);
        if (!tokens.length) return "no-token";
        try {
          const r = await messaging.sendEachForMulticast({
            tokens, data, webpush: { headers: { Urgency: "high" } }
          });
          return (r.responses || []).some((x) => x && x.success) ? "sent" : "error";
        } catch (err) {
          console.error(`❌ Exception envoi à ${uid} :`, err);
          return "error";
        }
      }
    };
  }
})();

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
      loadTokensMap(db),
      db.ref("jobs").once("value"),
      db.ref("profiles").once("value"),
      db.ref("notifyPrefs").once("value"),
      db.ref("reengagement").once("value")
    ]);

    // (20260906j) carte fusionnee : uid -> [jetons de TOUS les appareils]
    const tokensMap = tokensSnap;
    const jobs = jobsSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};
    const notifyPrefsMap = prefsSnap.val() || {};
    const reengageMap = reengageSnap.val() || {};

    const entries = Object.entries(tokensMap)
      .filter(([, tokens]) => Array.isArray(tokens) && tokens.length > 0)
      .map(([uid]) => ({ uid }));

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

    for (const { uid } of entries) {
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
        // (20260906j) envoi multi-appareils + nettoyage chirurgical
        const outcome = await sendToUid(messaging, db, uid, tokensMap, data);
        if (outcome === "sent") {
          sentCount++;
          updates[`reengagement/${uid}`] = now;
        } else if (outcome !== "invalid") {
          // "invalid" = appareils morts, deja retires proprement par sendToUid
          console.error(`❌ Envoi digest non abouti pour ${uid} (${outcome}).`);
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
