export function initMap() {
  const mapDiv = document.getElementById("map");

  mapDiv.innerHTML = "📍 Map loading...";

  navigator.geolocation.getCurrentPosition((pos) => {
    mapDiv.innerHTML = `
      <p>Latitude: ${pos.coords.latitude}</p>
      <p>Longitude: ${pos.coords.longitude}</p>
    `;
  });
}

initMap();
