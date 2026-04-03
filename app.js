import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 🛰️ MAP SATELLITE + LABELS
const map = L.map('map').setView([3.848, 11.502], 6);

L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19 }
).addTo(map);

// Labels (noms villes)
L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { opacity: 0.5 }
).addTo(map);

// 📍 USER POSITION
let userLat, userLng;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], {
    radius: 8,
    color: "blue",
    fillColor: "#3b82f6",
    fillOpacity: 1
  }).addTo(map);

  map.setView([userLat, userLng], 12);
});

// 📏 DISTANCE
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;

  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2)**2;

  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
}

// 🔄 LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  map.eachLayer(layer => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  Object.keys(data).forEach(id => {

    const job = data[id];

    const distance = userLat
      ? getDistance(userLat, userLng, job.lat, job.lng)
      : "?";

    const badge = job.boosted ? "🔥 BOOST" : "";

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <div class="job-ui">
        <div>
          <b>${job.title}</b><br>
          ${job.description}<br>
          ⭐ 4.8 • ${distance} km<br>
          ${badge}<br><br>
          <button onclick="boost('${id}')">Booster 500F</button>
        </div>
      </div>
    `);
  });
});

// ➕ CREATE JOB
window.createJob = () => {

  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;

  if (!title || !desc) return alert("Remplis tout");

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      boosted: false
    });

    alert("Publié !");
  });
};

// 💰 BOOST
window.boost = async (jobId) => {

  const email = prompt("Ton email");
  if (!email) return;

  const res = await fetch("https://jobmarket-backend-6gqm.onrender.com/pay", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ jobId, amount: 500, email })
  });

  const data = await res.json();
  window.location.href = data.data.link;
};
