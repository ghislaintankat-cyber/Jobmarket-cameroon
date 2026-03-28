const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 1. CONNEXION À FIREBASE
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
});

const db = admin.database();

// 2. ROUTE POUR CRÉER LE LIEN DE PAIEMENT
app.post("/pay", async (req, res) => {
  const { jobId, amount, email } = req.body;

  try {
    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      {
        tx_ref: "boost-" + jobId + "-" + Date.now(),
        amount: amount,
        currency: "XAF",
        redirect_url: "https://jobmarket-cameroon.onrender.com/success", 
        meta: { jobId: jobId },
        customer: { email: email },
        customizations: {
          title: "JobMarket Cameroon",
          description: "Paiement Boost Annonce",
          logo: "https://votre-logo.com/logo.png"
        }
      },
      {
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Erreur Flutterwave:", error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});

// 3. ROUTE WEBHOOK (Celle qui reçoit la confirmation de Flutterwave)
app.post("/webhook", async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers["verif-hash"];

  // Vérification de sécurité pour éviter les pirates
  if (!signature || signature !== secretHash) {
    return res.status(401).send("Signature invalide");
  }

  const payload = req.body;

  if (payload.status === "successful") {
    const jobId = payload.meta.jobId;
    
    // MISE À JOUR DANS FIREBASE
    try {
      await db.ref("jobs/" + jobId).update({
        boosted: true,
        boostDate: admin.database.ServerValue.TIMESTAMP
      });
      console.log(`✅ Succès : Le job ${jobId} est maintenant boosté !`);
    } catch (dbError) {
      console.error("Erreur Firebase:", dbError);
    }
  }

  res.status(200).send("Webhook reçu");
});

// Route par défaut pour éviter l'erreur 404 sur l'adresse principale
app.get("/", (req, res) => {
  res.send("Le serveur JobMarket est en ligne !");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
