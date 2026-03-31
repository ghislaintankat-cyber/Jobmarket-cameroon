import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🔥 TA CONFIG FIREBASE
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

// INIT FIREBASE
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// 🗺️ CARTE
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// 📍 AFFICHER JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();

  if (!data) return;

  // Nettoyer anciens markers
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) {
      map.removeLayer(layer);
    }
  });

  Object.keys(data).forEach(id => {

    const job = data[id];

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      ${job.description}<br><br>
      <button onclick="boost('${id}')">Booster 500F</button>
    `);
  });
});

// ➕ CRÉER JOB
window.createJob = () => {

  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;

  if (!title || !desc) {
    alert("Remplis les champs");
    return;
  }

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      boosted: false
    });

    alert("Service publié !");
  });
};

// 💰 BOOST (connecté à TON backend)
window.boost = async (jobId) => {

  const email = prompt("Ton email");

  if (!email) return;

  try {

    const res = await fetch("https://jobmarket-backend-6gqm.onrender.com/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jobId,
        amount: 500,
        email
      })
    });

    const data = await res.json();

    if (data.status === "success") {
      window.location.href = data.data.link;
    } else {
      alert("Erreur paiement");
    }

  } catch (err) {
    console.error(err);
    alert("Erreur serveur");
  }
};
