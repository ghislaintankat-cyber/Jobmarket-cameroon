import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "TON_API_KEY",
  authDomain: "TON_PROJECT.firebaseapp.com",
  databaseURL: "TON_DB_URL",
  projectId: "TON_PROJECT"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.8, 11.5], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  Object.values(data).forEach(job => {

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      ${job.description}
      <br><br>
      <button onclick="boost()">Booster</button>
    `);

  });

});

// CREATE JOB
window.createJob = () => {

  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });

  });

};

// BOOST (appel backend)
window.boost = async () => {

  const res = await fetch("https://TON-BACKEND.onrender.com/pay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jobId: "123",
      amount: 500,
      email: "test@email.com"
    })
  });

  const data = await res.json();

  if (data.status === "success") {
    window.location.href = data.data.link;
  } else {
    alert("Erreur paiement");
  }

};
