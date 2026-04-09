// 🔥 FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 🗺️ MAP
let map = L.map("map", {
  zoomControl: false
}).setView([3.848, 11.502], 19);

// 🌍 SATELLITE + NOMS
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
);

const labels = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
);

satellite.addTo(map);
labels.addTo(map);

// 📍 GPS
let userMarker;

navigator.geolocation.watchPosition(pos => {

  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;

  map.setView([lat, lng], 19);

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 10,
      color: "blue"
    }).addTo(map);
  }

});

// ➕ FORM
function openForm() {
  document.getElementById("formBox").classList.toggle("hidden");
}

// 💾 ADD JOB
function addJob() {

  navigator.geolocation.getCurrentPosition(pos => {

    let job = {
      title: document.getElementById("title").value,
      desc: document.getElementById("desc").value,
      price: document.getElementById("price").value,
      phone: document.getElementById("phone").value,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };

    db.ref("jobs").push(job);

    alert("✅ Job publié !");
  });

}

// 🔄 LOAD JOBS
let markers = [];

function loadJobs() {

  db.ref("jobs").on("value", snap => {

    markers.forEach(m => map.removeLayer(m));
    markers = [];

    snap.forEach(d => {

      let j = d.val();

      let m = L.marker([j.lat, j.lng]).addTo(map);

      m.bindPopup(`
        <b>${j.title}</b><br>
        ${j.desc}<br>
        💰 ${j.price}<br><br>
        <a href="https://wa.me/${j.phone}?text=Je viens de JobMarket">📲 WhatsApp</a>
      `);

      markers.push(m);
    });

  });

}

// 🤖 IA FINAL (SANS ERREUR)
async function askAI() {

  let msg = prompt("Décris ton job");

  if (!msg) return;

  try {

    let res = await fetch("https://jobmarket-backend-6gqm.onrender.com/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: msg })
    });

    let data = await res.json();

    if (data.reply) {

      alert(data.reply);

      document.getElementById("title").value = msg;
      document.getElementById("desc").value = data.reply;

    } else {
      alert("Erreur IA ⚠️");
    }

  } catch (e) {
    alert("Connexion IA échouée ❌");
  }

}

// 💰 BOOST
function payBoost() {

  FlutterwaveCheckout({
    public_key: "FLWPUBK_TEST-a33eb7e6188f8560b4fbda00d8c07304-X",
    tx_ref: Date.now(),
    amount: 500,
    currency: "XAF",
    customer: {
      email: "user@gmail.com"
    },
    callback: function () {
      alert("🚀 Boost activé !");
    }
  });

}

// 📍 CENTER
function centerMap() {
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 19);
  }
}

// 🚀 START
loadJobs();
