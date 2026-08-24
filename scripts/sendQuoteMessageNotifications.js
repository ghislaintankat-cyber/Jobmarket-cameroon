// ===== Notifications DEVIS + MESSAGES in-app (JobMarket Cameroon) =====
//
// Rôle : envoyer une notification push quand :
//   - un artisan reçoit une DEMANDE DE DEVIS  (nœud Firebase "quotes")
//   - un utilisateur reçoit un MESSAGE in-app  (nœud "chats/{threadId}/messages")
//
// Ce script est SÉPARÉ de scripts/sendNotifications.js (qui, lui, ne gère
// QUE les nouveaux jobs). On ne touche donc pas au système jobs qui marche
// déjà — zéro risque de régression sur les notifs de jobs.
//
// Déclenché par le workflow .github/workflows/quote-message-notify.yml, lui-
// même appelé instantanément par le worker Cloudflare jobmarket-notify-trigger
// via repository_dispatch (event_type "new-quote" / "new-message"), avec un
// cron de secours toutes les 15 min.
//
// Destinataires (choix de l'utilisateur : "les deux") :
//   1. L'artisan / le destinataire concerné (jobOwnerUid pour un devis,
//      champ "to" pour un message).
//   2. TOUS les admins (nœud "admins") — pour que le gérant suive l'activité.
//
// Anti-doublon : chaque devis / message reçoit un marqueur "_notified/{uid}=true"
// une fois la notif envoyée à ce uid, exactement comme "notifiedTo" pour les
// jobs. On ne rescanne donc jamais deux fois le même élément pour le même uid.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// On ne traite que les devis / messages récents. Un devis d'il y a 24h qui
// n'a jamais été notifié (relais + cron tous deux en panne) n'a plus
// d'intérêt à être poussé, et ça borne le travail par run.
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// Un utilisateur "actif dans l'app" (présence "active" récente) voit déjà
// le devis / message en direct : inutile de lui pousser une notif système.
const PRESENCE_STALE_MS = 3 * 60 * 1000; // 3 min

// -------- Helpers Firebase (mêmes conventions que sendNotifications.js) --------

async function getAllTokensMap() {
  const snap = await db.ref("notificationTokens").once("value");
  const data = snap.val() || {};
  const map = new Map();
  Object.entries(data).forEach(([uid, token]) => {
    if (typeof token === "string" && token.length > 0) map.set(uid, token);
  });
  return map;
}

async function getProfilesMap() {
  const snap = await db.ref("profiles").once("value");
  return snap.val() || {};
}

async function getPresenceMap() {
  const snap = await db.ref("presence").once("value");
  return snap.val() || {};
}

async function getNotifyPrefs() {
  const snap = await db.ref("notifyPrefs").once("value");
  return snap.val() || {};
}

async function getAdminUids() {
  const snap = await db.ref("admins").once("value");
  const data = snap.val() || {};
  // { uid: true } -> [uid, ...] (on ne garde que les admins à true)
  return Object.entries(data).filter(([, v]) => v === true).map(([uid]) => uid);
}

function isCurrentlyActive(uid, presenceMap) {
  const p = presenceMap[uid];
  if (!p || p.state !== "active") return false;
  const lastChanged = typeof p.lastChanged === "number" ? p.lastChanged : 0;
  return (Date.now() - lastChanged) < PRESENCE_STALE_MS;
}

// Respecte les préférences de notification par catégorie (mêmes clés que le
// client). Absence de préférence = activé par défaut. Catégories utilisées
// ici : "quotes" et "messages".
function wantsCategory(uid, category, notifyPrefsMap) {
  const prefs = notifyPrefsMap[uid];
  if (!prefs) return true;
  return prefs[category] !== false;
}

async function removeInvalidToken(uid) {
  await db.ref(`notificationTokens/${uid}`).remove().catch(() => {});
}

// -------- Traductions minimales (miroir de sendNotifications.js) --------
// On ne traduit que ce qui part réellement dans la notif push.
const NOTIF_I18N = {
  fr: {
    quoteTitle: "💬 Nouvelle demande de devis",
    quoteBody: (jobTitle, budget) =>
      `Un client demande un devis pour "${jobTitle || "ton annonce"}"` + (budget ? ` (budget : ${budget})` : ""),
    quoteAdminTitle: "📊 Nouveau devis sur JobMarket",
    quoteAdminBody: (jobTitle) => `Une demande de devis vient d'arriver (${jobTitle || "annonce"}).`,
    msgTitle: "✉️ Nouveau message",
    msgBody: (from, text) => (from ? `${from} : ` : "") + (text || "Tu as reçu un message"),
    msgAdminTitle: "📊 Nouveau message sur JobMarket",
    msgAdminBody: () => "Un échange in-app vient d'avoir lieu entre deux utilisateurs."
  },
  en: {
    quoteTitle: "💬 New quote request",
    quoteBody: (jobTitle, budget) =>
      `A client is requesting a quote for "${jobTitle || "your listing"}"` + (budget ? ` (budget: ${budget})` : ""),
    quoteAdminTitle: "📊 New quote on JobMarket",
    quoteAdminBody: (jobTitle) => `A quote request just came in (${jobTitle || "listing"}).`,
    msgTitle: "✉️ New message",
    msgBody: (from, text) => (from ? `${from}: ` : "") + (text || "You received a message"),
    msgAdminTitle: "📊 New message on JobMarket",
    msgAdminBody: () => "An in-app chat just happened between two users."
  }
};
function notifStrings(lang) {
  return NOTIF_I18N[lang] || NOTIF_I18N.fr;
}

// -------- Envoi d'une notif à un uid donné --------
// Retourne "sent" | "skipped" | "no-token" | "invalid" | "error".
async function pushToUid(uid, tokensMap, data) {
  const token = tokensMap.get(uid);
  if (!token) return "no-token";
  try {
    const response = await messaging.sendEachForMulticast({
      tokens: [token],
      data,
      webpush: { headers: { Urgency: "high" } }
    });
    const res = response.responses[0];
    if (res.success) return "sent";
    const code = res.error && res.error.code;
    if (
      code === "messaging/invalid-registration-token" ||
      code === "messaging/registration-token-not-registered"
    ) {
      await removeInvalidToken(uid);
      return "invalid";
    }
    console.error(`❌ Erreur d'envoi à ${uid} (${code || "inconnue"}):`, res.error && res.error.message);
    return "error";
  } catch (err) {
    console.error(`❌ Exception envoi à ${uid}:`, err);
    return "error";
  }
}

// Marque un élément comme notifié pour un uid (anti-doublon), sauf en cas de
// "no-token"/"error" transitoire -> on retentera au prochain run. On marque
// pour "sent" ET "invalid" (token mort : inutile de rescanner) ET "skipped"
// (déjà vu en direct / catégorie coupée : rien de plus à faire).
function shouldMark(result) {
  return result === "sent" || result === "invalid" || result === "skipped";
}

// ============================ DEVIS ============================
async function processQuotes(ctx) {
  const { tokensMap, profilesMap, presenceMap, notifyPrefsMap, adminUids, now } = ctx;
  const snap = await db.ref("quotes").once("value");
  const quotes = snap.val() || {};
  const updates = {};
  let sent = 0;

  // Cache titres de jobs (évite de relire le même job plusieurs fois)
  const jobTitleCache = new Map();
  async function jobTitle(jobId) {
    if (!jobId) return "";
    if (jobTitleCache.has(jobId)) return jobTitleCache.get(jobId);
    const js = await db.ref(`jobs/${jobId}/title`).once("value");
    const title = js.val() || "";
    jobTitleCache.set(jobId, title);
    return title;
  }

  for (const [quoteId, q] of Object.entries(quotes)) {
    if (!q || typeof q !== "object") continue;
    const ts = q.timestamp || 0;
    if (now - ts > WINDOW_MS) continue; // trop ancien

    const notified = q._notified || {};
    const title = await jobTitle(q.jobId);

    // ---- Destinataire principal : l'artisan propriétaire de l'annonce ----
    const ownerUid = q.jobOwnerUid;
    if (ownerUid && !notified[ownerUid]) {
      let result;
      if (isCurrentlyActive(ownerUid, presenceMap) || !wantsCategory(ownerUid, "quotes", notifyPrefsMap)) {
        result = "skipped"; // vu en direct, ou notifs devis coupées
      } else {
        const lang = (profilesMap[ownerUid] && profilesMap[ownerUid].lang) || "fr";
        const s = notifStrings(lang);
        result = await pushToUid(ownerUid, tokensMap, {
          type: "quote",
          title: s.quoteTitle,
          body: s.quoteBody(title, q.budget),
          jobId: String(q.jobId || ""),
          quoteId: String(quoteId),
          lang
        });
      }
      if (result === "sent") sent++;
      if (shouldMark(result)) updates[`quotes/${quoteId}/_notified/${ownerUid}`] = true;
    }

    // ---- Admins (toi) ----
    for (const adminUid of adminUids) {
      if (adminUid === ownerUid) continue; // déjà notifié comme destinataire
      if (notified[adminUid]) continue;
      let result;
      if (isCurrentlyActive(adminUid, presenceMap)) {
        result = "skipped";
      } else {
        const lang = (profilesMap[adminUid] && profilesMap[adminUid].lang) || "fr";
        const s = notifStrings(lang);
        result = await pushToUid(adminUid, tokensMap, {
          type: "quote-admin",
          title: s.quoteAdminTitle,
          body: s.quoteAdminBody(title),
          jobId: String(q.jobId || ""),
          quoteId: String(quoteId),
          lang
        });
      }
      if (result === "sent") sent++;
      if (shouldMark(result)) updates[`quotes/${quoteId}/_notified/${adminUid}`] = true;
    }
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
  return sent;
}

// ============================ MESSAGES ============================
async function processMessages(ctx) {
  const { tokensMap, profilesMap, presenceMap, notifyPrefsMap, adminUids, now } = ctx;
  const snap = await db.ref("chats").once("value");
  const chats = snap.val() || {};
  const updates = {};
  let sent = 0;

  for (const [threadId, thread] of Object.entries(chats)) {
    if (!thread || typeof thread !== "object" || !thread.messages) continue;
    for (const [msgId, m] of Object.entries(thread.messages)) {
      if (!m || typeof m !== "object") continue;
      const ts = m.timestamp || 0;
      if (now - ts > WINDOW_MS) continue; // trop ancien

      const toUid = m.to;
      const fromUid = m.from;
      const notified = m._notified || {};

      // Nom de l'expéditeur (pour le corps de la notif)
      const fromName = (profilesMap[fromUid] && profilesMap[fromUid].name) || "";

      // ---- Destinataire du message ----
      if (toUid && !notified[toUid]) {
        let result;
        if (isCurrentlyActive(toUid, presenceMap) || !wantsCategory(toUid, "messages", notifyPrefsMap)) {
          result = "skipped";
        } else {
          const lang = (profilesMap[toUid] && profilesMap[toUid].lang) || "fr";
          const s = notifStrings(lang);
          result = await pushToUid(toUid, tokensMap, {
            type: "message",
            title: s.msgTitle,
            body: s.msgBody(fromName, m.text),
            threadId: String(threadId),
            lang
          });
        }
        if (result === "sent") sent++;
        if (shouldMark(result)) updates[`chats/${threadId}/messages/${msgId}/_notified/${toUid}`] = true;
      }

      // ---- Admins (toi) ----
      for (const adminUid of adminUids) {
        if (adminUid === toUid || adminUid === fromUid) continue; // pas de notif admin si tu es dans la conversation
        if (notified[adminUid]) continue;
        let result;
        if (isCurrentlyActive(adminUid, presenceMap)) {
          result = "skipped";
        } else {
          const lang = (profilesMap[adminUid] && profilesMap[adminUid].lang) || "fr";
          const s = notifStrings(lang);
          result = await pushToUid(adminUid, tokensMap, {
            type: "message-admin",
            title: s.msgAdminTitle,
            body: s.msgAdminBody(),
            threadId: String(threadId),
            lang
          });
        }
        if (result === "sent") sent++;
        if (shouldMark(result)) updates[`chats/${threadId}/messages/${msgId}/_notified/${adminUid}`] = true;
      }
    }
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
  return sent;
}

// ============================ MAIN ============================
async function run() {
  try {
    const [tokensMap, profilesMap, presenceMap, notifyPrefsMap, adminUids] = await Promise.all([
      getAllTokensMap(),
      getProfilesMap(),
      getPresenceMap(),
      getNotifyPrefs(),
      getAdminUids()
    ]);

    console.log(`📱 ${tokensMap.size} token(s) enregistré(s), ${adminUids.length} admin(s).`);
    if (tokensMap.size === 0) {
      console.log("Aucun token de notification, rien à envoyer.");
      return;
    }

    const ctx = { tokensMap, profilesMap, presenceMap, notifyPrefsMap, adminUids, now: Date.now() };

    const quoteSent = await processQuotes(ctx);
    const msgSent = await processMessages(ctx);

    console.log(`✅ ${quoteSent} notif(s) devis + ${msgSent} notif(s) message envoyée(s).`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

// Fermeture propre de la connexion Firebase (sinon le run GitHub Actions
// resterait bloqué "In progress"), avec filet de sécurité différé — même
// logique que scripts/sendNotifications.js.
run().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
