// ===== Notifications MESSAGES in-app (JobMarket Cameroon) =====
//
// Rôle : envoyer une notification push quand un utilisateur reçoit un
// MESSAGE in-app (nœud "chats/{threadId}/messages").
//
// NOTE : le système de "devis" a été retiré (il faisait doublon avec la
// messagerie). Ce script ne gère donc plus que les messages. Le nom de
// fichier est conservé pour ne pas casser le workflow qui l'appelle.
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

// ============================ MIGRATION "UNE CONVERSATION PAR PERSONNE" ============================
// Avant la version actuelle, le threadId contenait le job :
//   "uidA_uidB__jobId"
// Conséquence : recontacter la même personne pour UN AUTRE JOB créait une
// NOUVELLE conversation au lieu de continuer la discussion.
// Nouveau format : "uidA_uidB" (une conversation unique par personne, comme
// WhatsApp). Cette fonction migre automatiquement les anciens threads :
//   1. copie leurs messages dans le nouveau thread du duo (sans doublon) ;
//   2. fusionne le meta (participants, names, job contextuel, dernier message) ;
//   3. met à jour les inboxs des deux participants (entrée unique, non-lus
//      additionnés, anciennes entrées supprimées) ;
//   4. met à jour l'index userThreads ;
//   5. supprime l'ancien thread.
// IDEMPOTENTE : un thread déjà migré n'existe plus au format ancien, il ne
// sera donc jamais traité deux fois. Sans coût tant qu'il n'y a plus
// d'anciens threads (un simple scan des clés).
async function migrateLegacyThreads() {
  const chatsSnap = await db.ref("chats").once("value");
  const chats = chatsSnap.val() || {};
  let migrated = 0;

  for (const threadId of Object.keys(chats)) {
    if (!threadId.includes("__")) continue; // déjà au format nouveau
    const thread = chats[threadId];
    if (!thread || typeof thread !== "object") continue;
    const pairId = threadId.split("__")[0];
    if (!pairId) continue;
    const meta = thread.meta && typeof thread.meta === "object" ? thread.meta : {};
    const messages = thread.messages && typeof thread.messages === "object" ? thread.messages : {};

    // Participants de ce thread (meta + expéditaires/destinataires des messages)
    const participants = new Set(Object.keys(meta.participants || {}));
    Object.values(messages).forEach((m) => {
      if (m && m.from) participants.add(m.from);
      if (m && m.to) participants.add(m.to);
    });
    if (participants.size < 2) continue;

    // Dernier message de l'ancien thread
    let latest = null;
    Object.values(messages).forEach((m) => {
      if (m && m.timestamp && (!latest || m.timestamp > latest.timestamp)) latest = m;
    });

    const targetMeta = (await db.ref(`chats/${pairId}/meta`).once("value")).val();
    const targetMetaObj = targetMeta && typeof targetMeta === "object" ? targetMeta : {};
    const targetMsgs = (await db.ref(`chats/${pairId}/messages`).once("value")).val();
    const targetMsgsObj = targetMsgs && typeof targetMsgs === "object" ? targetMsgs : {};

    const updates = {};

    // 1) Copie des messages absents du nouveau thread (le _notified et le
    //    readBy voyagent avec le message : pas de re-notification, pas de
    //    ré-ouverture des non-lus)
    for (const [msgId, m] of Object.entries(messages)) {
      if (m && !targetMsgsObj[msgId]) updates[`chats/${pairId}/messages/${msgId}`] = m;
    }

    // 2) Fusion du meta : participants/names si le nouveau thread est vide,
    //    job contextuel s'il n'en a pas encore
    if (!Object.keys(targetMetaObj.participants || {}).length) {
      for (const p of participants) {
        updates[`chats/${pairId}/meta/participants/${p}`] = true;
        if (meta.names && meta.names[p]) updates[`chats/${pairId}/meta/names/${p}`] = meta.names[p];
      }
    }
    if (!targetMetaObj.jobId && meta.jobId) updates[`chats/${pairId}/meta/jobId`] = meta.jobId;
    if (!targetMetaObj.jobTitle && meta.jobTitle) updates[`chats/${pairId}/meta/jobTitle`] = meta.jobTitle;

    // 3) Aperçu du nouveau thread : seulement si l'ancien est PLUS RÉCENT
    if (latest && (!targetMetaObj.lastAt || latest.timestamp > targetMetaObj.lastAt)) {
      updates[`chats/${pairId}/meta/lastMessage`] = latest.imageUrl ? "📷 Photo" : (latest.text || "").slice(0, 100);
      updates[`chats/${pairId}/meta/lastAt`] = latest.timestamp;
      updates[`chats/${pairId}/meta/lastFrom`] = latest.from;
    }

    // 4) Inboxs + index des deux participants
    const inboxes = (await db.ref("userInboxes").once("value")).val() || {};
    for (const p of participants) {
      const peerOf = [...participants].find((x) => x !== p);
      const oldEntry = inboxes[p] && inboxes[p].threads && inboxes[p].threads[threadId];
      const newEntry = inboxes[p] && inboxes[p].threads && inboxes[p].threads[pairId];
      const oldUnread = (oldEntry && oldEntry.unread) || 0;

      // ancienne entrée supprimée, conversation unique sur le pairId
      updates[`userInboxes/${p}/threads/${threadId}`] = null;
      if (latest && (!newEntry || !newEntry.lastAt || latest.timestamp > newEntry.lastAt)) {
        updates[`userInboxes/${p}/threads/${pairId}`] = {
          peerUid: peerOf,
          peerName: (meta.names && meta.names[peerOf]) || "Utilisateur",
          jobId: meta.jobId || "general",
          jobTitle: meta.jobTitle || null,
          lastMessage: latest.imageUrl ? "📷 Photo" : (latest.text || "").slice(0, 100),
          lastAt: latest.timestamp,
          lastFrom: latest.from,
          // non-lus : les non-lus de l'ancienne entrée s'ajoutent (les
          // ensembles de messages sont disjoints) ; si une entrée récente
          // existe déjà et est plus récente que l'ancien, on la garde telle
          // quelle (son compteur fait foi)
          unread: newEntry && newEntry.lastAt && newEntry.lastAt >= latest.timestamp
            ? newEntry.unread || 0
            : ((newEntry && newEntry.unread) || 0) + oldUnread
        };
      }

      const threadsIdx = (await db.ref(`userThreads/${p}`).once("value")).val();
      if (threadsIdx && threadsIdx[threadId]) {
        updates[`userThreads/${p}/${threadId}`] = null;
        updates[`userThreads/${p}/${pairId}`] = true;
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);

    // 5) Suppression de l'ancien thread (messages déjà copiés à l'étape 1)
    await db.ref(`chats/${threadId}`).remove();
    migrated++;
  }
  return migrated;
}

// ============================ RÉPARATION DES INBOXES ============================
// Filet de sécurité côté SERVEUR : c'est normalement le client (app.js) qui
// écrit l'entrée "conversation" de chaque utilisateur
// (userInboxes/{uid}/threads/{threadId}) à l'envoi d'un message. Mais un
// appareil qui tourne sur une VIEILLE version (cache PWA) envoie bien le
// message dans "chats" SANS écrire l'entrée -> la liste "Messages" du
// destinataire reste vide alors que les messages existent.
//
// Cette fonction scanne tous les threads et, pour chaque participant d'un
// échange récent, recrée / met à jour l'entrée manquante (nom, dernier
// message, heure, job) et incrémente le compteur "unread".
//
// Idempotence (rejouable à l'infini sans double-compte) :
//   - le compteur unread n'incrémente que si le message est PLUS RÉCENT que
//     entry.lastAt (l'entrée reflète déjà les messages >= lastAt) ;
//   - un client de version récente a déjà écrit l'entrée (entry.lastAt >=
//     timestamp du message) -> rien n'est recompté ;
//   - un message déjà lu (readBy) n'est jamais compté.
async function repairInboxes(ctx) {
  const { profilesMap, now } = ctx;
  const [chatsSnap, jobsSnap, inboxesSnap] = await Promise.all([
    db.ref("chats").once("value"),
    db.ref("jobs").once("value"),
    db.ref("userInboxes").once("value")
  ]);
  const chats = chatsSnap.val() || {};
  const jobs = jobsSnap.val() || {};
  const inboxes = inboxesSnap.val() || {};
  const updates = {};
  let fixed = 0;

  for (const [threadId, thread] of Object.entries(chats)) {
    if (!thread || typeof thread !== "object" || !thread.messages) continue;
    const meta = thread.meta && typeof thread.meta === "object" ? thread.meta : {};
    const names = meta.names && typeof meta.names === "object" ? meta.names : {};
    const jobId = meta.jobId || "general";
    const jobTitle = meta.jobTitle || (jobId !== "general" && jobs[jobId] && jobs[jobId].title) || null;

    // Participants : la liste du meta + tous les expéditaires/destinataires
    // des messages récents (couvre les threads dont le meta est abîmé).
    const participants = new Set();
    if (meta.participants && typeof meta.participants === "object") {
      Object.keys(meta.participants).forEach((u) => participants.add(u));
    }
    for (const m of Object.values(thread.messages)) {
      if (!m || typeof m !== "object") continue;
      if (now - (m.timestamp || 0) > WINDOW_MS) continue;
      if (m.from) participants.add(m.from);
      if (m.to) participants.add(m.to);
    }
    if (participants.size < 2) continue;

    // Message le plus récent du thread (pour l'aperçu de l'entrée)
    let latest = null;
    for (const m of Object.values(thread.messages)) {
      if (!m || typeof m !== "object" || !m.timestamp) continue;
      if (!latest || m.timestamp > latest.timestamp) latest = m;
    }
    if (!latest) continue;

    for (const uid of participants) {
      const peerUid = [...participants].find((u) => u !== uid);
      if (!peerUid) continue;
      const peerName =
        names[peerUid] || (profilesMap[peerUid] && profilesMap[peerUid].name) || "Utilisateur";

      const entry =
        inboxes[uid] && inboxes[uid].threads && inboxes[uid].threads[threadId]
          ? inboxes[uid].threads[threadId]
          : null;
      const entryLastAt = (entry && entry.lastAt) || 0;

      const patch = {};
      // 1) Entrée manquante ou aperçu plus ancien que le dernier message
      if (latest.timestamp > entryLastAt) {
        patch.peerUid = peerUid;
        patch.peerName = peerName;
        patch.jobId = jobId;
        if (jobTitle) patch.jobTitle = jobTitle;
        patch.lastMessage = latest.imageUrl ? "📷 Photo" : (latest.text || "").slice(0, 100);
        patch.lastAt = latest.timestamp;
        patch.lastFrom = latest.from;
      }
      // 2) Messages non-lus de l'autre -> compteur unread (+1 chacun)
      let unread = (entry && entry.unread) || 0;
      for (const m of Object.values(thread.messages)) {
        if (!m || typeof m !== "object") continue;
        if (now - (m.timestamp || 0) > WINDOW_MS) continue;
        if (!m.to || m.to !== uid) continue;
        if (!m.from || m.from === uid) continue;
        if (m.readBy && m.readBy[uid]) continue; // déjà lu
        if ((m.timestamp || 0) > entryLastAt) unread++; // pas encore compté
      }
      if (unread !== (entry && entry.unread) || Object.keys(patch).length) {
        patch.unread = unread;
      }

      if (Object.keys(patch).length) {
        updates[`userInboxes/${uid}/threads/${threadId}`] = patch;
        fixed++;
      }
    }
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
  return fixed;
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

    const ctx = { tokensMap, profilesMap, presenceMap, notifyPrefsMap, adminUids, now: Date.now() };

    // 0) Migration "une conversation par personne" (idempotente : ne coûte
    //    qu'un scan de clés quand il n'y a plus d'anciens threads)
    const legacyMigrated = await migrateLegacyThreads();
    if (legacyMigrated > 0) console.log(`🔀 ${legacyMigrated} ancien(s) thread(s) migré(s) vers une conversation unique par personne.`);

    // 1) Réparation des inboxs : toujours exécutée (même sans aucun token),
    //    c'est le filet de sécurité de la liste "Messages".
    const inboxesFixed = await repairInboxes(ctx);
    console.log(`🔧 ${inboxesFixed} entrée(s) d'inbox créée(s)/réparée(s).`);

    console.log(`📱 ${tokensMap.size} token(s) enregistré(s), ${adminUids.length} admin(s).`);
    if (tokensMap.size === 0) {
      console.log("Aucun token de notification, rien à envoyer (inbox réparée quand même).");
      return;
    }

    // 2) Notifications push des messages
    const msgSent = await processMessages(ctx);

    console.log(`✅ ${msgSent} notif(s) message envoyée(s).`);
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
