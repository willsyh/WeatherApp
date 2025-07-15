const apiKey = "5e03ccf5957c4ec895e62947251307";
const city = "Jakarta";

function getIconEmoji(code, isNight) {
  if ([1000].includes(code)) return isNight ? "🌙" : "☀️";
  if ([1003].includes(code)) return isNight ? "🌤️" : "🌤️";
  if ([1006, 1009].includes(code)) return "☁️";
  if ([1030, 1135, 1147].includes(code)) return "🌫️";
  if ([1063, 1150, 1153, 1180, 1183, 1240].includes(code)) return isNight ? "🌧️" : "🌦️";
  if ([1186, 1189, 1192, 1195, 1243, 1246].includes(code)) return "🌧️";
  if ([1066, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258].includes(code)) return "❄️";
  if ([1069, 1072, 1168, 1171, 1204, 1207, 1237, 1249, 1252, 1261, 1264].includes(code)) return "🌨️";
  if ([1087, 1273, 1276, 1279, 1282].includes(code)) return "⛈️";
  return "🌡️";
}

function isNight(hour) {
  return hour >= 18 || hour < 6;
}

function getWeatherByCity(city) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${city}&days=4&lang=id`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      const current = data.current;
      const forecast = data.forecast.forecastday;
      const location = data.location.name;

      const date = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const now = new Date();
      const timeString = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
});
      
      const localHour = new Date(data.location.localtime).getHours();
      // const localHour = 22 // => untuk check manual
      const nightMode = isNight(localHour);
      const emoji = getIconEmoji(current.condition.code, nightMode);
      const card = document.querySelector(".weather-card");
      const sun = document.querySelector(".sun");
      const moon = document.querySelector(".moon");

      const body = document.body;

      if (nightMode) {
        card.classList.remove("day");
        card.classList.add("night");
        body.classList.remove("day");
        body.classList.add("night");
        sun.style.display = "none";
        moon.style.display = "block";
      } else {
        card.classList.remove("night");
        card.classList.add("day");
        body.classList.remove("night");
        body.classList.add("day");
        sun.style.display = "block";
        moon.style.display = "none";
      }

      document.querySelector(".city").textContent = location;
      document.querySelector(".date").textContent = date;
      document.querySelector(".clock").textContent = ` ${timeString}`;
      document.querySelector(".details-top").innerHTML = `
        <div class="humidity">💧 ${current.humidity}%</div>
        <div class="wind">💨 ${current.wind_kph} km/h</div>
      `;
      document.querySelector(".weather-icon").textContent = emoji;
      document.querySelector(".temperature").textContent = `${current.temp_c}°C`;

      showForecast(forecast.slice(1, 4));
    })
    .catch((err) => {
      document.querySelector(".city").textContent = "Gagal memuat data";
      console.error(err);
    });
}

function showForecast(forecastDays) {
  const now = new Date();
  const hour = now.getHours();
  const localHour = isNight(hour);
  // const localHour = 22; // => untuk check manual

  const html = forecastDays
    .map((day) => {
      const emoji = getIconEmoji(day.day.condition.code, localHour);
      const label = new Date(day.date).toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      return `
        <div class="forecast-item">
          <div class="weather-day">${label.split(",")[0]}</div>
          <div class="weather-icon">${emoji}</div>
          <div class="temperature-card">${day.day.avgtemp_c}°C</div>
        </div>
      `;
    })
    .join("");

  document.getElementById("forecast").innerHTML = `<div class="forecast-grid">${html}</div>`;
}


window.onload = () => {
  getWeatherByCity(city);
};
