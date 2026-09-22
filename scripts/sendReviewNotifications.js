// ===== JobMarket Cameroon : notifier qu'un avis vient d'être laissé =====
//
// Rôle : dès qu'une entrée est ajoutée dans "reviews", prévenir la personne
// notée (jobOwnerUid, c'est-à-dire le prestataire qui a été contacté puis
// évalué — voir index.html, le champ s'appelle "jobOwnerUid" mais désigne
// bien le destinataire de l'avis, pas nécessairement l'auteur du job).
// Même logique qu'un seul destinataire connu à l'avance que
// scripts/sendContactNotifications.js : pas de filtrage catégorie/distance
// à faire ici.
//
// Déclenché instantanément via le même relais Cloudflare Worker (voir
// worker/index.js, event_type "new-review"), avec un cron de secours plus
// espacé en filet de sécurité (voir review-notify.yml).

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
const { loadTokensMap, tokensFor, sendToUid } = (() => {
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

// Comme pour les jobs/contacts : au-delà de cette fenêtre, un avis non
// notifié n'est plus assez "frais" pour qu'on s'en préoccupe à ce run.
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const STARS = { 1: "⭐", 2: "⭐⭐", 3: "⭐⭐⭐", 4: "⭐⭐⭐⭐", 5: "⭐⭐⭐⭐⭐" };

const REVIEW_I18N = {
  fr: {
    title: (rating) => `Nouvel avis reçu ${STARS[rating] || ""}`,
    body: (rating, comment) => comment ? `"${truncate(comment)}"` : `Vous avez reçu une note de ${rating}/5.`
  },
  en: {
    title: (rating) => `New review received ${STARS[rating] || ""}`,
    body: (rating, comment) => comment ? `"${truncate(comment)}"` : `You received a ${rating}/5 rating.`
  },
  it: {
    title: (rating) => `Nuova recensione ricevuta ${STARS[rating] || ""}`,
    body: (rating, comment) => comment ? `"${truncate(comment)}"` : `Hai ricevuto una valutazione di ${rating}/5.`
  },
  de: {
    title: (rating) => `Neue Bewertung erhalten ${STARS[rating] || ""}`,
    body: (rating, comment) => comment ? `"${truncate(comment)}"` : `Sie haben eine Bewertung von ${rating}/5 erhalten.`
  },
  zh: {
    title: (rating) => `收到新评价 ${STARS[rating] || ""}`,
    body: (rating, comment) => comment ? `"${truncate(comment)}"` : `您收到了 ${rating}/5 的评分。`
  }
};

// Le commentaire est écrit librement par l'auteur de l'avis : on le
// tronque pour ne pas produire une notif interminable ni dépasser les
// limites de taille des messages FCM.
function truncate(text) {
  if (!text) return "";
  return text.length > 100 ? text.slice(0, 97) + "..." : text;
}

function buildReviewNotifData(rating, comment, lang) {
  const s = REVIEW_I18N[lang] || REVIEW_I18N.fr;
  return {
    title: s.title(rating),
    body: s.body(rating, comment),
    type: "new-review",
    lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
  };
}

async function sendReviewNotifications() {
  try {
    const now = Date.now();

    const [reviewsSnap, tokensSnap, profilesSnap] = await Promise.all([
      db.ref("reviews").once("value"),
      loadTokensMap(db),
      db.ref("profiles").once("value")
    ]);

    const reviews = reviewsSnap.val() || {};
    const tokensMap = tokensSnap;
    const profilesMap = profilesSnap.val() || {};

    const pending = Object.entries(reviews).filter(([, r]) => {
      if (!r || r.notifiedOwner) return false;
      if (!r.jobOwnerUid || !r.timestamp) return false;
      return (now - r.timestamp) <= REVIEW_WINDOW_MS;
    });

    if (!pending.length) {
      console.log("Aucun nouvel avis à notifier.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [reviewId, review] of pending) {
      const token = tokensFor(tokensMap, review.jobOwnerUid);
      if (!token.length) {
        // Pas de token = pas de notifications activées : on marque quand
        // même comme traité, sinon cet avis reste "en attente" indéfiniment.
        updates[`reviews/${reviewId}/notifiedOwner`] = true;
        continue;
      }

      const lang = (profilesMap[review.jobOwnerUid] && profilesMap[review.jobOwnerUid].lang) || "fr";
      const data = buildReviewNotifData(review.rating, review.comment, lang);

      try {
        // (20260906j) envoi multi-appareils + nettoyage chirurgical
        const outcome = await sendToUid(messaging, db, review.jobOwnerUid, tokensMap, data);
        if (outcome === "sent") {
          sentCount++;
          updates[`reviews/${reviewId}/notifiedOwner`] = true;
        } else {
          // (20260906j) sendToUid a deja retire les appareils reellement
          // refuses par FCM, apres relecture. Plus de suppression aveugle.
          if (outcome === "invalid") {
            updates[`reviews/${reviewId}/notifiedOwner`] = true; // tous les appareils sont morts
          } else {
            console.error(`❌ Envoi non abouti pour l'avis ${reviewId} (${outcome}).`);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour l'avis ${reviewId}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} notification(s) d'avis envoyée(s) sur ${pending.length} en attente.`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendReviewNotifications().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
