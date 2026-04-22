// 🔥 FIREBASE CONFIG (OK à exposer mais protège avec rules)
const firebaseConfig = {
 apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
 authDomain: "jobmarketfuture.firebaseapp.com",
 databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
 projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// 🔐 ADMIN UID
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let currentUser = null;

auth.signInAnonymously();

auth.onAuthStateChanged(user => {
 currentUser = user;

 if(isAdmin()){
  document.getElementById("adminBtn").classList.remove("hidden");
 }
});

function isAdmin(){
 return currentUser && currentUser.uid === ADMIN_UID;
}

// 🗺️ MAP
let map = L.map("map").setView([3.848,11.502],13);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
 subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let routeControl;

// 📍 GPS
navigator.geolocation.watchPosition(pos=>{
 userCoords = {
  lat: pos.coords.latitude,
  lng: pos.coords.longitude
 };
});

// ➕ AJOUT JOB
function addJob(){

 if(!currentUser) return alert("Connexion...");

 let title = document.getElementById("title").value;
 let price = document.getElementById("price").value;
 let phone = document.getElementById("phone").value;

 navigator.geolocation.getCurrentPosition(pos=>{

  let ref = db.ref("jobs").push();

  ref.set({
   id: ref.key,
   title, price, phone,
   lat: pos.coords.latitude,
   lng: pos.coords.longitude,
   user: currentUser.uid,
   rating:0,
   ratingCount:0
  });

 });

}

// 📦 LOAD JOBS
db.ref("jobs").on("value", snap=>{

 jobsLayer.clearLayers();

 snap.forEach(d=>{

  let j = d.val();

  let marker = L.marker([j.lat,j.lng]).addTo(jobsLayer);

  marker.bindPopup(`
  <b>${j.title}</b><br>
  ${j.price}<br>
  ⭐ ${getStars(j.rating,j.ratingCount)}

  <br><br>

  <a href="https://wa.me/${j.phone}">WhatsApp</a><br>
  <a href="tel:${j.phone}">Appeler</a><br>

  <button onclick="drawRoute(${j.lat},${j.lng})">Itinéraire</button>

  ${isAdmin() || currentUser?.uid === j.user ?
  `<button onclick="deleteJob('${j.id}')" style="background:red;color:white">Supprimer</button>` : ""}

  `);

 });

});

// 🗑️ DELETE
function deleteJob(id){
 db.ref("jobs/"+id).remove();
}

// ⭐ RATING
function getStars(r,c){
 if(!c) return "☆☆☆☆☆";
 let avg=r/c;
 return "★".repeat(Math.round(avg));
}

// 🧭 ROUTE
function drawRoute(lat,lng){

 if(!userCoords) return alert("Active GPS");

 if(routeControl) map.removeControl(routeControl);

 routeControl = L.Routing.control({
  waypoints:[
   L.latLng(userCoords.lat,userCoords.lng),
   L.latLng(lat,lng)
  ],
  createMarker:()=>null
 }).addTo(map);

}

// 📄 LISTE TRIÉE
function showList(){

 document.getElementById("jobsList").classList.remove("hidden");

 navigator.geolocation.getCurrentPosition(pos=>{

  let lat=pos.coords.latitude;
  let lng=pos.coords.longitude;

  db.ref("jobs").once("value", snap=>{

   let arr=[];

   snap.forEach(d=>{
    let j=d.val();
    let dist=getDistance(lat,lng,j.lat,j.lng);
    arr.push({...j,dist});
   });

   arr.sort((a,b)=>a.dist-b.dist);

   let html="";

   arr.forEach(j=>{
    html+=`
    <div>
    <b>${j.title}</b> (${j.dist.toFixed(1)} km)<br>
    ${j.price}
    </div><hr>`;
   });

   document.getElementById("jobsList").innerHTML=html;

  });

 });

}

function getDistance(a,b,c,d){
 let R=6371;
 let dLat=(c-a)*Math.PI/180;
 let dLon=(d-b)*Math.PI/180;
 let x=Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
 return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));
}

// 🛠 ADMIN PANEL
function openAdmin(){
 document.getElementById("adminPanel").classList.remove("hidden");
}

function loadAdminJobs(){

 const c = document.getElementById("adminContent");
 c.innerHTML="Chargement...";

 db.ref("jobs").once("value", snap=>{
  c.innerHTML="";
  snap.forEach(d=>{
   let j=d.val();
   c.innerHTML+=`
   <div>
   ${j.title}
   <button onclick="deleteJob('${j.id}')">❌</button>
   </div>`;
  });
 });

}

function loadUsers(){

 const c = document.getElementById("adminContent");
 let users={};

 db.ref("jobs").once("value", snap=>{
  snap.forEach(d=>{
   let j=d.val();
   if(j.user) users[j.user]=true;
  });

  c.innerHTML="<h3>Users</h3>";

  Object.keys(users).forEach(u=>{
   c.innerHTML+=`<div>${u}</div>`;
  });

 });

}

// UI
function showMap(){
 document.getElementById("jobsList").classList.add("hidden");
}

function toggleForm(){
 document.getElementById("formBox").classList.toggle("hidden");
      }
