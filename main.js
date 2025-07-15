const APIKEY = "5e03ccf5957c4ec895e62947251307";
const city = document.querySelector(".city").textContent;

function getIconEmoji(code, isNight) {
    if ([1000].includes(code)) return isNight ? "🌙" : "☀";
    if ([1003].includes(code)) return "🌤";
    if ([1006, 1009].includes(code)) return "☁";
    if ([1030, 1135, 1147].includes(code)) return "🌫";
    if ([1063, 1150, 1153, 1180, 1183, 1240].includes(code)) return isNight ? "🌧" : "🌦";
    if ([1186, 1189, 1192, 1195, 1243, 1246].includes(code)) return "🌧";
    if ([1066, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258].includes(code)) return "❄";
    if ([1069, 1072, 1168, 1171, 1204, 1207, 1237, 1249, 1252, 1261, 1264].includes(code)) return "❄";
    if ([1087, 1273, 1276, 1279, 1282].includes(code)) return "⛈";
    return "🌡";
}

function isNight(hour) {
    return hour >= 18 || hour < 8;
}

const regions = [
    { name: "Bandung", zone: "Asia/Jakarta" },
    { name: "Surabaya", zone: "Asia/Jakarta" },
    { name: "Ambon", zone: "Asia/Jayapura" },
    { name: "Banjarbaru", zone: "Asia/Makassar" },
    { name: "Bandar Lampung", zone: "Asia/Jakarta" }
];

function formatTime(date) {
    return date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function loadRegionCards() {
    const container = document.getElementById("region-carousel");
    regions.forEach(({ name, zone }) => {
        fetch(`https://api.weatherapi.com/v1/current.json?key=${APIKEY}&q=${name}`)
            .then(res => res.json())
            .then(data => {
                const localTime = new Date(new Date().toLocaleString("en-US", { timeZone: zone }));
                const timeText = `${formatTime(localTime)} ${zone.split("/")[1]}`;
                const temp = data.current.temp_c;
                const desc = data.current.condition.text;

                const regionHTML = `a
                    <div class="region">
                        <div class="region-name">${name}</div>
                        <div class="clock">${timeText}</div>
                        <div class="temperature">${temp} °C</div>
                        <div class="desc">${desc}</div>
                    </div>
                `;
                container.innerHTML += regionHTML;
            })
            .catch(err => console.error(`Gagal mengambil data ${name}:`, err));
    });
}

function scrollRegion(direction) {
  const container = document.getElementById("region-carousel");
  const scrollAmount = 160; // bisa diatur sesuai lebar 1 kartu
  container.scrollBy({
    left: direction * scrollAmount,
    behavior: "smooth"
  });
}


function getWeatherByCity(city) {
    const URL = `http://api.weatherapi.com/v1/forecast.json?key=${APIKEY}&q=${city}`;

    fetch(URL)
        .then(response => response.json())
        .then(result => {
            const location = result.location;
            const current = result.current;

            const localHour = new Date(location.localtime).getHours();
            const nightMode = isNight(localHour);

            const body = document.body;
            const card = document.querySelector(".weather-card");
            const sun = document.querySelector(".sun");
            const moon = document.querySelector(".moon");
            const emoji = getIconEmoji(current.condition.code, nightMode);

            if (nightMode) {
                body.dataset.mode = "night";
                card.dataset.mode = "night";
                sun.style.display = "none";
                moon.style.display = "block";
            } else {
                body.dataset.mode = "day";
                card.dataset.mode = "day";
                sun.style.display = "block";
                moon.style.display = "none";
            }

            document.querySelector(".city").textContent = location.name;

            document.querySelector(".date").textContent = new Date().toLocaleDateString("id-ID", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
            });

            document.querySelector(".humidity").textContent = `💧 ${current.humidity}%`;
            document.querySelector(".wind").textContent = `💨 ${current.wind_kph} km/h`;
            document.querySelector(".temperature").textContent = `${current.temp_c} °C`;
            document.querySelector(".weather-icon").textContent = emoji;

            // Jam utama berjalan
            setInterval(() => {
                const now = new Date();
                const timeString = now.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true
                });
                document.querySelector(".clock").textContent = ` ${timeString}`;
            }, 1000);
        })
        .catch(err => {
            console.error("Gagal mengambil cuaca utama:", err);
        });
}

window.onload = () => {
    getWeatherByCity(city);
    loadRegionCards();
};
