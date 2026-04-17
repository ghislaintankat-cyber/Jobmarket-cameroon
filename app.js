// 🔥 CONFIGURATION FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// 👑 TON IDENTITÉ ADMIN
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";
let currentUser = null;

// Vérification de connexion
auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    console.log("Connecté en tant que:", user.uid);
  }
});

// 🔐 AUTHENTIFICATION
window.register = () => {
  const email = document.getElementById('email').value;
  const pass = document.getElementById('password').value;
  auth.createUserWithEmailAndPassword(email, pass).catch(alert);
};

window.login = () => {
  const email = document.getElementById('email').value;
  const pass = document.getElementById('password').value;
  auth.signInWithEmailAndPassword(email, pass).then(() => alert("Connecté !")).catch(alert);
};

// 🗺️ CONFIGURATION DE LA CARTE (SATELLITE HD)
let map = L.map("map", { zoomControl: false }).setView([3.848, 11.502], 14);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19
}).addTo(map);

// GPS Temps Réel
let userMarker;
navigator.geolocation.watchPosition(pos => {
  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], { radius: 10, color: "white", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
  }
}, null, { enableHighAccuracy: true });

// ➕ PUBLIER UN JOB
window.toggleForm = () => {
  if (!currentUser) return alert("Connectez-vous d'abord dans l'onglet Profil.");
  document.getElementById('formBox').classList.toggle("hidden");
};

window.addJob = () => {
  const title = document.getElementById('title').value;
  const desc = document.getElementById('desc').value;
  const price = document.getElementById('price').value;
  const phone = document.getElementById('phone').value;

  if (!title || !phone) return alert("Le titre et le téléphone sont obligatoires.");

  navigator.geolocation.getCurrentPosition(pos => {
    let ref = db.ref("jobs").push();
    ref.set({
      id: ref.key,
      title: title,
      desc: desc,
      price: price,
      phone: phone,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      user: currentUser.uid,
      time: Date.now()
    }).then(() => {
      alert("✅ Job publié !");
      document.getElementById('formBox').classList.add("hidden");
    });
  });
};

// 📍 CHARGEMENT DES MARQUEURS SUR LA CARTE
db.ref("jobs").on("value", snap => {
  // On nettoie la carte (sauf le point bleu GPS)
  map.eachLayer(layer => { if (layer instanceof L.Marker) map.removeLayer(layer); });
  
  snap.forEach(d => {
    let j = d.val();
    let marker = L.marker([j.lat, j.lng]).addTo(map);
    marker.bindPopup(`
      <div style="color:#000; min-width:150px">
        <b>${j.title}</b><br>
        <p>${j.price} FCFA</p>
        <a href="https://wa.me/237${j.phone}" style="display:block; background:#25D366; color:white; text-align:center; padding:8px; border-radius:5px; text-decoration:none; margin-top:5px; font-weight:bold">WhatsApp</a>
      </div>
    `);
  });
});

// 📄 LISTE DES JOBS AVEC BOUTON SUPPRIMER (POUR ADMIN)
window.loadJobsList = () => {
  const list = document.getElementById('jobsList');
  list.innerHTML = "<h2 style='padding:20px'>Missions à proximité</h2>";

  db.ref("jobs").orderByChild("time").limitToLast(50).once("value", snap => {
    snap.forEach(d => {
      let j = d.val();
      
      // Condition de suppression : Si c'est ton job OU si tu es l'ADMIN
      const canDelete = (currentUser && (currentUser.uid === j.user || currentUser.uid === ADMIN_UID));

      list.innerHTML += `
        <div style="background:#222; margin:15px; padding:20px; border-radius:15px; border:1px solid #333">
          <b style="font-size:18px; color:#FFD700">${j.title}</b><br>
          <p style="color:#ccc; margin:10px 0">${j.desc || 'Pas de description'}</p>
          <span style="color:#FFD700; font-weight:bold">${j.price} FCFA</span>
          <div style="display:flex; gap:10px; margin-top:15px">
            <a href="https://wa.me/237${j.phone}" style="background:#25D366; color:white; padding:10px; border-radius:8px; text-decoration:none; flex:1; text-align:center; font-weight:bold">WhatsApp</a>
            ${canDelete ? `<button onclick="deleteJob('${j.id}')" style="background:#EF4444; color:white; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:bold">Supprimer</button>` : ""}
          </div>
        </div>
      `;
    });
  });
};

// 🗑️ FONCTION DE SUPPRESSION
window.deleteJob = (id) => {
  if (confirm("Voulez-vous vraiment supprimer cette annonce ?")) {
    db.ref("jobs/" + id).remove().then(() => {
      alert("Supprimé !");
      loadJobsList(); // Rafraîchir la liste
    });
  }
};

// 🧭 NAVIGATION ENTRE LES ONGLETS
window.showMap = () => {
  hideAll();
  document.getElementById('map').style.display = "block";
};

window.showList = () => {
  hideAll();
  document.getElementById('jobsList').classList.remove("hidden");
  loadJobsList();
};

window.showChat = () => {
  hideAll();
  document.getElementById('chatBox').classList.remove("hidden");
};

window.showAccount = () => {
  hideAll();
  document.getElementById('accountBox').classList.remove("hidden");
};

function hideAll() {
  document.getElementById('map').style.display = "none";
  document.getElementById('jobsList').classList.add("hidden");
  document.getElementById('chatBox').classList.add("hidden");
  document.getElementById('accountBox').classList.add("hidden");
  document.getElementById('formBox').classList.add("hidden");
      }
