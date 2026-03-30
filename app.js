import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Configuration Firebase avec TES clés réelles
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

// Initialisation Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- INITIALISATION DE LA CARTE ---
// On centre sur Yaoundé par défaut [3.848, 11.502]
const map = L.map('map').setView([3.848, 11.502], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

// --- CHARGEMENT DES JOBS ---
onValue(ref(db, 'jobs'), snapshot => {
  const data = snapshot.val();
  if (!data) return;

  // Supprimer les anciens marqueurs pour éviter les doublons à l'affichage
  map.eachLayer((layer) => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  Object.entries(data).forEach(([id, job]) => {
    if (job.lat && job.lng) {
        const marker = L.marker([job.lat, job.lng]).addTo(map);
        marker.bindPopup(`
          <div style="color:black;">
            <b>${job.title}</b><br>
            ${job.description}<br><br>
            <button onclick="boost('${id}')" style="background:orange; color:white; border:none; padding:5px; cursor:pointer; width:100%;">💎 Booster ce service</button>
          </div>
        `);
    }
  });
});

// --- CRÉER UN JOB ---
window.createJob = () => {
  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;

  if (!title || !desc) {
      alert("Veuillez remplir les deux champs !");
      return;
  }

  navigator.geolocation.getCurrentPosition(pos => {
    push(ref(db, 'jobs'), {
      title: title,
      description: desc,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      date: Date.now()
    });
    alert("✅ Service publié sur la carte !");
    document.getElementById("title").value = "";
    document.getElementById("desc").value = "";
  }, err => {
      alert("Erreur : Veuillez activer votre GPS pour publier.");
  });
};

// --- BOOSTER (Appel Backend Render) ---
window.boost = async (jobId) => {
  // REMPLACE PAR TON URL RENDER RÉELLE QUAND ELLE SERA LIVE
  const backendURL = "https://TON-BACKEND.onrender.com/pay";

  try {
    const res = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: jobId,
        amount: 500,
        email: "client@jobmarket.cm"
      })
    });

    const data = await res.json();

    if (data.status === "success") {
      window.location.href = data.data.link;
    } else {
      alert("Erreur lors de la préparation du paiement.");
    }
  } catch (error) {
    alert("Le serveur de paiement est hors-ligne. Réessayez plus tard.");
  }
};
