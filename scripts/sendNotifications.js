const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Doit correspondre à databaseURL dans index.html / sw.js
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();
const messaging = admin.messaging();

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

// Verrou par job : évite que deux exécutions qui se chevauchent (cron +
// déclenchement manuel, par ex.) traitent le même job en même temps. Il
// expire tout seul si une exécution plante avant de le libérer.
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min (le workflow a un timeout de 5 min)

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

// Construit le contenu de la notification pour un utilisateur donné, en
// fonction du nombre de jobs qu'il a en attente. Si le cron a raté
// plusieurs jobs récents d'un coup (ou en a accumulé pendant un run
// bloqué), on regroupe en UNE SEULE notification plutôt que d'en envoyer
// une par job — sinon quelqu'un qui rouvre son téléphone après quelques
// heures se prend une rafale de notifications d'un coup, ce qui pousse à
// désactiver les notifications complètement.
function buildNotificationData(jobsForUid) {
  if (jobsForUid.length === 1) {
    const { jobId, job } = jobsForUid[0];
    return {
      title: "Nouveau poste disponible",
      body: `${job.title} (${job.typeContrat || "Contrat"}) à ${job.location || "Non spécifié"}`,
      jobId: String(jobId),
      category: String(job.category || "General"),
      location: String(job.location || "Global"),
      salaire: String(job.salaire || "N/A")
    };
  }
  const titles = jobsForUid.slice(0, 3).map(({ job }) => job.title).filter(Boolean);
  const extra = jobsForUid.length - titles.length;
  return {
    title: `${jobsForUid.length} nouveaux postes disponibles`,
    body: titles.join(" • ") + (extra > 0 ? ` et ${extra} autre(s)` : ""),
    jobId: String(jobsForUid[0].jobId), // pour le clic : ouvre au moins la 1ère annonce
    multiCount: String(jobsForUid.length)
  };
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
    const tokenByUid = new Map(entries.map((e) => [e.uid, e.token]));
    console.log(`📱 ${entries.length} token(s) de notification enregistré(s).`);
    if (!entries.length) {
      console.log("Aucun token de notification enregistré, rien à envoyer.");
      return;
    }

    const presenceMap = await getPresenceMap();
    const now = Date.now();

    // ---- Phase 1 : réserver les jobs à traiter, répartir chaque
    // destinataire en "push" (pas actif) ou "vu en direct" (actif dans
    // l'app), regroupé PAR UTILISATEUR.
    const claimedJobIds = [];
    const pushByUid = new Map(); // uid -> [{ jobId, job }, ...]
    const seenNowUpdates = {};

    for (const [jobId, job] of Object.entries(jobs)) {
      const jobTimestamp = job.timestamp || 0;
      if (now - jobTimestamp > JOB_WINDOW_MS) continue; // job trop ancien, on n'en parle plus

      // notifiedTo suit, PAR UTILISATEUR, qui a déjà reçu ce job (push ou
      // vu en direct). Un utilisateur qui vient d'activer les
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
      claimedJobIds.push(jobId);

      pendingEntries.forEach((entry) => {
        if (isCurrentlyActive(entry.uid, presenceMap)) {
          seenNowUpdates[`jobs/${jobId}/notifiedTo/${entry.uid}`] = true;
        } else {
          if (!pushByUid.has(entry.uid)) pushByUid.set(entry.uid, []);
          pushByUid.get(entry.uid).push({ jobId, job });
        }
      });
    }

    if (Object.keys(seenNowUpdates).length) await db.ref().update(seenNowUpdates);

    if (!claimedJobIds.length) {
      console.log("Rien de nouveau à notifier pour ce run.");
      return;
    }

    // ---- Phase 2 : un seul envoi push par utilisateur, même s'il a
    // plusieurs jobs en attente (voir buildNotificationData ci-dessus).
    const invalidUids = [];
    const notifiedUpdates = {};
    let pushCount = 0;

    for (const [uid, jobsForUid] of pushByUid) {
      const token = tokenByUid.get(uid);
      if (!token) continue; // token supprimé entre-temps

      const data = buildNotificationData(jobsForUid);

      try {
        const response = await messaging.sendEachForMulticast({ tokens: [token], data });
        const res = response.responses[0];
        if (res.success) {
          pushCount++;
          jobsForUid.forEach(({ jobId }) => { notifiedUpdates[`jobs/${jobId}/notifiedTo/${uid}`] = true; });
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            invalidUids.push(uid);
            // Token mort : inutile de réessayer indéfiniment, on marque ces
            // jobs comme "notifiés" pour ce uid pour ne pas les rescanner
            // à chaque run tant que personne n'a réenregistré de token.
            jobsForUid.forEach(({ jobId }) => { notifiedUpdates[`jobs/${jobId}/notifiedTo/${uid}`] = true; });
          } else {
            console.error(`❌ Erreur d'envoi (${code || "inconnue"}):`, res.error && res.error.message);
            // Pas invalide, juste raté : ce uid sera retenté au run suivant.
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour ${jobsForUid.length} job(s), nouvelle tentative au prochain run:`, err);
      }
    }

    if (invalidUids.length) {
      await removeInvalidTokens(invalidUids);
      console.log(`🧹 ${invalidUids.length} token(s) invalide(s) supprimé(s).`);
    }
    if (Object.keys(notifiedUpdates).length) await db.ref().update(notifiedUpdates);

    console.log(
      `✅ ${pushCount} notification(s) push envoyée(s) (${pushByUid.size} destinataire(s) ciblé(s)), ` +
      `${Object.keys(seenNowUpdates).length} vu(s) en direct dans l'app, ${claimedJobIds.length} job(s) traité(s).`
    );

    for (const jobId of claimedJobIds) await releaseLock(jobsRef, jobId);
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
