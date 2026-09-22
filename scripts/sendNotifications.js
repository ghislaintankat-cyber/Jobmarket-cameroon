const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Doit correspondre à databaseURL dans index.html / sw.js
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

// Alimente notifStats/{date}/{variant}/sent, utilisé par le dashboard admin
// pour calculer un taux d'ouverture par variante A/B (voir
// loadNotifOpenRate dans index.html). Non bloquant : une erreur ici ne doit
// jamais empêcher l'envoi réel des notifications, qui est le rôle
// principal du script. "variant" peut être "A", "B", ou toute autre clé
// (ex: "digest" pour scripts/sendReengagement.js, hors A/B test).
async function bumpSentStat(variant, count) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await db.ref(`notifStats/${today}/${variant}/sent`).transaction((current) => (current || 0) + count);
  } catch (e) {
    console.warn("bumpSentStat error (non bloquant)", e);
  }
}

// (20260906j) LECTURE MULTI-APPAREILS via le module partage pushTokens.js.
// Avant : seul le noeud historique etait lu — une seule chaine, donc UN SEUL
// appareil par compte. Le telephone etait ecrase par l'ordinateur.
async function getAllTokens() {
  const map = await loadTokensMap(db);
  return Object.entries(map).map(([uid, tokens]) => ({ uid, tokens }));
}

async function getProfilesMap() {
  const snap = await db.ref("profiles").once("value");
  return snap.val() || {};
}

// Même formule (haversine) que calcDist() côté client dans index.html —
// gardez les deux synchronisées si l'une change.
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const DEFAULT_MAX_DISTANCE_KM = 25;

// true si rien n'indique qu'il faut exclure ce job pour cet utilisateur sur
// la base de la distance. Volontairement permissif dans le doute (job sans
// coordonnées, ou position de l'utilisateur inconnue) : on préfère notifier
// en trop plutôt que rater un job faute de donnée GPS.
function wantsDistance(uid, job, profilesMap, notifyPrefsMap) {
  if (typeof job.lat !== "number" || typeof job.lng !== "number") return true;
  const profile = profilesMap[uid];
  if (!profile || typeof profile.lat !== "number" || typeof profile.lng !== "number") return true;
  const prefs = notifyPrefsMap[uid] || {};
  const maxDistanceKm = typeof prefs.maxDistanceKm === "number" ? prefs.maxDistanceKm : DEFAULT_MAX_DISTANCE_KM;
  return distanceKm(profile.lat, profile.lng, job.lat, job.lng) <= maxDistanceKm;
}

async function getPresenceMap() {
  const snap = await db.ref("presence").once("value");
  return snap.val() || {};
}

async function getNotifyPrefs() {
  const snap = await db.ref("notifyPrefs").once("value");
  return snap.val() || {};
}

// true si rien n'indique explicitement que cette catégorie est désactivée
// pour cet utilisateur (voir setNotifCategoryPref côté client : seules les
// exclusions sont stockées, absence de préférence = activé par défaut).
function wantsCategory(uid, category, notifyPrefsMap) {
  const prefs = notifyPrefsMap[uid];
  if (!prefs) return true;
  return prefs[category] !== false;
}

// true seulement si la personne est là, MAINTENANT, dans l'app.
function isCurrentlyActive(uid, presenceMap) {
  const p = presenceMap[uid];
  if (!p || p.state !== "active") return false;
  const lastChanged = typeof p.lastChanged === "number" ? p.lastChanged : 0;
  return (Date.now() - lastChanged) < PRESENCE_STALE_MS;
}

// (20260906j) SUPPRIMEE — c'etait la cause racine du blocage des
// notifications pendant ~16 vagues. Cette fonction effacait l'entiere entree
// `notificationTokens/{uid}` des qu'UN jeton etait refuse : un ordinateur
// eteint tuait donc les notifications du TELEPHONE du meme compte.
// Le nettoyage est desormais fait appareil par appareil, apres relecture,
// par sendToUid()/removeDeadToken() dans pushTokens.js.

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
// Traductions des textes de notification. Miroir volontairement minimal des
// langues gérées côté client (I18N dans index.html : fr/en/it/de/zh) — on ne
// traduit ici que ce qui part réellement dans une notif push, pas toute
// l'appli.
const NOTIF_I18N = {
  fr: {
    singleTitleVariants: { A: "Nouveau poste disponible", B: "🔥 Un job vient d'être publié près de vous" },
    singleBody: (title, typeContrat, location) => `${title} (${typeContrat || "Contrat"}) à ${location || "Non spécifié"}`,
    multiTitleVariants: { A: (n) => `${n} nouveaux postes disponibles`, B: (n) => `🔥 ${n} jobs vous attendent près de vous` },
    andMore: (n) => ` et ${n} autre(s)`
  },
  en: {
    singleTitleVariants: { A: "New job available", B: "🔥 A job was just posted near you" },
    singleBody: (title, typeContrat, location) => `${title} (${typeContrat || "Contract"}) in ${location || "Unspecified"}`,
    multiTitleVariants: { A: (n) => `${n} new jobs available`, B: (n) => `🔥 ${n} jobs waiting for you nearby` },
    andMore: (n) => ` and ${n} more`
  },
  it: {
    singleTitleVariants: { A: "Nuovo lavoro disponibile", B: "🔥 Un lavoro è stato appena pubblicato vicino a te" },
    singleBody: (title, typeContrat, location) => `${title} (${typeContrat || "Contratto"}) a ${location || "Non specificato"}`,
    multiTitleVariants: { A: (n) => `${n} nuovi lavori disponibili`, B: (n) => `🔥 ${n} lavori ti aspettano vicino a te` },
    andMore: (n) => ` e altri ${n}`
  },
  de: {
    singleTitleVariants: { A: "Neuer Job verfügbar", B: "🔥 Ein Job wurde gerade in Ihrer Nähe veröffentlicht" },
    singleBody: (title, typeContrat, location) => `${title} (${typeContrat || "Vertrag"}) in ${location || "Nicht angegeben"}`,
    multiTitleVariants: { A: (n) => `${n} neue Jobs verfügbar`, B: (n) => `🔥 ${n} Jobs warten in Ihrer Nähe` },
    andMore: (n) => ` und ${n} weitere`
  },
  zh: {
    singleTitleVariants: { A: "有新工作机会", B: "🔥 您附近刚刚发布了一个工作机会" },
    singleBody: (title, typeContrat, location) => `${title}（${typeContrat || "合同"}）- ${location || "地点未指定"}`,
    multiTitleVariants: { A: (n) => `${n} 个新工作机会`, B: (n) => `🔥 ${n} 个工作机会在您附近等着您` },
    andMore: (n) => ` 及其他 ${n} 个`
  }
};

function notifStrings(lang) {
  return NOTIF_I18N[lang] || NOTIF_I18N.fr;
}

// Tirage A/B à 50/50, indépendant à chaque envoi (pas figé par utilisateur) :
// sur un volume suffisant, ça donne une comparaison honnête des deux
// formulations sans biais lié à qui reçoit quoi.
function pickVariant() {
  return Math.random() < 0.5 ? "A" : "B";
}

// Récupère une URL de photo utilisable pour la vignette de la notif, en
// tenant compte des deux formats existants dans les jobs (images[] le
// format actuel, image la clé historique pour les anciens jobs).
function firstJobImage(job) {
  if (Array.isArray(job.images) && job.images[0]) return job.images[0];
  if (job.image) return job.image;
  return null;
}

function buildNotificationData(jobsForUid, lang, variant) {
  const s = notifStrings(lang);
  if (jobsForUid.length === 1) {
    const { jobId, job } = jobsForUid[0];
    const image = firstJobImage(job);
    const data = {
      title: s.singleTitleVariants[variant] || s.singleTitleVariants.A,
      body: s.singleBody(job.title, job.typeContrat, job.location),
      jobId: String(jobId),
      category: String(job.icon || "General"), // "icon" = vraie clé de catégorie côté client, voir correctif ci-dessus
      location: String(job.location || "Global"),
      salaire: String(job.salaire || "N/A"),
      variant,
      lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
    };
    if (image) data.image = String(image); // sw.js l'utilise pour la vignette de la notif
    return data;
  }
  const titles = jobsForUid.slice(0, 3).map(({ job }) => job.title).filter(Boolean);
  const extra = jobsForUid.length - titles.length;
  const groupImage = firstJobImage(jobsForUid[0].job); // photo du job le plus récent du lot, à défaut d'un visuel "collage"
  const titleFn = s.multiTitleVariants[variant] || s.multiTitleVariants.A;
  const data = {
    title: titleFn(jobsForUid.length),
    body: titles.join(" • ") + (extra > 0 ? s.andMore(extra) : ""),
    jobId: String(jobsForUid[0].jobId), // pour le clic : ouvre au moins la 1ère annonce
    multiCount: String(jobsForUid.length),
    variant,
    lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
  };
  if (groupImage) data.image = String(groupImage);
  return data;
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
    const tokensMap = Object.create(null);
    entries.forEach((e) => { tokensMap[e.uid] = e.tokens; });
    console.log(`📱 ${entries.length} compte(s) avec au moins un appareil enregistré.`);
    if (!entries.length) {
      console.log("Aucun token de notification enregistré, rien à envoyer.");
      return;
    }

    const presenceMap = await getPresenceMap();
    const notifyPrefsMap = await getNotifyPrefs();
    const profilesMap = await getProfilesMap();
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
      // BUG CORRIGÉ : côté client (index.html), la catégorie du job est
      // enregistrée dans le champ "icon" (ex: "btp", "electricite"), pas
      // "category" — ce dernier n'existe pas dans les données. Avant ce
      // correctif, "category" valait toujours "" ici, donc wantsCategory()
      // ne trouvait jamais de préférence désactivée correspondante et
      // laissait tout passer : tout le monde recevait tous les jobs, quels
      // que soient ses choix dans les préférences de notification.
      const category = (job.icon || "").toLowerCase();
      const pendingEntries = entries.filter(
        (e) => !notifiedTo[e.uid] &&
          wantsCategory(e.uid, category, notifyPrefsMap) &&
          wantsDistance(e.uid, job, profilesMap, notifyPrefsMap)
      );
      if (!pendingEntries.length) continue; // tout le monde a déjà été notifié, l'a vu en direct, ou n'est pas intéressé par cette catégorie

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
    const variantSentCounts = { A: 0, B: 0 };
    for (const [uid, jobsForUid] of pushByUid) {
      if (!tokensFor(tokensMap, uid).length) continue; // appareils retires entre-temps

      const lang = (profilesMap[uid] && profilesMap[uid].lang) || 'fr';
      const variant = pickVariant();
      const data = buildNotificationData(jobsForUid, lang, variant);

      try {
        // (20260906j) envoi a TOUS les appareils du compte. Urgency: high est
        // applique dans pushTokens.js. Le nettoyage des appareils morts y est
        // chirurgical (relecture avant suppression).
        const outcome = await sendToUid(messaging, db, uid, tokensMap, data);
        if (outcome === "sent") {
          pushCount++;
          variantSentCounts[variant]++;
          jobsForUid.forEach(({ jobId }) => { notifiedUpdates[`jobs/${jobId}/notifiedTo/${uid}`] = true; });
        } else if (outcome === "invalid" || outcome === "no-token") {
          invalidUids.push(uid);
          // Tous les appareils sont morts : inutile de rescanner ces jobs pour
          // ce uid tant que personne n'a reenregistre d'appareil.
          jobsForUid.forEach(({ jobId }) => { notifiedUpdates[`jobs/${jobId}/notifiedTo/${uid}`] = true; });
        } else {
          // Echec transitoire : ce uid sera retente au run suivant.
          console.error(`❌ Envoi non abouti pour ${uid} (${outcome}).`);
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour ${jobsForUid.length} job(s), nouvelle tentative au prochain run:`, err);
      }
    }

    try {
      if (invalidUids.length) {
        // (20260906j) les appareils morts ont deja ete retires un par un par
        // sendToUid(). On ne fait plus AUCUNE suppression groupee ici.
        console.log(`🧹 ${invalidUids.length} compte(s) sans appareil joignable.`);
      }
      if (Object.keys(notifiedUpdates).length) await db.ref().update(notifiedUpdates);
      if (variantSentCounts.A > 0) await bumpSentStat("A", variantSentCounts.A);
      if (variantSentCounts.B > 0) await bumpSentStat("B", variantSentCounts.B);

      console.log(
        `✅ ${pushCount} notification(s) push envoyée(s) (${pushByUid.size} destinataire(s) ciblé(s)), ` +
        `${Object.keys(seenNowUpdates).length} vu(s) en direct dans l'app, ${claimedJobIds.length} job(s) traité(s).`
      );
    } finally {
      // Toujours libérer les verrous, même si l'écriture ci-dessus a échoué :
      // sinon un job reste bloqué inutilement jusqu'à expiration du TTL (4
      // min) au lieu d'être retenté dès le prochain run.
      for (const jobId of claimedJobIds) await releaseLock(jobsRef, jobId);
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
