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
      loadTokensMap(db),
      db.ref("profiles").once("value")
    ]);

    const jobs = jobsSnap.val() || {};
    const contacts = contactsSnap.val() || {};
    const tokensMap = tokensSnap;
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
      const token = tokensFor(tokensMap, job.user);
      if (!token.length) {
        updates[`jobs/${jobId}/noContactReminded`] = true; // pas de token = inutile de rescanner ce job indéfiniment
        continue;
      }

      const lang = (profilesMap[job.user] && profilesMap[job.user].lang) || "fr";
      const data = buildReminderData(job.title, jobId, lang);

      try {
        // (20260906j) envoi multi-appareils + nettoyage chirurgical
        const outcome = await sendToUid(messaging, db, job.user, tokensMap, data);
        if (outcome === "sent") {
          sentCount++;
          updates[`jobs/${jobId}/noContactReminded`] = true;
        } else {
          // (20260906j) sendToUid a deja retire les appareils morts (apres
          // relecture). Plus aucune suppression aveugle du compte ici.
          if (outcome === "invalid") {
            updates[`jobs/${jobId}/noContactReminded`] = true; // tous les appareils sont morts
          } else {
            console.error(`❌ Envoi non abouti pour le job ${jobId} (${outcome}).`);
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
