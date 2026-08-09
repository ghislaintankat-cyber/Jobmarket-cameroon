// ===== JobMarket Cameroon : notifier les admins d'un nouveau signalement =====
//
// Rôle : dès qu'un signalement est déposé (voir submitReport() dans
// index.html), prévenir tous les admins par push (voir admins/{uid} dans
// Firebase — même logique que scripts/sendContactNotifications.js et
// scripts/sendReviewNotifications.js pour le reste).
//
// Déclenché instantanément via le relais Cloudflare Worker (event_type
// "new-report"), avec un cron de secours en filet de sécurité.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// Liste dynamique, plus un UID unique codé en dur : voir admins/{uid} dans
// Firebase (et database.rules.json). Permet d'ajouter un admin de secours
// sans toucher au code, et de notifier tout le monde en cas de
// signalement plutôt qu'une seule personne qui pourrait être injoignable.

// Comme pour les contacts/avis : au-delà de cette fenêtre, on n'insiste
// plus pour ce signalement précis à ce run (il reste visible de toute
// façon dans le dashboard admin, cette notif est juste le "coup de fil").
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// Les admins peuvent avoir des langues différentes entre eux (voir
// profiles/{uid}/lang) — contrairement aux autres notifs à destinataire
// unique, celle-ci doit donc être personnalisée PAR ADMIN, pas envoyée en
// une seule fois avec un texte figé pour tout le monde.
const REPORT_I18N = {
  fr: {
    title: "🚩 Nouveau signalement",
    body: (reasonLabel, jobTitle) => `${reasonLabel} — "${jobTitle}"`,
    deletedJob: "une annonce supprimée",
    reasons: {
      fraud: "Arnaque / fraude suspectée",
      inappropriate: "Contenu inapproprié",
      misleading: "Prix ou description trompeurs",
      duplicate: "Annonce en double / spam",
      other: "Autre"
    }
  },
  en: {
    title: "🚩 New report",
    body: (reasonLabel, jobTitle) => `${reasonLabel} — "${jobTitle}"`,
    deletedJob: "a deleted listing",
    reasons: {
      fraud: "Suspected scam / fraud",
      inappropriate: "Inappropriate content",
      misleading: "Misleading price or description",
      duplicate: "Duplicate listing / spam",
      other: "Other"
    }
  },
  it: {
    title: "🚩 Nuova segnalazione",
    body: (reasonLabel, jobTitle) => `${reasonLabel} — "${jobTitle}"`,
    deletedJob: "un annuncio eliminato",
    reasons: {
      fraud: "Sospetta truffa / frode",
      inappropriate: "Contenuto inappropriato",
      misleading: "Prezzo o descrizione ingannevoli",
      duplicate: "Annuncio duplicato / spam",
      other: "Altro"
    }
  },
  de: {
    title: "🚩 Neue Meldung",
    body: (reasonLabel, jobTitle) => `${reasonLabel} — "${jobTitle}"`,
    deletedJob: "eine gelöschte Anzeige",
    reasons: {
      fraud: "Vermuteter Betrug",
      inappropriate: "Unangemessener Inhalt",
      misleading: "Irreführender Preis oder Beschreibung",
      duplicate: "Doppelte Anzeige / Spam",
      other: "Sonstiges"
    }
  },
  zh: {
    title: "🚩 新举报",
    body: (reasonLabel, jobTitle) => `${reasonLabel} — "${jobTitle}"`,
    deletedJob: "已删除的信息",
    reasons: {
      fraud: "疑似诈骗/欺诈",
      inappropriate: "不当内容",
      misleading: "价格或描述具有误导性",
      duplicate: "重复信息/垃圾信息",
      other: "其他"
    }
  }
};

function reportStrings(lang) {
  return REPORT_I18N[lang] || REPORT_I18N.fr;
}

async function sendReportNotifications() {
  try {
    const now = Date.now();

    const [reportsSnap, adminsSnap, tokensSnap, jobsSnap, profilesSnap] = await Promise.all([
      db.ref("reports").orderByChild("status").equalTo("pending").once("value"),
      db.ref("admins").once("value"),
      db.ref("notificationTokens").once("value"),
      db.ref("jobs").once("value"),
      db.ref("profiles").once("value")
    ]);

    const reports = reportsSnap.val() || {};
    const adminUids = Object.keys(adminsSnap.val() || {});
    const tokensMap = tokensSnap.val() || {};
    const jobs = jobsSnap.val() || {};
    const profilesMap = profilesSnap.val() || {};

    const pending = Object.entries(reports).filter(([, r]) => {
      if (!r || r.notifiedAdmin) return false;
      if (!r.timestamp) return false;
      return (now - r.timestamp) <= REPORT_WINDOW_MS;
    });

    if (!pending.length) {
      console.log("Aucun nouveau signalement à notifier.");
      return;
    }

    if (!adminUids.length) {
      console.log("Aucun admin dans admins/, rien à notifier. Avez-vous bootstrappé le nœud admins/ dans Firebase ?");
      return;
    }

    // Un admin par token valide, avec sa langue propre — contrairement à
    // sendEachForMulticast (un seul texte pour tout le monde), on envoie
    // ici un message individuel par admin pour pouvoir personnaliser.
    const adminsWithTokens = adminUids
      .map((uid) => ({ uid, token: tokensMap[uid], lang: (profilesMap[uid] && profilesMap[uid].lang) || "fr" }))
      .filter((a) => typeof a.token === "string" && a.token.length > 0);

    if (!adminsWithTokens.length) {
      console.log("Aucun admin avec un token de notification, signalements laissés en attente pour le dashboard.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [reportId, report] of pending) {
      const job = jobs[report.jobId];
      let atLeastOneSent = false;

      for (const { uid, token, lang } of adminsWithTokens) {
        const s = reportStrings(lang);
        const jobTitle = job ? job.title : s.deletedJob;
        const reasonLabel = s.reasons[report.reason] || report.reason;

        const data = {
          title: s.title,
          body: s.body(reasonLabel, jobTitle),
          jobId: report.jobId ? String(report.jobId) : "",
          type: "new-report"
        };

        try {
          await messaging.send({
            token,
            data,
            webpush: { headers: { Urgency: "high" } }
          });
          atLeastOneSent = true;
          sentCount += 1;
        } catch (err) {
          const code = err && err.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`notificationTokens/${uid}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour le signalement ${reportId} à l'admin ${uid} (${code || "inconnue"}):`, err && err.message);
          }
        }
      }

      if (atLeastOneSent) {
        updates[`reports/${reportId}/notifiedAdmin`] = true; // au moins un admin a été prévenu, ça suffit pour ne pas rescanner ce signalement
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} notification(s) de signalement envoyée(s) sur ${pending.length} signalement(s) en attente.`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendReportNotifications().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
