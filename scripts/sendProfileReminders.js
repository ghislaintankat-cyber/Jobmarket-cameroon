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
      db.ref("notificationTokens").once("value")
    ]);

    const profilesMap = profilesSnap.val() || {};
    const tokensMap = tokensSnap.val() || {};

    const candidates = Object.entries(tokensMap).filter(([uid, token]) => {
      if (typeof token !== "string" || !token.length) return false;
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

    for (const [uid, token] of candidates) {
      const lang = (profilesMap[uid] && profilesMap[uid].lang) || "fr";
      const data = buildProfileReminderData(lang);

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: [token],
          data,
          webpush: { headers: { Urgency: "high" } }
        });
        const res = response.responses[0];
        if (res.success) {
          sentCount++;
          updates[`profiles/${uid}/profileReminderSent`] = true;
        } else {
          const code = res.error && res.error.code;
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            updates[`profiles/${uid}/profileReminderSent`] = true; // token mort, inutile de retenter
            updates[`notificationTokens/${uid}`] = null;
          } else {
            console.error(`❌ Erreur d'envoi pour ${uid} (${code || "inconnue"}):`, res.error && res.error.message);
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
