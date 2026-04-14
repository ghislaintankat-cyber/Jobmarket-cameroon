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

// 👤 USER
function setName(){
  let name = prompt("Ton nom ?");
  localStorage.setItem("user", name);
  document.getElementById("username").innerText = name;
}

document.getElementById("username").innerText = localStorage.getItem("user") || "Guest";

// 🗺️ MAP
let map = L.map("map").setView([3.848,11.502],18);

L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}").addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png").addTo(map);

// 📍 GPS
let userMarker;

navigator.geolocation.watchPosition(pos=>{
  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;

  map.setView([lat,lng],19);

  if(userMarker){
    userMarker.setLatLng([lat,lng]);
  }else{
    userMarker = L.circleMarker([lat,lng],{radius:10,color:"blue"}).addTo(map);
  }
});

// ➕ FORM
function openForm(){
  formBox.classList.toggle("hidden");
}

// 💾 ADD JOB
function addJob(){

  if(!title.value || !desc.value){
    alert("Remplis les champs !");
    return;
  }

  navigator.geolocation.getCurrentPosition(pos=>{

    let file = image.files[0];

    if(file){
      let ref = storage.ref("jobs/"+Date.now());
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

  let job = {
    name: localStorage.getItem("user") || "Anonyme",
    title: title.value,
    desc: desc.value,
    price: price.value,
    phone: phone.value,
    img: img,
    boost: boost.checked,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude
  };

  db.ref("jobs").push(job);

  alert("✅ Job publié");
}

// 🔄 LOAD JOBS
let markers=[];

db.ref("jobs").on("value",snap=>{

  markers.forEach(m=>map.removeLayer(m));
  markers=[];

  snap.forEach(d=>{

    let j=d.val();
    let color = j.boost ? "gold" : "green";

    let m = L.circleMarker([j.lat,j.lng],{
      radius:10,
      color:color
    }).addTo(map);

    m.bindPopup(`
      <b>${j.title}</b><br>
      👤 ${j.name}<br>
      ${j.desc}<br>
      💰 ${j.price}<br>
      ${j.img ? `<img src="${j.img}" width="100%">` : ""}<br>
      <a href="https://wa.me/${j.phone}">WhatsApp</a>
    `);

    markers.push(m);
  });

});

// 📍 CENTER
function centerMap(){
  if(userMarker){
    map.setView(userMarker.getLatLng(),19);
  }
  }
