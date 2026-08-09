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
      db.ref("notificationTokens").once("value"),
      db.ref("profiles").once("value")
    ]);

    const reviews = reviewsSnap.val() || {};
    const tokensMap = tokensSnap.val() || {};
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
      const token = tokensMap[review.jobOwnerUid];
      if (!token) {
        // Pas de token = pas de notifications activées : on marque quand
        // même comme traité, sinon cet avis reste "en attente" indéfiniment.
        updates[`reviews/${reviewId}/notifiedOwner`] = true;
        continue;
      }

      const lang = (profilesMap[review.jobOwnerUid] && profilesMap[review.jobOwnerUid].lang) || "fr";
      const data = buildReviewNotifData(review.rating, review.comment, lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } } // priorité haute pour une livraison plus rapide (voir demande utilisateur)
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`reviews/${reviewId}/notifiedOwner`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`reviews/${reviewId}/notifiedOwner`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${review.jobOwnerUid}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour l'avis ${reviewId} (${code || "inconnue"}):`, res.error && res.error.message);
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
