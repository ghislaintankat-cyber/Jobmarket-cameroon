// ============================================================================
// scripts/pushTokens.js — SOURCE UNIQUE pour lire et nettoyer les jetons push
// (vague 20260906j)
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Les notifications d'appel ne sont jamais arrivées sur le téléphone pendant
// ~16 vagues de débogage. La cause n'était ni le téléphone, ni Android, ni la
// clé de service : ce sont les TÂCHES PLANIFIÉES qui effaçaient le jeton.
//
// Le nœud historique `notificationTokens/{uid}` ne contient QU'UNE SEULE
// CHAÎNE — donc UN SEUL APPAREIL par compte. Déroulé réel, reproductible :
//
//   1. le téléphone s'enregistre    -> notificationTokens/{uid} = jetonTEL
//   2. l'app est ouverte sur le PC  -> notificationTokens/{uid} = jetonPC
//                                      (le jeton du téléphone est ÉCRASÉ)
//   3. le PC est fermé, son jeton meurt
//   4. un cron envoie une notif, FCM répond « token-not-registered »
//   5. le script EFFACE notificationTokens/{uid}
//   6. le worker d'appel ne trouve plus rien -> « AUCUN appareil enregistré »
//
// Et ce n'était pas UN script mais HUIT, dont quatre tournent toutes les
// 15-20 minutes. D'où l'alternance vécue par l'utilisateur : « ✅ enregistré »
// juste après « Réparer les notifications », « ❌ Aucun jeton » un quart
// d'heure plus tard.
//
// CE QUE CE MODULE GARANTIT
// -------------------------
//   • lecture de TOUS les appareils : ancien nœud + notificationTokens_v2
//     (la même source que le worker d'appel Cloudflare — les deux chaînes de
//     notification voient enfin la même chose) ;
//   • envoi à tous les appareils, succès dès qu'UN SEUL reçoit ;
//   • suppression CHIRURGICALE : seul l'appareil réellement refusé par FCM
//     est retiré, jamais l'entrée entière du compte ;
//   • RÈGLE ANTI-DESTRUCTION : on relit la valeur juste avant d'effacer. Si
//     elle a changé entre-temps (un autre appareil s'est enregistré pendant
//     le run), la suppression est ANNULÉE.
//
// Tous les scripts de notification doivent passer par ici. Ne jamais écrire
// `updates["notificationTokens/" + uid] = null` à la main : c'est exactement
// le bug que ce module corrige.
// ============================================================================

/**
 * Lit TOUS les jetons de TOUS les comptes, en fusionnant les deux nœuds.
 * @returns {Promise<Object.<string, string[]>>} uid -> tableau de jetons
 */
async function loadTokensMap(db) {
  const out = Object.create(null);
  const add = (uid, token) => {
    if (!uid || typeof token !== "string" || !token.length) return;
    if (!out[uid]) out[uid] = [];
    if (!out[uid].includes(token)) out[uid].push(token);
  };

  const [legacySnap, v2Snap] = await Promise.all([
    db.ref("notificationTokens").once("value"),
    db.ref("notificationTokens_v2").once("value")
  ]);

  Object.entries(legacySnap.val() || {}).forEach(([uid, token]) => add(uid, token));

  Object.entries(v2Snap.val() || {}).forEach(([uid, devices]) => {
    if (!devices || typeof devices !== "object") return;
    Object.values(devices).forEach((entry) => {
      add(uid, entry && typeof entry === "object" ? entry.token : entry);
    });
  });

  return out;
}

/** Nombre de comptes joignables (pour les logs « N token(s) enregistré(s) »). */
function countUsers(tokensMap) {
  return Object.keys(tokensMap).length;
}

/** Les jetons d'un compte, toujours sous forme de tableau. */
function tokensFor(tokensMap, uid) {
  const v = tokensMap && uid ? tokensMap[uid] : null;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Retire UN appareil mort, et seulement lui.
 *
 * ANTI-DESTRUCTION : l'ancien nœud n'est effacé que si sa valeur actuelle est
 * EXACTEMENT le jeton refusé. Si un autre appareil s'est enregistré entre
 * l'envoi et le nettoyage, on ne touche à rien.
 */
async function removeDeadToken(db, uid, badToken) {
  if (!uid || !badToken) return;
  try {
    const snap = await db.ref(`notificationTokens/${uid}`).once("value");
    const current = snap.val();
    if (current === badToken) {
      await db.ref(`notificationTokens/${uid}`).remove().catch(() => {});
    } else if (current) {
      console.log(`↩️  ${uid} : jeton déjà remplacé par un autre appareil, suppression annulée.`);
    }

    // Multi-appareils : on ne retire que l'entrée dont le jeton correspond.
    const devSnap = await db.ref(`notificationTokens_v2/${uid}`).once("value");
    const devices = devSnap.val() || {};
    for (const [key, entry] of Object.entries(devices)) {
      const tk = entry && typeof entry === "object" ? entry.token : entry;
      if (tk === badToken) {
        await db.ref(`notificationTokens_v2/${uid}/${key}`).remove().catch(() => {});
      }
    }
  } catch (e) {
    console.error(`removeDeadToken(${uid}) :`, (e && e.message) || e);
  }
}

const DEAD_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

/**
 * Envoie une notification à TOUS les appareils d'un compte.
 *
 * @returns {Promise<"sent"|"no-token"|"invalid"|"error">}
 *   "sent"     au moins un appareil a reçu
 *   "no-token" aucun appareil connu
 *   "invalid"  tous les appareils connus sont morts (nettoyés au passage)
 *   "error"    échec transitoire : à retenter au prochain run
 */
async function sendToUid(messaging, db, uid, tokensMap, data) {
  const tokens = tokensFor(tokensMap, uid);
  if (!tokens.length) return "no-token";

  let response;
  try {
    response = await messaging.sendEachForMulticast({
      tokens,
      data,
      webpush: { headers: { Urgency: "high" } }
    });
  } catch (err) {
    console.error(`❌ Exception envoi à ${uid} :`, err);
    return "error";
  }

  let anySent = false;
  const dead = [];
  (response.responses || []).forEach((r, i) => {
    if (r && r.success) { anySent = true; return; }
    const code = r && r.error && r.error.code;
    if (DEAD_CODES.has(code)) {
      dead.push(tokens[i]);
    } else {
      console.error(`❌ Erreur d'envoi à ${uid} (${code || "inconnue"}) :`, r && r.error && r.error.message);
    }
  });

  // Nettoyage chirurgical, appareil par appareil.
  for (const bad of dead) await removeDeadToken(db, uid, bad);

  if (anySent) return "sent";
  if (dead.length) return "invalid";
  return "error";
}

module.exports = {
  loadTokensMap,
  countUsers,
  tokensFor,
  removeDeadToken,
  sendToUid
};
