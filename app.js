// FIREBASE CONFIG
const firebaseConfig = {
 apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
 authDomain: "jobmarketfuture.firebaseapp.com",
 databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
 projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

let currentUser = null;

auth.onAuthStateChanged(user=>{
 currentUser = user;
});

// MAP INIT
let map = L.map("map").setView([3.848,11.502],13);

L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
 subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let userCoords = null;
let routeControl = null;

// GPS
navigator.geolocation.watchPosition(pos=>{
 userCoords = {
  lat: pos.coords.latitude,
  lng: pos.coords.longitude
 };
});

// LOAD JOBS
db.ref("jobs").on("value",snap=>{

 let jobs=[];

 snap.forEach(d=>{
  let j=d.val();
  j.id=d.key;

  if(userCoords){
   j.distance = getDistance(userCoords.lat,userCoords.lng,j.lat,j.lng);
  }

  jobs.push(j);
 });

 jobs.sort((a,b)=>a.distance-b.distance);

 renderMap(jobs);
});

// RENDER MAP
function renderMap(jobs){

 map.eachLayer(l=>{
  if(l instanceof L.Marker || l instanceof L.CircleMarker){
   map.removeLayer(l);
  }
 });

 jobs.slice(0,50).forEach(j=>{

  let marker = L.circleMarker([j.lat,j.lng],{
   radius:10,
   color:"white",
   weight:2,
   fillColor:"gold",
   fillOpacity:1
  }).addTo(map);

  marker.bindPopup(`
    <b>${j.title}</b><br>
    ${j.price || ""}<br>

    <a href="https://wa.me/${j.phone}" target="_blank">WhatsApp</a><br>
    <a href="tel:${j.phone}">Appeler</a><br>

    <button onclick="drawRoute(${j.lat},${j.lng})">Itinéraire</button>
  `);

 });
}

// ADD JOB
function addJob(){

 if(!currentUser){
  alert("Connecte-toi");
  return;
 }

 navigator.geolocation.getCurrentPosition(pos=>{

  db.ref("jobs").push({
   title: document.getElementById("title").value,
   price: document.getElementById("price").value,
   phone: document.getElementById("phone").value,
   lat: pos.coords.latitude,
   lng: pos.coords.longitude,
   user: currentUser.uid,
   createdAt: Date.now()
  });

  toggleForm();

 });
}

// ROUTE
function drawRoute(lat,lng){

 if(!userCoords){
  alert("Active GPS");
  return;
 }

 if(routeControl){
  map.removeControl(routeControl);
 }

 routeControl = L.Routing.control({
  waypoints:[
   L.latLng(userCoords.lat,userCoords.lng),
   L.latLng(lat,lng)
  ],
  createMarker:()=>null
 }).addTo(map);
}

// DISTANCE
function getDistance(lat1,lon1,lat2,lon2){
 const R=6371;
 const dLat=(lat2-lat1)*Math.PI/180;
 const dLon=(lon2-lon1)*Math.PI/180;
 const a=Math.sin(dLat/2)**2+
 Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
 Math.sin(dLon/2)**2;
 return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// UI
function toggleForm(){
 document.getElementById("formBox").classList.toggle("hidden");
}

function showMap(){
 document.getElementById("map").style.display="block";
 document.getElementById("jobsList").classList.add("hidden");
}

function showList(){

 document.getElementById("map").style.display="none";
 let box = document.getElementById("jobsList");
 box.classList.remove("hidden");

 box.innerHTML = "<h2>Jobs proches</h2>";

 navigator.geolocation.getCurrentPosition(pos=>{

  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;

  db.ref("jobs").once("value",snap=>{

   let jobs=[];

   snap.forEach(d=>{
    let j=d.val();
    j.distance = getDistance(lat,lng,j.lat,j.lng);
    jobs.push(j);
   });

   jobs.sort((a,b)=>a.distance-b.distance);

   jobs.forEach(j=>{

    box.innerHTML += `
    <div style="background:#111;padding:10px;margin:10px;border-radius:10px">
      <b>${j.title}</b><br>
      ${j.distance.toFixed(1)} km<br>
      ${j.price}<br>

      <a href="https://wa.me/${j.phone}">WhatsApp</a>
      <a href="tel:${j.phone}">Appel</a>
    </div>
    `;
   });

  });

 });
     }
