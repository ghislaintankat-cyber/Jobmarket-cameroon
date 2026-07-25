// ===== JobMarket Cameroon : notifier le propriétaire d'un job qu'on l'a contacté =====
//
// Rôle : dès qu'une entrée est ajoutée dans "job_contacts" (quelqu'un a
// cliqué pour contacter le propriétaire d'un job via WhatsApp), prévenir
// ce dernier par push. Contrairement à scripts/sendNotifications.js, il
// n'y a ici qu'UN SEUL destinataire connu à l'avance (jobOwnerUid) — pas de
// filtrage par catégorie/distance à faire, puisque ce n'est pas une
// découverte de nouveau job mais une réponse directe à SA propre annonce.
//
// Déclenché instantanément via le même relais Cloudflare Worker que les
// nouveaux jobs (voir worker/index.js, event_type "new-contact"), avec un
// cron de secours plus espacé en filet de sécurité (voir contact-notify.yml).

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// Comme pour les jobs (JOB_WINDOW_MS dans sendNotifications.js) : au-delà
// de cette fenêtre, un contact non notifié n'est plus assez "frais" pour
// qu'on s'en préoccupe à ce run (borne aussi le travail par exécution).
const CONTACT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const CONTACT_I18N = {
  fr: {
    title: "Quelqu'un s'intéresse à votre annonce",
    body: (jobTitle) => `Une personne vient de vous contacter au sujet de : ${jobTitle}`
  },
  en: {
    title: "Someone is interested in your listing",
    body: (jobTitle) => `Someone just contacted you about: ${jobTitle}`
  },
  it: {
    title: "Qualcuno è interessato al tuo annuncio",
    body: (jobTitle) => `Qualcuno ti ha appena contattato per: ${jobTitle}`
  },
  de: {
    title: "Jemand interessiert sich für Ihr Angebot",
    body: (jobTitle) => `Jemand hat Sie gerade kontaktiert bezüglich: ${jobTitle}`
  },
  zh: {
    title: "有人对您的招聘感兴趣",
    body: (jobTitle) => `有人刚刚联系了您，关于：${jobTitle}`
  }
};

function buildContactNotifData(jobTitle, jobId, lang) {
  const s = CONTACT_I18N[lang] || CONTACT_I18N.fr;
  return {
    title: s.title,
    body: s.body(jobTitle || "votre annonce"),
    jobId: jobId ? String(jobId) : "",
    type: "job-contact"
  };
}

async function sendContactNotifications() {
  try {
    const now = Date.now();

    const [contactsSnap, tokensSnap, profilesSnap] = await Promise.all([
      db.ref("job_contacts").once("value"),
      db.ref("notificationTokens").once("value"),
      db.ref("profiles").once("value")
    ]);

    const contacts = contactsSnap.val() || {};
    const tokensMap = tokensSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};

    const pending = Object.entries(contacts).filter(([, c]) => {
      if (!c || c.notifiedOwner) return false;
      if (!c.jobOwnerUid || !c.timestamp) return false;
      return (now - c.timestamp) <= CONTACT_WINDOW_MS;
    });

    if (!pending.length) {
      console.log("Aucun nouveau contact à notifier.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [contactId, contact] of pending) {
      const token = tokensMap[contact.jobOwnerUid];
      if (!token) {
        // Pas de token = propriétaire n'a pas les notifications activées :
        // on marque quand même comme traité, sinon ce contact reste "en
        // attente" indéfiniment et sera rescanné à chaque run pour rien.
        updates[`job_contacts/${contactId}/notifiedOwner`] = true;
        continue;
      }

      let jobTitle = "";
      try {
        const jobSnap = await db.ref(`jobs/${contact.jobId}/title`).once("value");
        jobTitle = jobSnap.val() || "";
      } catch (e) { /* job peut-être supprimé depuis : on notifie quand même, sans titre précis */ }

      const lang = (profilesMap[contact.jobOwnerUid] && profilesMap[contact.jobOwnerUid].lang) || "fr";
      const data = buildContactNotifData(jobTitle, contact.jobId, lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`job_contacts/${contactId}/notifiedOwner`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`job_contacts/${contactId}/notifiedOwner`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${contact.jobOwnerUid}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour le contact ${contactId} (${code || "inconnue"}):`, res.error && res.error.message);
            // Pas invalide, juste raté : ce contact sera retenté au run suivant.
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour le contact ${contactId}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} notification(s) de contact envoyée(s) sur ${pending.length} en attente.`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendContactNotifications().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
