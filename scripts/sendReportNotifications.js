// ===== JobMarket Cameroon : notifier l'admin d'un nouveau signalement =====
//
// Rôle : dès qu'un signalement est déposé (voir submitReport() dans
// index.html), prévenir l'admin par push. Un seul destinataire connu à
// l'avance (ADMIN_UID) — même logique que
// scripts/sendContactNotifications.js et scripts/sendReviewNotifications.js.
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

const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// Comme pour les contacts/avis : au-delà de cette fenêtre, on n'insiste
// plus pour ce signalement précis à ce run (il reste visible de toute
// façon dans le dashboard admin, cette notif est juste le "coup de fil").
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const REASON_LABELS_FR = {
  fraud: "Arnaque / fraude suspectée",
  inappropriate: "Contenu inapproprié",
  misleading: "Prix ou description trompeurs",
  duplicate: "Annonce en double / spam",
  other: "Autre"
};

async function sendReportNotifications() {
  try {
    const now = Date.now();

    const [reportsSnap, tokenSnap, jobsSnap] = await Promise.all([
      db.ref("reports").orderByChild("status").equalTo("pending").once("value"),
      db.ref(`notificationTokens/${ADMIN_UID}`).once("value"),
      db.ref("jobs").once("value")
    ]);

    const reports = reportsSnap.val() || {};
    const token = tokenSnap.val();
    const jobs = jobsSnap.val() || {};

    const pending = Object.entries(reports).filter(([, r]) => {
      if (!r || r.notifiedAdmin) return false;
      if (!r.timestamp) return false;
      return (now - r.timestamp) <= REPORT_WINDOW_MS;
    });

    if (!pending.length) {
      console.log("Aucun nouveau signalement à notifier.");
      return;
    }

    if (!token) {
      console.log("Admin sans token de notification, signalements laissés en attente pour le dashboard.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [reportId, report] of pending) {
      const job = jobs[report.jobId];
      const jobTitle = job ? job.title : "une annonce supprimée";
      const reasonLabel = REASON_LABELS_FR[report.reason] || report.reason;

      const data = {
        title: "🚩 Nouveau signalement",
        body: `${reasonLabel} — "${jobTitle}"`,
        jobId: report.jobId ? String(report.jobId) : "",
        type: "new-report"
      };

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`reports/${reportId}/notifiedAdmin`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`reports/${reportId}/notifiedAdmin`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${ADMIN_UID}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour le signalement ${reportId} (${code || "inconnue"}):`, res.error && res.error.message);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour le signalement ${reportId}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} notification(s) de signalement envoyée(s) sur ${pending.length} en attente.`);
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
