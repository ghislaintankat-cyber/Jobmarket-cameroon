// ===== JobMarket Cameroon : rappel pour compléter son profil =====
//
// Rôle : une fois par jour, repérer les comptes dont le profil est
// incomplet (même définition que isProfileComplete() côté client dans
// index.html : nom/société + métier) et leur envoyer UN SEUL rappel.
// Un profil complet inspire plus confiance aux autres utilisateurs et
// augmente les chances d'être contacté.
//
// On suggère aussi la photo et le téléphone vérifié dans le texte, même si
// isProfileComplete() ne les exige pas à proprement parler — ce sont des
// signaux de confiance supplémentaires qui valent la peine d'être
// mentionnés sans pour autant bloquer/pénaliser ceux qui ne les ont pas.

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
const { loadTokensMap, sendToUid } = (() => {
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

// Même règle que isProfileComplete() dans index.html — à garder synchronisée
// si la définition change côté client.
function isProfileComplete(profile) {
  return !!(profile && (profile.name || profile.company) && profile.jobTitle);
}

const PROFILE_REMINDER_I18N = {
  fr: {
    title: "Complétez votre profil",
    body: "Ajoutez votre nom et votre métier pour inspirer confiance — une photo et un numéro vérifié aident aussi à être contacté plus souvent."
  },
  en: {
    title: "Complete your profile",
    body: "Add your name and job title to build trust — a photo and a verified phone number also help you get contacted more."
  },
  it: {
    title: "Completa il tuo profilo",
    body: "Aggiungi il tuo nome e la tua professione per ispirare fiducia — una foto e un numero verificato aiutano anche a essere contattati più spesso."
  },
  de: {
    title: "Vervollständigen Sie Ihr Profil",
    body: "Fügen Sie Ihren Namen und Beruf hinzu, um Vertrauen zu schaffen — ein Foto und eine verifizierte Telefonnummer helfen ebenfalls."
  },
  zh: {
    title: "完善您的资料",
    body: "添加姓名和职业以建立信任——添加照片和已验证的电话号码也有助于获得更多联系。"
  }
};

function buildProfileReminderData(lang) {
  const s = PROFILE_REMINDER_I18N[lang] || PROFILE_REMINDER_I18N.fr;
  return {
    title: s.title,
    body: s.body,
    type: "profile-reminder",
    lang // pour que sw.js puisse aussi traduire les boutons d'action de la notif
  };
}

async function sendProfileReminders() {
  try {
    const [profilesSnap, tokensSnap] = await Promise.all([
      db.ref("profiles").once("value"),
      loadTokensMap(db)
    ]);

    const profilesMap = profilesSnap.val() || {};
    // (20260906j) carte fusionnee : uid -> [jetons de TOUS les appareils]
    const tokensMap = tokensSnap;

    const candidates = Object.entries(tokensMap).filter(([uid, tokens]) => {
      if (!Array.isArray(tokens) || !tokens.length) return false;
      const profile = profilesMap[uid];
      if (!profile || profile.profileReminderSent) return false;
      return !isProfileComplete(profile);
    });

    if (!candidates.length) {
      console.log("Aucun profil incomplet à rappeler aujourd'hui.");
      return;
    }

    const updates = {};
    let sentCount = 0;

    for (const [uid] of candidates) {
      const lang = (profilesMap[uid] && profilesMap[uid].lang) || "fr";
      const data = buildProfileReminderData(lang);

      try {
        // (20260906j) envoi multi-appareils + nettoyage chirurgical
        const outcome = await sendToUid(messaging, db, uid, tokensMap, data);
        if (outcome === "sent") {
          sentCount++;
          updates[`profiles/${uid}/profileReminderSent`] = true;
        } else {
          // sendToUid a deja retire les appareils morts (apres relecture).
          if (outcome === "invalid") {
            updates[`profiles/${uid}/profileReminderSent`] = true; // tous morts
          } else {
            console.error(`❌ Envoi non abouti pour ${uid} (${outcome}).`);
          }
        }
      } catch (err) {
        console.error(`❌ Erreur envoi pour ${uid}, nouvelle tentative au prochain run:`, err);
      }
    }

    if (Object.keys(updates).length) await db.ref().update(updates);
    console.log(`✅ ${sentCount} rappel(s) de profil envoyé(s) sur ${candidates.length} compte(s) éligible(s).`);
  } catch (err) {
    console.error("❌ Erreur globale:", err);
    process.exitCode = 1;
  }
}

sendProfileReminders().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
