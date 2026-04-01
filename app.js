import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSy...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const map = L.map('map').setView([3.848, 11.502], 6);

// 🛰️ Satellite + noms lieux
L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

L.tileLayer(
'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

const markers = L.markerClusterGroup();
map.addLayer(markers);

let userLat, userLng;
let allJobs = {};
let currentFilter = "all";

// USER
navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], { radius: 8, color: "blue" }).addTo(map);
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

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// LOAD
onValue(ref(db, 'jobs'), snapshot => {
  allJobs = snapshot.val() || {};
  applyFilters();
  document.getElementById("loader").style.display = "none";
});

// FILTER
window.filterJobs = (e, type) => {
  currentFilter = type;

  document.querySelectorAll(".filter").forEach(el => el.classList.remove("active"));
  e.target.classList.add("active");

  applyFilters();
};

// SEARCH
document.getElementById("search").addEventListener("input", e => {
  applyFilters(e.target.value.toLowerCase());
});

function applyFilters(search = "") {

  let filtered = Object.values(allJobs);

  if (currentFilter !== "all") {
    filtered = filtered.filter(j => j.title.toLowerCase().includes(currentFilter));
  }

  if (search) {
    filtered = filtered.filter(j => j.title.toLowerCase().includes(search));
  }

  if (userLat) {
    filtered.sort((a, b) =>
      getDistance(userLat, userLng, a.lat, a.lng) -
      getDistance(userLat, userLng, b.lat, b.lng)
    );
  }

  displayJobs(filtered);
}

// DISPLAY
function displayJobs(jobs) {

  markers.clearLayers();

  jobs.forEach((job, i) => {

    const distance = userLat
      ? getDistance(userLat, userLng, job.lat, job.lng).toFixed(1)
      : "?";

    const marker = L.marker([job.lat, job.lng]);

    marker.bindPopup(`
      <div class="job-card">
        <div>
          <b>${job.title}</b><br>
          ${job.description}<br>
          ⭐ 4.8 • ${distance} km
          ${i === 0 ? "<br><b style='color:green'>🔥 Plus proche</b>" : ""}
        </div>
      </div>
    `);

    marker.on("click", () => {
      map.flyTo([job.lat, job.lng], 14);
    });

    markers.addLayer(marker);

  });

}

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
  if (userLat) map.flyTo([userLat, userLng], 15);
};
