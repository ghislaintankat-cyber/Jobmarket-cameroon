// ===== JobMarket Cameroon : rappel pour les jobs sans aucun contact =====
//
// Rôle : une fois par jour, repérer les jobs publiés depuis 48h ou plus qui
// n'ont reçu AUCUN contact (aucune entrée dans "job_contacts" avec ce
// jobId), et prévenir le propriétaire — pas pour le culpabiliser, mais pour
// lui donner une chance concrète d'agir : améliorer la description, la
// photo, ou le prix pour attirer plus de candidats.
//
// Il n'existe pas de champ "pourvu / non pourvu" dans le modèle de
// données : "zéro contact après 48h" est le meilleur signal disponible
// sans ajouter de nouvelle donnée à gérer. Ce n'est pas parfait (un job
// contacté une fois puis abandonné ne sera pas détecté), mais ça couvre le
// cas le plus fréquent et le plus actionnable : un job qui ne trouve
// personne du tout.
//
// UN SEUL rappel par job (job.noContactReminded), jamais répété — sinon on
// harcèle quelqu'un pour un job qu'il a peut-être décidé d'abandonner.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// En dessous de ce délai, on laisse le temps aux notifications normales
// (nouveaux jobs) de faire leur travail — pas la peine de s'alarmer trop tôt.
const MIN_AGE_MS = 48 * 60 * 60 * 1000; // 48h

// Au-delà, le job est trop ancien pour qu'un rappel soit encore utile (la
// personne a probablement déjà abandonné ou trouvé une solution ailleurs).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const REMINDER_I18N = {
  fr: {
    title: "Aucun contact pour l'instant",
    body: (title) => `Votre annonce "${title}" n'a reçu aucun contact depuis 48h. Essayez d'ajouter une photo ou d'ajuster le prix pour attirer plus de monde.`
  },
  en: {
    title: "No contacts yet",
    body: (title) => `Your listing "${title}" hasn't received any contacts in 48h. Try adding a photo or adjusting the price to attract more people.`
  },
  it: {
    title: "Ancora nessun contatto",
    body: (title) => `Il tuo annuncio "${title}" non ha ricevuto contatti da 48 ore. Prova ad aggiungere una foto o ad aggiustare il prezzo.`
  },
  de: {
    title: "Noch keine Kontakte",
    body: (title) => `Ihre Anzeige "${title}" hat seit 48 Stunden keine Kontaktanfragen erhalten. Versuchen Sie, ein Foto hinzuzufügen oder den Preis anzupassen.`
  },
  zh: {
    title: "暂无联系",
    body: (title) => `您的招聘"${title}"发布48小时后仍无人联系。可以尝试添加照片或调整价格来吸引更多人。`
  }
};

function buildReminderData(jobTitle, jobId, lang) {
  const s = REMINDER_I18N[lang] || REMINDER_I18N.fr;
  return {
    title: s.title,
    body: s.body(jobTitle || "votre annonce"),
    jobId: jobId ? String(jobId) : "",
    type: "no-contact-reminder",
    lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
  };
}

async function sendNoContactReminders() {
  try {
    const now = Date.now();

    const [jobsSnap, contactsSnap, tokensSnap, profilesSnap] = await Promise.all([
      db.ref("jobs").once("value"),
      db.ref("job_contacts").once("value"),
      db.ref("notificationTokens").once("value"),
      db.ref("profiles").once("value")
    ]);

    const jobs = jobsSnap.val() || {};
    const contacts = contactsSnap.val() || {};
    const tokensMap = tokensSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};

    const contactedJobIds = new Set(
      Object.values(contacts).map((c) => c && c.jobId).filter(Boolean)
    );

    const candidates = Object.entries(jobs).filter(([jobId, job]) => {
      if (!job || job.noContactReminded) return false;
      if (!job.user || !job.timestamp) return false;
      const age = now - job.timestamp;
      if (age < MIN_AGE_MS || age > MAX_AGE_MS) return false;
      return !contactedJobIds.has(jobId);
    });

    if (!candidates.length) {
      console.log("Aucun job sans contact à rappeler aujourd'hui.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [jobId, job] of candidates) {
      const token = tokensMap[job.user];
      if (!token) {
        updates[`jobs/${jobId}/noContactReminded`] = true; // pas de token = inutile de rescanner ce job indéfiniment
        continue;
      }

      const lang = (profilesMap[job.user] && profilesMap[job.user].lang) || "fr";
      const data = buildReminderData(job.title, jobId, lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`jobs/${jobId}/noContactReminded`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`jobs/${jobId}/noContactReminded`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${job.user}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour le job ${jobId} (${code || "inconnue"}):`, res.error && res.error.message);
            // Pas invalide, juste raté : retenté au prochain run tant que l'âge du job reste dans la fenêtre.
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour le job ${jobId}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} rappel(s) "sans contact" envoyé(s) sur ${candidates.length} job(s) éligible(s).`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendNoContactReminders().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
