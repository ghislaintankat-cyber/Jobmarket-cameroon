import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSy...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// 🛰️ SATELLITE
const satellite = L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
{ maxZoom: 19 }
).addTo(map);

// 🏷️ LABELS (NOMS DES LIEUX)
const labels = L.tileLayer(
'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
{
  maxZoom: 19,
  pane: 'overlayPane'
}
).addTo(map);

// USER
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

// DISTANCE
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

// LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  map.eachLayer(layer => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  Object.values(data).forEach(job => {

    const distance = userLat
      ? getDistance(userLat, userLng, job.lat, job.lng)
      : "?";

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <div class="job-card">
        <div><b>${job.title}</b><br>${job.description}</div>
        <div>⭐ 4.8 • ${distance} km</div>
      </div>
    `);

    marker.on("click", () => {
      map.flyTo([job.lat, job.lng], 14);
    });

  });

});

// CREATE
window.createJob = () => {

  const title = prompt("Titre ?");
  const desc = prompt("Description ?");

  if (!title || !desc) return;

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });

    alert("Publié !");
  });
};

// GO USER
window.goToUser = () => {
  if (userLat) {
    map.flyTo([userLat, userLng], 15);
  }
};

// LOADER
setTimeout(() => {
  document.getElementById("loader").style.display = "none";
}, 1500);
