// 🔥 FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.appspot.com"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const storage = firebase.storage();

// 🗺️ MAP
let map = L.map("map").setView([3.848,11.502],15);

L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{
  maxZoom:19
}).addTo(map);

let userMarker;
let markers=[];

// 📍 GPS OPTIMISÉ
navigator.geolocation.watchPosition(pos=>{
  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;

  if(userMarker){
    userMarker.setLatLng([lat,lng]);
  }else{
    userMarker = L.circleMarker([lat,lng],{radius:8,color:"blue"}).addTo(map);
  }

}, {enableHighAccuracy:true, maximumAge:5000});

// ➕ FORM
function openForm(){
  formBox.classList.toggle("hidden");
}

// 📏 DISTANCE
function getDistance(a,b,c,d){
  let R=6371;
  let dLat=(c-a)*Math.PI/180;
  let dLon=(d-b)*Math.PI/180;

  let x=Math.sin(dLat/2)**2+
  Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*
  Math.sin(dLon/2)**2;

  return (R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))).toFixed(2);
}

// 💾 ADD JOB
function addJob(){

  navigator.geolocation.getCurrentPosition(pos=>{

    let file=image.files[0];

    if(file){
      let ref=storage.ref("jobs/"+Date.now());
      ref.put(file).then(()=>{
        ref.getDownloadURL().then(url=>{
          saveJob(url,pos);
        });
      });
    }else{
      saveJob("",pos);
    }

  });
}

function saveJob(img,pos){

  let job={
    title:title.value,
    desc:desc.value,
    price:price.value,
    phone:phone.value,
    img:img,
    boost:boost.checked,
    lat:pos.coords.latitude,
    lng:pos.coords.longitude,
    time:Date.now()
  };

  db.ref("jobs").push(job);

  alert("Job ajouté");
}

// 🔄 LOAD LIMITÉ (PERF)
function loadNearby(){

  navigator.geolocation.getCurrentPosition(userPos=>{

    db.ref("jobs").once("value",snap=>{

      markers.forEach(m=>map.removeLayer(m));
      markers=[];

      let jobs=[];

      snap.forEach(d=>{
        let j=d.val();

        j.distance=getDistance(
          userPos.coords.latitude,
          userPos.coords.longitude,
          j.lat,
          j.lng
        );

        jobs.push(j);
      });

      jobs.sort((a,b)=>a.distance-b.distance);

      jobs.slice(0,50).forEach(j=>{

        let m=L.marker([j.lat,j.lng]).addTo(map);

        m.bindPopup(`
        <b>${j.title}</b><br>
        ${j.distance} km<br>

        <a href="https://wa.me/${j.phone}">WhatsApp</a><br>
        <a href="tel:${j.phone}">Appeler</a>
        `);

        markers.push(m);
      });

    });

  });

}

// 📍 CENTER
function centerMap(){
  if(userMarker){
    map.setView(userMarker.getLatLng(),18);
  }
  }
