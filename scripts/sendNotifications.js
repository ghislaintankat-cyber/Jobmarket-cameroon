const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://<YOUR_FIREBASE_PROJECT>.firebaseio.com"
});

const db = admin.database();

async function sendNotifications() {
  try {
    const jobsRef = db.ref("jobs");
    const snapshot = await jobsRef.once("value");
    const jobs = snapshot.val();

    if (!jobs) {
      console.log("Aucun job trouvé.");
      return;
    }

    for (const [jobId, job] of Object.entries(jobs)) {
      if (!job.notified) {
        // Construire un topic basé sur catégorie + ville
        const topic = `${job.category || "General"}_${job.location || "Global"}`;

        const message = {
          topic,
          notification: {
            title: "Nouveau poste disponible",
            body: `${job.title} (${job.typeContrat || "Contrat"}) à ${job.location || "Non spécifié"}`
          },
          data: {
            jobId,
            salaire: job.salaire || "N/A"
          }
        };

        try {
          await admin.messaging().send(message);
          await jobsRef.child(jobId).update({ notified: true });
          console.log(`✅ Notification envoyée pour ${job.title} (topic: ${topic})`);
        } catch (err) {
          console.error(`❌ Erreur envoi notification pour ${job.title}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("❌ Erreur globale:", err);
  }
}

sendNotifications();
