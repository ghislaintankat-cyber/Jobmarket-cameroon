// ===== JobMarket Cameroon : sauvegarde quotidienne de la base de données =====
//
// Rôle : exporter TOUTE la base Firebase (jobs, profiles, reviews,
// job_contacts, notifyPrefs, etc.) vers un fichier JSON daté, écrit ici en
// local dans le dossier d'exécution du workflow. C'est le workflow
// GitHub Actions (backup.yml) qui se charge ensuite de pousser ce fichier
// vers un DÉPÔT PRIVÉ séparé — jamais vers le dépôt public de l'app.
//
// Pourquoi un dépôt séparé et privé : ce dump contient des données
// personnelles (numéros de téléphone, numéros WhatsApp, URLs de documents
// de vérification) qui ne doivent jamais atterrir dans le dépôt public
// Jobmarket-cameroon (nécessaire pour GitHub Pages) — l'historique Git est
// permanent, une fuite ici serait irréversible.

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Dossier de sortie local, éphémère (propre à chaque exécution du
// workflow) — jamais commité dans CE dépôt-ci, uniquement lu par l'étape
// suivante du workflow qui le copie vers le dépôt privé de sauvegardes.
const OUTPUT_DIR = path.join(__dirname, "..", "backup-output");

async function backupDatabase() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const snap = await db.ref().once("value");
    const data = snap.val() || {};

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(OUTPUT_DIR, `backup-${today}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
    const topLevelKeys = Object.keys(data);
    console.log(`✅ Sauvegarde écrite : ${filePath} (${sizeKb} Ko)`);
    console.log(`   Sections incluses : ${topLevelKeys.join(", ")}`);
  } catch (err) {
    console.error("❌ Erreur sauvegarde:", err);
    process.exitCode = 1;
  }
}

backupDatabase().finally(() => {
  return admin.app().delete().catch(() => {});
}).finally(() => {
  const safetyTimer = setTimeout(() => process.exit(process.exitCode || 0), 3000);
  if (safetyTimer.unref) safetyTimer.unref();
});
