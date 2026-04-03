import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
getDatabase,
ref,
onValue,
push,
remove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

import {
getAuth,
signInWithPopup,
GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// CONFIG
const firebaseConfig = {
apiKey: "AIzaSy...",
authDomain: "jobmarketfuture.firebaseapp.com",
databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
projectId: "jobmarketfuture"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// 🛰️ Satellite + noms
const satellite = L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
{ maxZoom: 19 }
).addTo(map);

const labels = L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
{ opacity: 0.5 }
).addTo(map);

// USER POSITION
let userLat, userLng;

navigator.geolocation.watchPosition(pos => {
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
function distance(lat1, lon1, lat2, lon2) {
const R = 6371;
const dLat = (lat2 - lat1) * Math.PI/180;
const dLon = (lon2 - lon1) * Math.PI/180;

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

const panel = document.getElementById("jobsPanel");
panel.innerHTML = "";

Object.keys(data).forEach(id => {

const job = data[id];

const dist = userLat ? distance(userLat, userLng, job.lat, job.lng) : "?";

const marker = L.marker([job.lat, job.lng]).addTo(map);

marker.bindPopup(`
<b>${job.title}</b><br>
⭐ ${job.rating || 4.5} • ${dist} km<br>
<button onclick="call('${job.phone}')">Appeler</button>
<button onclick="whatsapp('${job.phone}')">WhatsApp</button>
<button onclick="route(${job.lat},${job.lng})">Itinéraire</button>
`);

panel.innerHTML += `
<div class="job-card">
<b>${job.title}</b><br>
⭐ ${job.rating || 4.5} • ${dist} km<br>
<button onclick="call('${job.phone}')">📞</button>
<button onclick="whatsapp('${job.phone}')">💬</button>
</div>
`;

});
});

// CREATE JOB
window.createJob = () => {

const title = prompt("Titre ?");
const phone = prompt("Téléphone ?");

navigator.geolocation.getCurrentPosition(pos => {

push(ref(db, 'jobs'), {
title,
phone,
lat: pos.coords.latitude,
lng: pos.coords.longitude,
rating: 5
});

});
};

// CALL
window.call = phone => {
window.location.href = `tel:${phone}`;
};

// WHATSAPP
window.whatsapp = phone => {
window.open(`https://wa.me/${phone}`);
};

// ROUTE (simple)
window.route = (lat, lng) => {
window.open(`https://www.google.com/maps/dir/${userLat},${userLng}/${lat},${lng}`);
};

// AUTH GOOGLE
window.loginGoogle = () => {
const provider = new GoogleAuthProvider();
signInWithPopup(auth, provider);
};

// ADMIN
window.becomeAdmin = () => {
const code = prompt("Code admin ?");
if (code === "237BO") {
alert("Admin activé");
window.admin = true;
}
};

// NAVIGATION
window.showJobs = () => {
document.getElementById("jobsPanel").classList.remove("hidden");
document.getElementById("accountPanel").classList.add("hidden");
};

window.showAccount = () => {
document.getElementById("accountPanel").classList.remove("hidden");
document.getElementById("jobsPanel").classList.add("hidden");
};

window.showMap = () => {
document.getElementById("jobsPanel").classList.add("hidden");
document.getElementById("accountPanel").classList.add("hidden");
};
