const map = L.map('map').setView([3.8, 11.5], 6);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')
.addTo(map);

let userLat, userLng;

/* POSITION */
navigator.geolocation.getCurrentPosition(pos=>{
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  map.setView([userLat,userLng],12);
});

/* CREATE JOB */
window.createJob = async ()=>{

  const title = prompt("Titre");
  const desc = prompt("Description");
  const phone = prompt("Téléphone");

  await fetch("http://localhost:3000/create-job",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      title,
      description:desc,
      phone,
      lat:userLat,
      lng:userLng
    })
  });

};

/* GO TO USER */
window.goToUser = ()=>{
  map.flyTo([userLat,userLng],15);
};
