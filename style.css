// FIREBASE
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.appspot.com",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// MAP
const map = L.map('map').setView([3.848, 11.502], 6);

// MAP STYLE (satellite + noms)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png').addTo(map);

let userPosition = null;

// GPS
navigator.geolocation.watchPosition(pos => {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  userPosition = [lat, lng];

  L.circle([lat, lng], {
    radius: 20,
    color: "blue"
  }).addTo(map);

}, err => console.log(err));

// 📌 LOAD JOBS
const jobsRef = ref(db, "jobs");

onValue(jobsRef, snapshot => {
  const data = snapshot.val();

  if (!data) return;

  Object.entries(data).forEach(([id, job]) => {

    const marker = L.marker([job.lat, job.lng]).addTo(map);

    marker.on('click', () => {
      openJobCard(job, id);
    });
  });
});

// 🧾 CARD UI
function openJobCard(job, id) {

  let imagesHTML = "";
  if (job.images) {
    job.images.forEach(img => {
      imagesHTML += `<img src="${img}" style="width:80px;border-radius:8px;margin:5px;">`;
    });
  }

  const card = document.createElement("div");
  card.className = "job-card";

  card.innerHTML = `
    <h3>${job.title}</h3>
    <p>⭐ ${job.rating || 5}</p>

    <div>${imagesHTML}</div>

    <button onclick="callUser('${job.phone}')">📞 Appeler</button>
    <button onclick="whatsappUser('${job.phone}')">💬 WhatsApp</button>
    <button onclick="startRoute(${job.lat}, ${job.lng})">🧭 Itinéraire</button>
    <button onclick="boostJob('${id}')">🚀 Booster</button>
  `;

  document.body.appendChild(card);
}

// 📞 CALL
window.callUser = (phone) => {
  window.location.href = `tel:${phone}`;
};

// 💬 WHATSAPP
window.whatsappUser = (phone) => {
  window.open(`https://wa.me/${phone}`);
};

// 🧭 ITINERAIRE + VOIX
let routeLine;

window.startRoute = (lat, lng) => {

  if (!userPosition) {
    alert("Position inconnue");
    return;
  }

  if (routeLine) map.removeLayer(routeLine);

  routeLine = L.polyline([userPosition, [lat, lng]], {
    color: "red"
  }).addTo(map);

  map.fitBounds(routeLine.getBounds());

  speak("Itinéraire démarré. Avancez vers votre destination");
};

// 🔊 VOIX
function speak(text) {
  const msg = new SpeechSynthesisUtterance(text);
  msg.lang = "fr-FR";
  speechSynthesis.speak(msg);
}

// 🚀 BOOST (simulation paiement)
window.boostJob = (id) => {
  alert("Paiement boost en cours...");
  // ici tu connecteras Flutterwave plus tard
};

// ➕ AJOUT JOB AVEC IMAGE
window.addJob = () => {

  navigator.geolocation.getCurrentPosition(pos => {

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    const newJob = {
      title: "Service Pro",
      phone: "237690000000",
      lat,
      lng,
      rating: 5,
      images: [
        "https://via.placeholder.com/150",
        "https://via.placeholder.com/150"
      ]
    };

    push(jobsRef, newJob);

    alert("✅ Job avec photos publié !");
  });
};
