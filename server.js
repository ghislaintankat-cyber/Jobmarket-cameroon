const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors()); // Autorise ton site GitHub à parler à ce serveur
app.use(express.json());

app.post("/job-created", (req, res) => {
    console.log("Nouveau Job reçu :", req.body);
    res.status(200).send({ status: "Succès", message: "Serveur Render a reçu l'info !" });
});

app.get("/", (req, res) => {
    res.send("Le serveur JobMarket est en ligne ! 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Serveur démarré sur le port " + PORT);
});