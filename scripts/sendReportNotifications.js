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
      loadTokensMap(db),
      db.ref("jobs").once("value"),
      db.ref("profiles").once("value")
    ]);

    const reports = reportsSnap.val() || {};
    const adminUids = Object.keys(adminsSnap.val() || {});
    // (20260906j) carte fusionnee : uid -> [jetons de TOUS les appareils]
    const tokensMap = tokensSnap;
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
      .map((uid) => ({ uid, tokens: tokensFor(tokensMap, uid), lang: (profilesMap[uid] && profilesMap[uid].lang) || "fr" }))
      .filter((a) => a.tokens.length > 0);

    if (!adminsWithTokens.length) {
      console.log("Aucun admin avec un token de notification, signalements laissés en attente pour le dashboard.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [reportId, report] of pending) {
      const job = jobs[report.jobId];
      let atLeastOneSent = false;

      for (const { uid, lang } of adminsWithTokens) {
        const s = reportStrings(lang);
        const jobTitle = job ? job.title : s.deletedJob;
        const reasonLabel = s.reasons[report.reason] || report.reason;

        const data = {
          title: s.title,
          body: s.body(reasonLabel, jobTitle),
          jobId: report.jobId ? String(report.jobId) : "",
          type: "new-report"
        };

        // (20260906j) un admin peut avoir plusieurs appareils : on envoie a
        // tous, et sendToUid retire chirurgicalement ceux qui sont morts.
        const outcome = await sendToUid(messaging, db, uid, tokensMap, data);
        if (outcome === "sent") {
          atLeastOneSent = true;
          sentCount += 1;
        } else if (outcome !== "invalid") {
          console.error(`❌ Envoi non abouti pour le signalement ${reportId} a l'admin ${uid} (${outcome}).`);
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
