// ===== JobMarket Cameroon : rappel push pour laisser un avis =====
//
// Rôle : index.html a déjà un mécanisme in-app (checkPendingReviews) qui
// rappelle à quelqu'un de noter un prestataire qu'il a contacté, une fois
// REVIEW_DELAY_MS passé — MAIS seulement quand cette personne rouvre l'app.
// Ce script fait la même chose en push, pour toucher aussi ceux qui ne
// rouvrent pas l'app spontanément.
//
// Un seul push par contact (job_contacts/{id}/reviewReminderSent), jamais
// répété — le rappel in-app existant (checkPendingReviews) continue de
// prendre le relais à chaque connexion tant que l'avis n'est pas laissé.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// Même délai que côté client (index.html, REVIEW_DELAY_MS) : on ne
// dérange pas avant que la personne ait eu le temps de vraiment échanger
// avec le prestataire sur WhatsApp.
const REVIEW_DELAY_MS = 3 * 60 * 60 * 1000; // 3 heures

// Au-delà, le contact est trop ancien pour qu'un rappel soit encore
// pertinent — la personne a probablement déjà tranché (avis laissé
// ailleurs, oublié, ou pas donné suite).
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours

const REVIEW_REMINDER_I18N = {
  fr: {
    title: "Comment s'est passé le contact ?",
    body: (name, jobTitle) => `Vous avez contacté ${name} au sujet de "${jobTitle}". Laissez un avis pour aider les autres utilisateurs !`
  },
  en: {
    title: "How did it go?",
    body: (name, jobTitle) => `You contacted ${name} about "${jobTitle}". Leave a review to help other users!`
  },
  it: {
    title: "Com'è andato il contatto?",
    body: (name, jobTitle) => `Hai contattato ${name} per "${jobTitle}". Lascia una recensione per aiutare gli altri utenti!`
  },
  de: {
    title: "Wie ist es gelaufen?",
    body: (name, jobTitle) => `Sie haben ${name} bezüglich "${jobTitle}" kontaktiert. Hinterlassen Sie eine Bewertung, um anderen zu helfen!`
  },
  zh: {
    title: "联系情况如何？",
    body: (name, jobTitle) => `您联系了${name}，关于"${jobTitle}"。留下评价帮助其他用户吧！`
  }
};

function buildReviewReminderData(providerName, jobTitle, jobId, lang) {
  const s = REVIEW_REMINDER_I18N[lang] || REVIEW_REMINDER_I18N.fr;
  return {
    title: s.title,
    body: s.body(providerName || "le prestataire", jobTitle || "cette annonce"),
    jobId: jobId ? String(jobId) : "",
    type: "review-reminder"
  };
}

async function sendReviewReminders() {
  try {
    const now = Date.now();

    const [contactsSnap, tokensSnap, profilesSnap, jobsSnap] = await Promise.all([
      db.ref("job_contacts").once("value"),
      db.ref("notificationTokens").once("value"),
      db.ref("profiles").once("value"),
      db.ref("jobs").once("value")
    ]);

    const contacts = contactsSnap.val() || {};
    const tokensMap = tokensSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};
    const jobsMap = jobsSnap.val() || {};

    const candidates = Object.entries(contacts).filter(([, c]) => {
      if (!c || c.reviewed !== false || c.reviewReminderSent) return false;
      if (!c.contactUid || !c.timestamp) return false;
      const age = now - c.timestamp;
      return age > REVIEW_DELAY_MS && age <= MAX_AGE_MS;
    });

    if (!candidates.length) {
      console.log("Aucun rappel d'avis à envoyer aujourd'hui.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [contactId, contact] of candidates) {
      const token = tokensMap[contact.contactUid];
      if (!token) {
        updates[`job_contacts/${contactId}/reviewReminderSent`] = true; // pas de token = inutile de rescanner
        continue;
      }

      const job = jobsMap[contact.jobId];
      const jobTitle = job ? job.title : "";
      const providerProfile = profilesMap[contact.jobOwnerUid] || {};
      const providerName = providerProfile.name || providerProfile.company || "";
      const lang = (profilesMap[contact.contactUid] && profilesMap[contact.contactUid].lang) || "fr";
      const data = buildReviewReminderData(providerName, jobTitle, contact.jobId, lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "normal" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`job_contacts/${contactId}/reviewReminderSent`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`job_contacts/${contactId}/reviewReminderSent`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${contact.contactUid}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour le contact ${contactId} (${code || "inconnue"}):`, res.error && res.error.message);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour le contact ${contactId}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} rappel(s) d'avis envoyé(s) sur ${candidates.length} en attente.`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendReviewReminders().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
