const admin = require("firebase-admin");

// Initialisation Firebase avec le service account JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://<YOUR_FIREBASE_PROJECT>.firebaseio.com"
});

const db = admin.database();

async function sendNotifications() {
  const jobsRef = db.ref("jobs");
  const snapshot = await jobsRef.once("value");
  const jobs = snapshot.val();

  if (!jobs) return;

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job.notified) {
      // Construire le message
      const message = {
        topic: "allUsers", // ou un token spécifique
        notification: {
          title: "Nouveau poste disponible",
          body: `${job.title} chez ${job.company}`
        },
        data: { jobId }
      };

      // Envoyer via Admin SDK (API v1)
      await admin.messaging().send(message);

      // Marquer comme notifié
      await jobsRef.child(jobId).update({ notified: true });
      console.log(`Notification envoyée pour ${job.title}`);
    }
  }
}

sendNotifications().catch(console.error);
