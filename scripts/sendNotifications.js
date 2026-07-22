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

async function removeInvalidTokens(uids) {
  const updates = {};
  uids.forEach((uid) => {
    updates[`notificationTokens/${uid}`] = null;
  });
  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
}

async function sendToAllTokens(entries, notification, data) {
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
    console.log(`📱 ${entries.length} token(s) de notification enregistré(s) : [${entries.map(e => e.uid).join(', ')}]`);
    if (!entries.length) {
      console.log("Aucun token de notification enregistré, rien à envoyer.");
      return;
    }

    for (const [jobId, job] of Object.entries(jobs)) {
      if (job.notified) continue;

      // Réservation atomique : si une autre exécution (par ex. deux runs qui se
      // chevauchent) a déjà marqué ce job "notified" entre-temps, la transaction
      // échoue et on passe au job suivant sans envoyer une seconde fois.
      const claim = await jobsRef.child(jobId).transaction((current) => {
        if (!current || current.notified) return; // undefined = on annule, rien à faire
        return { ...current, notified: true };
      });

      if (!claim.committed) {
        console.log(`⏭️ Job "${job.title}" déjà pris en charge par une autre exécution, ignoré.`);
        continue;
      }

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

      try {
        const successCount = await sendToAllTokens(entries, notification, data);
        console.log(`✅ Notification envoyée pour "${job.title}" (${successCount}/${entries.length} appareil(s))`);
      } catch (err) {
        console.error(`❌ Erreur envoi notification pour ${job.title}:`, err);
      }
    }
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

// admin.database() garde une connexion websocket ouverte en permanence : sans
// fermeture explicite, le processus Node ne se termine jamais tout seul (d'où
// les runs GitHub Actions bloqués "In progress" pendant des heures). En
// revanche, on ne force PLUS process.exit() immédiatement après : sur un flux
// stdout redirigé (comme dans GitHub Actions), console.log() écrit de façon
// asynchrone, et exit() appelé trop tôt peut couper la toute dernière ligne de
// log avant qu'elle finisse de s'écrire (probable cause du "✅" jamais visible
// dans nos tests). On laisse donc le processus se terminer naturellement une
// fois la connexion Firebase fermée, avec un filet de sécurité différé au cas
// où quelque chose d'autre le retiendrait ouvert.
sendNotifications().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
