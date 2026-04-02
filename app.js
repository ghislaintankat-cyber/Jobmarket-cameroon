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

// SATELLITE
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}').addTo(map);

let userLat, userLng;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng], { radius:8, color:"blue" }).addTo(map);
  map.setView([userLat, userLng], 12);
});

// LOAD JOBS
onValue(ref(db, 'jobs'), snapshot => {

  const data = snapshot.val();
  if (!data) return;

  map.eachLayer(l => { if (l instanceof L.Marker) map.removeLayer(l); });

  let jobs = Object.entries(data).map(([id, j]) => ({ id, ...j }));

  // BOOST FIRST
  jobs.sort((a,b)=> (b.boosted===true)-(a.boosted===true));

  jobs.forEach(job => {

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      ${job.description}<br>

      <div class="actions">
        <a href="tel:${job.phone}" class="call">📞</a>
        <a href="https://wa.me/237${job.phone}" target="_blank" class="whatsapp">💬</a>
      </div>

      <button class="boost" onclick="boostJob('${job.id}')">
        🚀 Booster
      </button>
    `);

  });

});

// CREATE
window.createJob = () => {

  const title = document.getElementById("title").value;
  const desc = document.getElementById("desc").value;
  const phone = document.getElementById("phone").value;

  if (!title || !desc || !phone) return alert("Remplis tout");

  navigator.geolocation.getCurrentPosition(pos => {

    push(ref(db, 'jobs'), {
      title,
      description: desc,
      phone,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      boosted: false
    });

    alert("Publié !");
  });
};

// BOOST
window.boostJob = async (jobId) => {

  const email = prompt("Ton email");
  if (!email) return;

  const res = await fetch("https://TON-BACKEND.onrender.com/pay", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ jobId, amount:500, email })
  });

  const data = await res.json();

  if (data.status==="success") {
    window.location.href = data.link;
  }
};
