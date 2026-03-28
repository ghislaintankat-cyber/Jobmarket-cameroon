const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 1. CONNEXION À FIREBASE
// Assure-tu que ton fichier firebase-key.json est bien dans ton dépôt GitHub
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com" 
});

const db = admin.database();

// 2. ROUTE : CRÉER LE PAIEMENT (Appelée par ton bouton Booster)
app.post("/pay", async (req, res) => {
  const { jobId, amount, email } = req.body;

  try {
    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      {
        tx_ref: "job-boost-" + Date.now(),
        amount: amount,
        currency: "XAF", // Franc CFA pour le Cameroun
        redirect_url: "https://ton-site-web.com/success.html", // Où va le client après avoir payé
        meta: { jobId: jobId },
        customer: { email: email },
        customizations: {
          title: "Boost JobMarket Cameroon",
          description: "Mise en avant de votre annonce"
        }
      },
      {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ROUTE : LE WEBHOOK (Appelé par Flutterwave après le paiement)
app.post("/webhook", async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers["verif-hash"];

  // Vérification de sécurité
  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  const payload = req.body;
  
  // Si le paiement est réussi, on active le boost dans Firebase
  if (payload.status === "successful") {
    const jobId = payload.meta.jobId;
    await db.ref("jobs/" + jobId).update({ 
      boosted: true,
      boostDate: Date.now() 
    });
    console.log(`Job ${jobId} boosté avec succès !`);
  }

  res.status(200).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
