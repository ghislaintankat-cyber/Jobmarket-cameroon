// MAP INIT
let map = L.map('map').setView([3.848, 11.502], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// USER POSITION
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(pos => {
    let lat = pos.coords.latitude;
    let lng = pos.coords.longitude;

    map.setView([lat, lng], 15);

    L.circle([lat, lng], {
      radius: 30
    }).addTo(map);

    L.marker([lat, lng]).addTo(map)
      .bindPopup("Vous êtes ici")
      .openPopup();

  });
}

// JOB DATA (exemple)
let jobs = [
  {
    title: "Plombier",
    lat: 3.85,
    lng: 11.50,
    image: "https://via.placeholder.com/100"
  },
  {
    title: "Électricien",
    lat: 3.86,
    lng: 11.51,
    image: "https://via.placeholder.com/100"
  }
];

// DISPLAY JOBS
let jobsList = document.getElementById("jobsList");

jobs.forEach(job => {

  let div = document.createElement("div");
  div.className = "job-card";

  div.innerHTML = `
    <img src="${job.image}">
    <h4>${job.title}</h4>
    <button onclick="showOnMap(${job.lat}, ${job.lng})">Voir</button>
    <button onclick="getRoute(${job.lat}, ${job.lng})">Itinéraire</button>
    <button onclick="boost()">Boost 💰</button>
  `;

  jobsList.appendChild(div);
});

// MAP ACTIONS
function showOnMap(lat, lng) {
  map.setView([lat, lng], 16);

  L.marker([lat, lng]).addTo(map)
    .bindPopup("Job ici")
    .openPopup();

  showScreen('map');
}

function getRoute(lat, lng) {
  alert("Guidage activé (à connecter à API de routing)");
}

// BOOST PAYMENT (SIMULATION)
function boost() {
  alert("Paiement Boost en cours...");
}

// CENTER MAP
function centerMap() {
  map.setView([3.848, 11.502], 13);
}

// SCREEN SWITCH
function showScreen(screen) {

  document.querySelectorAll('.jobs, .account').forEach(el => {
    el.classList.remove('active-screen');
  });

  if (screen === 'jobs') {
    document.getElementById('jobs').classList.add('active-screen');
  }

  if (screen === 'account') {
    document.getElementById('account').classList.add('active-screen');
  }

  if (screen === 'map') {
    map.invalidateSize();
  }
      }
