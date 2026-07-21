const admin = require("firebase-admin");
const fetch = require("node-fetch");

// Initialisation Firebase avec le secret
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
        to: "/topics/allUsers", // ou un token spécifique
        notification: {
          title: "Nouveau poste disponible",
          body: `${job.title} chez ${job.company}`
        },
        data: {
          jobId
        }
      };

      // Envoyer via FCM
      await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Authorization": `key=${process.env.FCM_SERVER_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message)
      });

      // Marquer comme notifié
      await jobsRef.child(jobId).update({ notified: true });
      console.log(`Notification envoyée pour ${job.title}`);
    }
  }
}

sendNotifications().catch(console.error);
