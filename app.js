// 🔥 FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();


// 🗺️ MAP INIT
let map = L.map("map", { zoomControl: false }).setView([3.848, 11.502], 19);

// 🌍 SATELLITE + LABELS
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
).addTo(map);

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
).addTo(map);


// 📍 GPS USER
let userMarker;

navigator.geolocation.watchPosition(pos => {

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  map.setView([lat, lng], 19);

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 10,
      color: "blue",
      fillColor: "blue",
      fillOpacity: 0.5
    }).addTo(map);
  }

});


// ➕ FORMULAIRE
function openForm() {
  document.getElementById("formBox").classList.toggle("hidden");
}


// 💾 AJOUT JOB
function addJob() {

  navigator.geolocation.getCurrentPosition(pos => {

    const job = {
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

      const j = d.val();

      const m = L.marker([j.lat, j.lng]).addTo(map);

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


// 🤖 IA (VERSION FINALE DEBUG + FIX)
async function askAI() {

  alert("IA ACTIVÉE 🚀"); // 🔥 TEST pour vérifier que le nouveau code est bien chargé

  const msg = prompt("Décris ton job");

  if (!msg) return;

  try {

    const res = await fetch("https://jobmarket-backend-6gqm.onrender.com/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: msg })
    });

    if (!res.ok) {
      alert("Serveur IA ne répond pas ❌");
      return;
    }

    const data = await res.json();

    if (data.reply) {

      alert(data.reply);

      document.getElementById("title").value = msg;
      document.getElementById("desc").value = data.reply;

    } else {
      alert("Erreur IA ⚠️ réponse vide");
    }

  } catch (e) {
    alert("Connexion IA échouée ❌");
    console.log(e);
  }

}


// 💰 BOOST
function payBoost() {

  FlutterwaveCheckout({
    public_key: "FLWPUBK_TEST-XXXX",
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


// 📍 RECENTRER
function centerMap() {
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 19);
  }
}


// 🚀 INIT
loadJobs();
