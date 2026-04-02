import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSy...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// 🛰️ Satellite + noms
L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

L.tileLayer(
'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

// USER POSITION
let userLat, userLng;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], {
    radius: 8,
    color: "blue"
  }).addTo(map);

  map.setView([userLat, userLng], 12);
});

// LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  // clean markers
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  Object.values(data).forEach(job => {

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      ${job.description}<br><br>

      <div class="actions">
        <a href="tel:${job.phone}" class="call">📞</a>
        <a href="https://wa.me/237${job.phone}" target="_blank" class="whatsapp">💬</a>
      </div>
    `);

  });

});

// CREATE JOB
window.createJob = () => {

  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;
  const phone = document.getElementById("phone").value;

  if (!title || !desc || !phone) {
    alert("Remplis tout");
    return;
  }

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      phone,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });

    alert("Publié !");
  });

};
