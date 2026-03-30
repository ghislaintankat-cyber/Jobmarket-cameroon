import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Configuration Firebase avec TES clés
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.firebasestorage.app",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4",
  measurementId: "G-89ZNJZX2W3"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Initialisation de la Carte (Centre sur Yaoundé)
const map = L.map('map', { zoomControl: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Récupération des services en temps réel
onValue(ref(db, 'jobs'), snapshot => {
    const data = snapshot.val();
    if (!data) return;

    // Supprimer les anciens marqueurs pour éviter les doublons
    map.eachLayer((layer) => { if (layer instanceof L.Marker) map.removeLayer(layer); });

    Object.entries(data).forEach(([id, job]) => {
        const marker = L.marker([job.lat, job.lng]).addTo(map);
        marker.bindPopup(`
            <div style="color:#333;">
                <b>${job.title}</b><br>
                ${job.description}<br><br>
                <button onclick="boost('${id}')" style="background:#f59e0b; color:white; border:none; padding:8px; cursor:pointer; width:100%; border-radius:5px; font-weight:bold;">💎 Booster ce service</button>
            </div>
        `);
    });
});

// Publier un service (GPS)
window.createJob = () => {
    const title = document.getElementById("title").value;
    const desc = document.getElementById("desc").value;

    if (!title || !desc) return alert("Veuillez remplir tous les champs !");

    navigator.geolocation.getCurrentPosition(pos => {
        push(ref(db, 'jobs'), {
            title,
            description: desc,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            date: Date.now()
        });
        alert("🚀 Service publié avec succès sur la carte !");
        document.getElementById("title").value = "";
        document.getElementById("desc").value = "";
    }, err => alert("Activez votre GPS pour publier !"));
};

// Payer pour Booster (Appel à ton Render)
window.boost = async (jobId) => {
    try {
        // ⚠️ CHANGE CETTE URL PAR TON URL RENDER APRÈS DÉPLOIEMENT
        const res = await fetch("https://TON-BACKEND.onrender.com/pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jobId: jobId,
                amount: 500,
                email: "paiement@jobmarket.cm"
            })
        });

        const data = await res.json();
        if (data.status === "success") {
            window.location.href = data.data.link;
        } else {
            alert("Erreur lors de la création du paiement.");
        }
    } catch (error) {
        alert("Le serveur de paiement est hors-ligne. Réessayez plus tard.");
    }
};
