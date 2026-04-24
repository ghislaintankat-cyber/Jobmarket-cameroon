// FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// MAP
let map = L.map('map').setView([3.848,11.502],13);

L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
 subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let userCoords = null;
let routeControl;

// GPS LIVE
navigator.geolocation.watchPosition(pos=>{
 userCoords = {
   lat: pos.coords.latitude,
   lng: pos.coords.longitude
 };

 L.circleMarker([userCoords.lat,userCoords.lng],{
   radius:8,
   color:"#fff",
   fillColor:"#2196F3",
   fillOpacity:1
 }).addTo(map);

 loadJobs();

});

// GOLD MARKER
function goldIcon(){
 return L.divIcon({
   html:`<div style="width:25px;height:25px;background:gold;border-radius:50%;border:3px solid white;"></div>`,
   iconSize:[25,25],
   iconAnchor:[12,25]
 });
}

// LOAD JOBS
function loadJobs(){
 db.ref("jobs").once("value",snap=>{

   let jobs=[];

   snap.forEach(d=>{
     let j = d.val();
     j.id = d.key;

     if(userCoords){
       j.distance = getDistance(userCoords.lat,userCoords.lng,j.lat,j.lng);
     }

     jobs.push(j);
   });

   jobs.sort((a,b)=>a.distance-b.distance);

   displayJobsMap(jobs);
   displayList(jobs);

 });
}

// MAP DISPLAY
function displayJobsMap(jobs){

 map.eachLayer(layer=>{
   if(layer instanceof L.Marker) map.removeLayer(layer);
 });

 jobs.forEach(j=>{

   let m = L.marker([j.lat,j.lng],{icon:goldIcon()}).addTo(map);

   m.bindPopup(`
     <b>${j.title}</b><br>
     ${j.price}<br>
     ${j.distance ? j.distance.toFixed(1)+" km":""}

     <br><br>

     <a href="https://wa.me/${j.phone}" style="color:white;background:#25D366;padding:5px;border-radius:5px;display:block;text-align:center;margin-bottom:5px">WhatsApp</a>

     <a href="tel:${j.phone}" style="color:white;background:#1E90FF;padding:5px;border-radius:5px;display:block;text-align:center;margin-bottom:5px">Appel</a>

     <button onclick="drawRoute(${j.lat},${j.lng})" style="width:100%;background:red;color:white">Itinéraire</button>

     <button onclick="likeJob('${j.id}')">❤️ ${j.likes||0}</button>
   `);

 });

}

// LIST
function displayList(jobs){
 let list = document.getElementById("list");
 list.innerHTML="";

 jobs.forEach(j=>{
   list.innerHTML += `
   <div style="background:#222;margin:10px;padding:10px;border-radius:10px">

   <b>${j.title}</b><br>
   ${j.price}<br>
   ${j.distance ? j.distance.toFixed(1)+" km":""}

   <br>

   <a href="https://wa.me/${j.phone}" style="color:white;background:#25D366;padding:5px;border-radius:5px">WhatsApp</a>

   <a href="tel:${j.phone}" style="color:white;background:#1E90FF;padding:5px;border-radius:5px">Appel</a>

   </div>
   `;
 });
}

// ADD JOB
function addJob(){

 navigator.geolocation.getCurrentPosition(pos=>{

   db.ref("jobs").push({
     title: document.getElementById("title").value,
     price: document.getElementById("price").value,
     phone: document.getElementById("phone").value,
     lat: pos.coords.latitude,
     lng: pos.coords.longitude,
     likes:0
   });

   alert("Publié !");
 });

}

// LIKE
function likeJob(id){
 db.ref("jobs/"+id+"/likes").transaction(l=> (l||0)+1 );
}

// ROUTE
function drawRoute(lat,lng){

 if(!userCoords) return alert("Active GPS");

 if(routeControl) map.removeControl(routeControl);

 routeControl = L.Routing.control({
   waypoints:[
     L.latLng(userCoords.lat,userCoords.lng),
     L.latLng(lat,lng)
   ],
   lineOptions:{styles:[{color:"red",weight:5}]},
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

// NAV
function showMap(){
 document.getElementById("map").style.display="block";
 document.getElementById("list").classList.add("hidden");
}

function showList(){
 document.getElementById("map").style.display="none";
 document.getElementById("list").classList.remove("hidden");
}

function toggleForm(){
 document.getElementById("formBox").classList.toggle("hidden");
                                    }
