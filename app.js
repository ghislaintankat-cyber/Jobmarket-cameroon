import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIza...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// SATELLITE + NOMS
L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
{ opacity: 0.3 }
).addTo(map);

// USER POSITION
let userLat, userLng;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], {
    radius: 10,
    color: "blue",
    fillColor: "#3b82f6",
    fillOpacity: 0.9
  }).addTo(map);

  map.setView([userLat, userLng], 12);
});

// DISTANCE
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;

  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2) *
    Math.sin(dLon/2);

  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
}

// LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  Object.values(data).forEach(job => {

    const dist = userLat
      ? getDistance(userLat, userLng, job.lat, job.lng)
      : "...";

    const colors = ["red","yellow","green","purple","orange"];
    const icons = ["🔧","⚡","✂️","🎨","🛒"];

    const rand = Math.floor(Math.random()*5);

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <div class="job-card">
        <div class="icon ${colors[rand]}">${icons[rand]}</div>
        <div>
          <b>${job.title}</b><br>
          ${job.description}<br>
          ⭐ 4.${rand+5} • ${dist} km
        </div>
      </div>
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

  document.getElementById("modal").style.display = "none";
};

// OPEN FORM
window.openForm = () => {
  document.getElementById("modal").style.display = "block";
};
