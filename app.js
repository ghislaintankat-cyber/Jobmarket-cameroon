import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🔥 FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 🗺️ MAP
const map = L.map('map', { zoomControl: false }).setView([3.848, 11.502], 6);

// 🛰️ SATELLITE
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19 }
).addTo(map);

// 📍 USER POSITION
let userLat = null;
let userLng = null;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], {
    radius: 8,
    color: "#2563eb",
    fillColor: "#3b82f6",
    fillOpacity: 1
  }).addTo(map);

  map.setView([userLat, userLng], 12);
});

// 📏 DISTANCE
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}

// 🎨 COLORS
function getColor(title) {
  title = title.toLowerCase();

  if (title.includes("plombier")) return "#ef4444";
  if (title.includes("électricien")) return "#f59e0b";
  if (title.includes("coiffeuse")) return "#10b981";
  if (title.includes("vendeuse")) return "#f97316";

  return "#6366f1";
}

// 🎯 ICONS
function getIcon(title) {
  title = title.toLowerCase();

  if (title.includes("plombier")) return "🔧";
  if (title.includes("électricien")) return "⚡";
  if (title.includes("coiffeuse")) return "✂️";
  if (title.includes("vendeuse")) return "🛒";

  return "💼";
}

// 📡 LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  map.eachLayer(layer => {
    if (layer instanceof L.Marker) {
      map.removeLayer(layer);
    }
  });

  Object.keys(data).forEach(id => {

    const job = data[id];

    const distance = userLat
      ? getDistance(userLat, userLng, job.lat, job.lng)
      : "?";

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <div class="job-card">
        <div class="icon" style="background:${getColor(job.title)}">
          ${getIcon(job.title)}
        </div>
        <div>
          <div class="title">${job.title}</div>
          <div>${job.description}</div>
          <div class="meta">⭐ 4.8 • ${distance} km</div>
        </div>
      </div>
    `);

  });

});

// ➕ CREATE JOB
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
      lng: pos.coords.longitude
    });

    alert("Service publié");

  });
};
