const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Doit correspondre à databaseURL dans index.html / sw.js
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

// FCM accepte au maximum 500 tokens par appel multicast
const BATCH_SIZE = 500;

// On ne traite que les jobs publiés dans cette fenêtre. Au-delà, on arrête
// de "chercher" ce job pour de nouveaux destinataires (ex: quelqu'un qui
// vient d'activer les notifications) — un job d'il y a une semaine n'a
// plus d'intérêt à être poussé. Ça borne aussi le travail fait à chaque
// run : on ne rescanne pas tout l'historique des jobs indéfiniment.
const JOB_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// Un utilisateur est considéré "actif dans l'app" si sa dernière présence
// connue (écrite par index.html) dit "active" ET date de moins de ce
// délai. Passé ce délai, on considère l'info potentiellement périmée
// (onglet gelé, app tuée sans que onDisconnect ait eu le temps de se
// déclencher, etc.) et on envoie quand même la notification par
// prudence : mieux vaut une notification en trop qu'un job jamais vu.
const PRESENCE_STALE_MS = 3 * 60 * 1000; // 3 min

// Verrou par job (et non plus par job+tentative) : évite que deux
// exécutions qui se chevauchent (cron + déclenchement manuel, par ex.)
// traitent le même job en même temps. Il expire tout seul si une
// exécution plante avant de le libérer, pour ne jamais bloquer un job
// indéfiniment.
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min (le workflow a un timeout de 5 min)

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getAllTokens() {
  const snap = await db.ref("notificationTokens").once("value");
  const data = snap.val() || {};
  // { uid: token }  ->  [{ uid, token }, ...]
  return Object.entries(data)
    .filter(([, token]) => typeof token === "string" && token.length > 0)
    .map(([uid, token]) => ({ uid, token }));
}

async function getPresenceMap() {
  const snap = await db.ref("presence").once("value");
  return snap.val() || {};
}

// true seulement si la personne est là, MAINTENANT, dans l'app.
function isCurrentlyActive(uid, presenceMap) {
  const p = presenceMap[uid];
  if (!p || p.state !== "active") return false;
  const lastChanged = typeof p.lastChanged === "number" ? p.lastChanged : 0;
  return (Date.now() - lastChanged) < PRESENCE_STALE_MS;
}

async function removeInvalidTokens(uids) {
  const updates = {};
  uids.forEach((uid) => {
    updates[`notificationTokens/${uid}`] = null;
  });
  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
}

// Envoie le push aux entrées données, nettoie les tokens invalides au
// passage, renvoie le nombre d'envois réussis.
async function sendToAllTokens(entries, notification, data) {
  if (!entries.length) return 0;

  const invalidUids = [];
  let successCount = 0;

  for (const batch of chunk(entries, BATCH_SIZE)) {
    const tokens = batch.map((e) => e.token);

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification,
      data
    });

    successCount += response.successCount;

    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error && res.error.code;
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          invalidUids.push(batch[idx].uid);
        } else {
          console.error(`❌ Erreur d'envoi (${code || "inconnue"}):`, res.error && res.error.message);
        }
      }
    });
  }

  if (invalidUids.length) {
    await removeInvalidTokens(invalidUids);
    console.log(`🧹 ${invalidUids.length} token(s) invalide(s) supprimé(s).`);
  }

  return successCount;
}

// Réservation atomique du job AVANT traitement : si une autre exécution
// (deux runs qui se chevauchent) l'a déjà réclamé récemment, la
// transaction échoue et on ne le prend pas.
async function acquireLock(jobsRef, jobId) {
  const lockRef = jobsRef.child(jobId).child("_lock");
  const now = Date.now();
  return lockRef.transaction((current) => {
    if (typeof current === "number" && (now - current) < LOCK_TTL_MS) return; // verrouillé récemment -> annule
    return now;
  });
}

async function releaseLock(jobsRef, jobId) {
  await jobsRef.child(jobId).child("_lock").remove().catch(() => {});
}

async function sendNotifications() {
  try {
    const jobsRef = db.ref("jobs");
    const snapshot = await jobsRef.once("value");
    const jobs = snapshot.val();

    if (!jobs) {
      console.log("Aucun job trouvé.");
      return;
    }

    const entries = await getAllTokens();
    console.log(`📱 ${entries.length} token(s) de notification enregistré(s).`);
    if (!entries.length) {
      console.log("Aucun token de notification enregistré, rien à envoyer.");
      return;
    }

    const presenceMap = await getPresenceMap();
    const now = Date.now();

    for (const [jobId, job] of Object.entries(jobs)) {
      const jobTimestamp = job.timestamp || 0;
      if (now - jobTimestamp > JOB_WINDOW_MS) continue; // job trop ancien, on n'en parle plus

      // notifiedTo suit, PAR UTILISATEUR, qui a déjà reçu ce job (push ou
      // vu en direct dans l'app). Un utilisateur qui vient d'activer les
      // notifications recevra donc les jobs récents qu'il n'a pas encore
      // vus, même si d'autres les ont déjà reçus.
      const notifiedTo = job.notifiedTo || {};
      const pendingEntries = entries.filter((e) => !notifiedTo[e.uid]);
      if (!pendingEntries.length) continue; // tout le monde a déjà été notifié ou l'a déjà vu en direct

      const claim = await acquireLock(jobsRef, jobId);
      if (!claim.committed) {
        console.log(`⏭️ Job "${job.title}" déjà pris en charge par une autre exécution, ignoré pour ce run.`);
        continue;
      }

      try {
        // On sépare : ceux actuellement dans l'app (pas de push, ils
        // voient le job en direct) et les autres (push classique).
        const toPush = [];
        const toMarkSeen = [];
        pendingEntries.forEach((entry) => {
          if (isCurrentlyActive(entry.uid, presenceMap)) {
            toMarkSeen.push(entry);
          } else {
            toPush.push(entry);
          }
        });

        const notification = {
          title: "Nouveau poste disponible",
          body: `${job.title} (${job.typeContrat || "Contrat"}) à ${job.location || "Non spécifié"}`
        };
        const data = {
          jobId: String(jobId),
          category: String(job.category || "General"),
          location: String(job.location || "Global"),
          salaire: String(job.salaire || "N/A")
        };

        let successCount = 0;
        try {
          successCount = await sendToAllTokens(toPush, notification, data);
        } catch (err) {
          // Échec d'envoi : on ne marque PERSONNE comme notifié pour ce
          // job. Tout le monde (push + "vus en direct") sera réévalué au
          // prochain run — un utilisateur actif entre-temps ne recevra
          // simplement pas de push, ce qui reste correct.
          console.error(`❌ Erreur envoi notification pour "${job.title}", nouvelle tentative au prochain run:`, err);
          continue; // le "finally" ci-dessous libère quand même le verrou
        }

        const updates = {};
        [...toPush, ...toMarkSeen].forEach((e) => {
          updates[`jobs/${jobId}/notifiedTo/${e.uid}`] = true;
        });
        if (Object.keys(updates).length) await db.ref().update(updates);

        console.log(
          `✅ Job "${job.title}" : ${successCount}/${toPush.length} notification(s) push envoyée(s), ` +
          `${toMarkSeen.length} utilisateur(s) déjà actif(s) dans l'app (pas de push).`
        );
      } finally {
        await releaseLock(jobsRef, jobId);
      }
    }
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

// admin.database() garde une connexion websocket ouverte en permanence : sans
// fermeture explicite, le processus Node ne se termine jamais tout seul (d'où
// les runs GitHub Actions bloqués "In progress" pendant des heures). On ne
// force PAS process.exit() immédiatement après : sur un flux stdout redirigé
// (comme dans GitHub Actions), console.log() écrit de façon asynchrone, et un
// exit() trop rapide peut couper la toute dernière ligne de log avant qu'elle
// finisse de s'écrire. On laisse donc le processus se terminer naturellement
// une fois la connexion Firebase fermée, avec un filet de sécurité différé.
sendNotifications().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
