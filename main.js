const apiKey = "5e03ccf5957c4ec895e62947251307";
const API_BASE = "https://api.weatherapi.com/v1";
const defaultCity = "Jakarta";
const REFRESH_MS = 10 * 60 * 1000;
const STORAGE_CITY = "weather.lastCity";
const STORAGE_UNIT = "weather.unit";

let lastData = null;       // respons WeatherAPI terakhir, dipakai ulang saat ganti °C/°F
let lastForecast = null;   // prakiraan terakhir (BMKG atau WeatherAPI) dalam format seragam
let currentQuery = null;   // query terakhir yang berhasil, dipakai auto refresh
let lastFetchedAt = 0;
let timeZone = null;       // zona waktu lokasi, untuk jam live
let requestId = 0;         // abaikan respons lama kalau ada request yang lebih baru
let unit = load(STORAGE_UNIT) === "f" ? "f" : "c";

const $ = (selector) => document.querySelector(selector);

// localStorage bisa diblokir (mode privat dsb), jadi selalu dibungkus try/catch
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/* ---------- Kode kondisi cuaca ---------- */

const CODES = {
  clear: [1000],
  partly: [1003],
  cloudy: [1006, 1009],
  fog: [1030, 1036, 1135, 1147],
  lightRain: [1063, 1150, 1153, 1180, 1183, 1240],
  heavyRain: [1186, 1189, 1192, 1195, 1243, 1246],
  snow: [1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258],
  sleet: [1069, 1072, 1168, 1171, 1198, 1201, 1204, 1207, 1237, 1249, 1252, 1261, 1264],
  storm: [1087, 1273, 1276, 1279, 1282],
};
const is = (group, code) => CODES[group].includes(code);

// Nama file ikon di assets/icons (Meteocons oleh Bas Milius, lisensi MIT)
function getIconName(code, isNight) {
  const dn = isNight ? "night" : "day";
  if (is("clear", code)) return `clear-${dn}`;
  if (is("partly", code)) return `partly-cloudy-${dn}`;
  if (code === 1006) return "cloudy";
  if (code === 1009) return `overcast-${dn}`;
  if (code === 1030) return "mist";
  if (code === 1036) return `haze-${dn}`;
  if (is("fog", code)) return `fog-${dn}`;
  if (code === 1150 || code === 1153) return "drizzle";
  if (is("lightRain", code)) return `partly-cloudy-${dn}-rain`;
  if (is("heavyRain", code)) return "rain";
  if (is("snow", code)) return "snow";
  if (is("sleet", code)) return "sleet";
  if (code === 1087) return `thunderstorms-${dn}`;
  if (code === 1279 || code === 1282) return "thunderstorms-snow";
  if (is("storm", code)) return `thunderstorms-${dn}-rain`;
  return "not-available";
}

function icon(name, className, alt = "") {
  return `<img class="${className}" src="assets/icons/${name}.svg" alt="${escapeHtml(alt)}">`;
}

function uvIconName(uv) {
  const level = Math.min(Math.round(uv), 11);
  return level < 1 ? "uv-index" : `uv-index-${level}`;
}

// Jenis animasi latar di kartu
function getWeatherType(code) {
  if (is("storm", code)) return "storm";
  if (is("snow", code) || is("sleet", code)) return "snow";
  if (is("lightRain", code) || is("heavyRain", code)) return "rain";
  if (is("fog", code)) return "fog";
  if (is("partly", code) || is("cloudy", code)) return "cloudy";
  return "clear";
}

/* ---------- Satuan & format ---------- */

const unitLabel = () => (unit === "c" ? "°C" : "°F");
const pick = (obj, key) => obj[`${key}_${unit}`]; // mis. pick(current, "temp") → temp_c / temp_f
const wind = (current) => (unit === "c" ? `${current.wind_kph} km/h` : `${current.wind_mph} mph`);

// "06:12 AM" → "06:12"
function to24h(text) {
  const [time, period] = text.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function uvLabel(uv) {
  if (uv < 3) return "Rendah";
  if (uv < 6) return "Sedang";
  if (uv < 8) return "Tinggi";
  if (uv < 11) return "Sgt tinggi";
  return "Ekstrem";
}

// Indeks US EPA 1–6
const AQI_LABELS = ["", "Baik", "Sedang", "Kurang sehat", "Tidak sehat", "Sgt tdk sehat", "Berbahaya"];

// Suhu prakiraan disimpan dalam °C, dikonversi saat ditampilkan
const toUnit = (c) => (unit === "c" ? c : (c * 9) / 5 + 32);
const deg = (c) => `${Math.round(toUnit(c))}°`;

// "2026-11-02" → "Senin", tidak bergeser oleh zona waktu browser
function weekdayName(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("id-ID", { weekday: "long", timeZone: "UTC" });
}

/* ---------- Prakiraan: format seragam untuk kedua sumber ----------
   hourly: [{ label, iconName, alt, tempC, rain: { alt, text } }]
   daily:  [{ dayName, iconName, alt, maxC, minC }]
   source: teks sumber data yang ditampilkan di kartu */

function weatherApiForecast(data) {
  const days = data.forecast.forecastday;
  const now = data.location.localtime_epoch;

  const hourly = days
    .flatMap((day) => day.hour)
    .filter((h) => h.time_epoch + 3600 > now) // jam yang sedang berjalan dan sesudahnya
    .slice(0, 24)
    .map((h, i) => ({
      label: i === 0 ? "Kini" : h.time.split(" ")[1],
      iconName: getIconName(h.condition.code, !h.is_day),
      alt: h.condition.text,
      tempC: h.temp_c,
      rain: { alt: "Peluang hujan", text: `${h.chance_of_rain}%` },
    }));

  const daily = days.slice(1).map((d) => ({
    dayName: weekdayName(d.date),
    iconName: getIconName(d.day.condition.code, false),
    alt: d.day.condition.text,
    maxC: d.day.maxtemp_c,
    minC: d.day.mintemp_c,
  }));

  return { hourly, daily, source: "Prakiraan per jam: WeatherAPI.com" };
}

/* ---------- BMKG (khusus lokasi di Indonesia) ----------
   API publik BMKG butuh kode kelurahan (adm4). Kode dicari dari koordinat memakai
   data/kelurahan/*.js (dibuat oleh scripts/build-kelurahan.py). */

const BMKG_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=";
const BMKG_CACHE_MS = 30 * 60 * 1000; // BMKG memperbarui data 2x sehari
const MAX_KELURAHAN_KM = 25;
const bmkgCache = new Map();      // kode adm4 → { at, json }
const provinceScripts = new Map(); // kode provinsi → Promise

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Gagal memuat ${src}`));
    document.head.appendChild(script);
  });
}

function loadProvince(prov) {
  if (!provinceScripts.has(prov)) {
    const promise = loadScript(`data/kelurahan/${prov}.js`).catch((err) => {
      provinceScripts.delete(prov);
      throw err;
    });
    provinceScripts.set(prov, promise);
  }
  return provinceScripts.get(prov);
}

// Kelurahan terdekat dari koordinat, atau null kalau tidak ada dalam 25 km
async function findKelurahan(lat, lon) {
  const index = window.KELURAHAN_INDEX || {};
  const margin = 0.05;
  const provinces = Object.keys(index).filter((p) => {
    const [minLat, maxLat, minLng, maxLng] = index[p];
    return lat >= minLat - margin && lat <= maxLat + margin && lon >= minLng - margin && lon <= maxLng + margin;
  });
  await Promise.all(provinces.map(loadProvince));

  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestKm = Infinity;
  for (const prov of provinces) {
    for (const row of window.KELURAHAN_DATA[prov]) {
      const km = Math.hypot((row[3] - lon) * cosLat, row[2] - lat) * 111.32;
      if (km < bestKm) {
        bestKm = km;
        best = row;
      }
    }
  }
  return bestKm <= MAX_KELURAHAN_KM ? { code: best[0], name: best[1] } : null;
}

async function fetchBmkg(code) {
  const cached = bmkgCache.get(code);
  if (cached && Date.now() - cached.at < BMKG_CACHE_MS) return cached.json;

  const res = await fetch(BMKG_URL + code);
  if (!res.ok) throw new Error(`BMKG HTTP ${res.status}`);
  const json = await res.json();
  if (!json.data?.[0]?.cuaca?.length) throw new Error("Data BMKG kosong");
  bmkgCache.set(code, { at: Date.now(), json });
  return json;
}

// Kategori dari teks weather_desc BMKG (dokumentasi BMKG tidak memuat daftar kode angka).
// Urutan penting: yang lebih spesifik dicek lebih dulu.
const BMKG_KINDS = [
  [/petir|badai/i, "storm"],
  [/hujan (lebat|sedang)/i, "heavyRain"],
  [/hujan|gerimis/i, "rain"],
  [/kabut/i, "fog"],
  [/asap|kabur/i, "haze"],
  [/berawan tebal/i, "overcast"],
  [/cerah berawan/i, "partly"],
  [/berawan/i, "cloudy"],
  [/cerah/i, "clear"],
];
// Dipakai untuk memilih kondisi "terparah" dalam satu hari
const BMKG_SEVERITY = { storm: 8, heavyRain: 7, rain: 6, fog: 5, haze: 5, overcast: 4, cloudy: 3, partly: 2, clear: 1 };

function bmkgKind(desc) {
  const match = BMKG_KINDS.find(([pattern]) => pattern.test(desc));
  return match ? match[1] : "unknown";
}

function bmkgIconName(desc, isNight) {
  const dn = isNight ? "night" : "day";
  return {
    storm: `thunderstorms-${dn}-rain`,
    heavyRain: "rain",
    rain: `partly-cloudy-${dn}-rain`,
    fog: `fog-${dn}`,
    haze: `haze-${dn}`,
    overcast: `overcast-${dn}`,
    partly: `partly-cloudy-${dn}`,
    cloudy: "cloudy",
    clear: `clear-${dn}`,
  }[bmkgKind(desc)] || "not-available";
}

const utcMs = (text) => Date.parse(`${text.replace(" ", "T")}Z`); // "2026-11-01 07:00:00" (UTC)

function bmkgForecast(json, data) {
  const entries = json.data[0].cuaca.flat();
  const loc = json.lokasi;
  const now = Date.now();

  // Data BMKG adalah prakiraan per titik waktu (tiap 3 jam).
  // "Kini" hanya untuk titik yang berjarak ≤ 90 menit dari sekarang.
  const HALF_STEP = 90 * 60 * 1000;
  const astro = data.forecast.forecastday[0].astro;
  const sunrise = to24h(astro.sunrise);
  const sunset = to24h(astro.sunset);
  const isNightAt = (local) => {
    const hm = local.slice(11, 16);
    return hm < sunrise || hm >= sunset;
  };

  const hourly = entries
    .filter((e) => utcMs(e.utc_datetime) > now - HALF_STEP)
    .slice(0, 8)
    .map((e) => ({
      label: Math.abs(utcMs(e.utc_datetime) - now) <= HALF_STEP ? "Kini" : e.local_datetime.slice(11, 16),
      iconName: bmkgIconName(e.weather_desc, isNightAt(e.local_datetime)),
      alt: e.weather_desc,
      tempC: e.t,
      rain: { alt: "Curah hujan", text: `${e.tp} mm` },
    }));

  const today = data.location.localtime.slice(0, 10);
  const byDate = new Map();
  for (const e of entries) {
    const date = e.local_datetime.slice(0, 10);
    if (date === today) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(e);
  }
  const severity = (e) => BMKG_SEVERITY[bmkgKind(e.weather_desc)] || 0;
  const daily = [...byDate].map(([date, list]) => {
    const worst = list.reduce((a, b) => (severity(b) > severity(a) ? b : a));
    const temps = list.map((e) => e.t);
    return {
      dayName: weekdayName(date),
      iconName: bmkgIconName(worst.weather_desc, false),
      alt: worst.weather_desc,
      maxC: Math.max(...temps),
      minC: Math.min(...temps),
    };
  });

  const updated = new Date(`${entries[0].analysis_date}Z`).toLocaleTimeString("en-GB", {
    timeZone: loc.timezone, hour: "2-digit", minute: "2-digit",
  });

  return {
    hourly,
    daily,
    source: `Prakiraan per 3 jam: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika) · ${loc.desa}, ${loc.kecamatan} · diperbarui ${updated}`,
  };
}

// Prakiraan BMKG untuk lokasi di Indonesia; null kalau lokasi di luar jangkauan BMKG
async function getBmkgForecast(data) {
  const { country, lat, lon } = data.location;
  if (country !== "Indonesia" || !window.KELURAHAN_INDEX) return null;
  const kelurahan = await findKelurahan(lat, lon);
  if (!kelurahan) return null;
  return bmkgForecast(await fetchBmkg(kelurahan.code), data);
}

/* ---------- Ambil data ---------- */

async function fetchWeather(query, { silent = false, remember = false } = {}) {
  const id = ++requestId;
  if (!silent) {
    $(".city").textContent = "Memuat...";
  }

  try {
    const url = `${API_BASE}/forecast.json?key=${apiKey}&q=${encodeURIComponent(query)}&days=3&aqi=yes&lang=id`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.code === 1006 ? "Kota tidak ditemukan" : data.error.message);
    }

    let forecast = weatherApiForecast(data);
    try {
      forecast = (await getBmkgForecast(data)) || forecast;
    } catch (err) {
      console.warn("BMKG tidak tersedia, memakai WeatherAPI:", err);
      forecast.source += " (BMKG tidak tersedia)";
    }
    if (id !== requestId) return; // sudah ada request yang lebih baru

    lastData = data;
    lastForecast = forecast;
    currentQuery = query;
    lastFetchedAt = Date.now();
    timeZone = data.location.tz_id;
    if (remember) save(STORAGE_CITY, query);
    render(data, forecast);
  } catch (err) {
    console.error(err);
    if (id !== requestId || silent) return; // refresh otomatis gagal → biarkan data lama
    timeZone = null;
    $(".city").textContent = "Gagal memuat data";
    $(".date").textContent = err instanceof TypeError ? "Periksa koneksi internet" : err.message;
    $(".clock").textContent = "";
  }
}

/* ---------- Tampilan ---------- */

function render(data, forecast) {
  const { current, location } = data;
  const days = data.forecast.forecastday;
  const night = !current.is_day;
  const code = current.condition.code;

  $(".weather-card").className = `weather-card ${night ? "night" : "day"} fx-${getWeatherType(code)}`;
  document.body.className = night ? "night" : "day";
  $(".sun").style.display = night ? "none" : "block";
  $(".moon").style.display = night ? "block" : "none";

  $(".city").textContent = location.name;
  $(".city").title = [location.region, location.country].filter(Boolean).join(", ");
  updateClock();

  $(".details-top").innerHTML = `
    <div class="humidity">${icon("humidity", "icon-inline", "Kelembapan")} ${current.humidity}%</div>
    <div class="wind">${icon("wind", "icon-inline", "Angin")} ${wind(current)}</div>
  `;
  $(".weather-center .weather-icon").innerHTML = icon(getIconName(code, night), "icon-main", current.condition.text);
  $(".temperature").textContent = `${pick(current, "temp")}${unitLabel()}`;
  $(".condition").textContent = current.condition.text;
  $(".feels").textContent = `Terasa ${Math.round(pick(current, "feelslike"))}°`;
  $(".unit-btn").textContent = unitLabel();

  showDetails(current, days[0].astro);
  showHourlyForecast(forecast.hourly);
  showForecast(forecast.daily);
  $(".source").innerHTML = `${escapeHtml(forecast.source)}<br>Kondisi kini: WeatherAPI.com`;
}

function showDetails(current, astro) {
  const aqi = current.air_quality && current.air_quality["us-epa-index"];
  const items = [
    ["sunrise", "Terbit", to24h(astro.sunrise)],
    ["sunset", "Terbenam", to24h(astro.sunset)],
    [uvIconName(current.uv), `UV ${current.uv}`, uvLabel(current.uv)],
    ["windsock", "Udara", AQI_LABELS[aqi] || "—"],
  ];

  $(".details-grid").innerHTML = items
    .map(([iconName, label, value]) => `
      <div class="detail-item">
        ${icon(iconName, "icon-detail")}
        <div class="detail-label">${label}</div>
        <div class="detail-value">${value}</div>
      </div>
    `)
    .join("");
}

// Jam & tanggal mengikuti zona waktu lokasi, diperbarui tiap detik
function updateClock() {
  if (!timeZone) return;
  const now = new Date();
  try {
    $(".date").textContent = now.toLocaleDateString("id-ID", {
      timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    $(".clock").textContent = now.toLocaleTimeString("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    timeZone = null; // zona waktu tidak dikenali browser
  }
}

// Prakiraan harian: suhu maksimum / minimum
function showForecast(days) {
  const html = days
    .map((d) => `
      <div class="forecast-item" title="${escapeHtml(d.alt)}">
        <div class="weather-day">${d.dayName}</div>
        ${icon(d.iconName, "icon-day", d.alt)}
        <div class="temperature-card">${deg(d.maxC)}<span class="temp-min"> / ${deg(d.minC)}</span></div>
      </div>
    `)
    .join("");

  document.getElementById("forecast").innerHTML = `<div class="forecast-grid">${html}</div>`;
}

// Prakiraan per jam (WeatherAPI) atau per 3 jam (BMKG)
function showHourlyForecast(items) {
  const html = items
    .map((h) => `
      <div class="hourly-item" title="${escapeHtml(h.alt)}">
        <div class="hourly-time">${h.label}</div>
        ${icon(h.iconName, "icon-hour", h.alt)}
        <div class="hourly-temp">${deg(h.tempC)}</div>
        <div class="hourly-rain">${icon("raindrop", "icon-rain", h.rain.alt)}${h.rain.text}</div>
      </div>
    `)
    .join("");

  document.getElementById("hourly").innerHTML = html;
}

/* ---------- Pencarian kota ---------- */

function setupSearch() {
  const form = $(".search");
  const input = $(".search-input");
  const list = $(".suggestions");
  let timer = null;
  let searchId = 0;
  let results = [];
  let active = -1;

  const close = () => {
    clearTimeout(timer);
    searchId++;
    results = [];
    active = -1;
    list.innerHTML = "";
    list.hidden = true;
  };

  const renderList = () => {
    list.innerHTML = results
      .map((r, i) => `
        <li role="option" data-i="${i}" class="${i === active ? "active" : ""}" aria-selected="${i === active}">
          <strong>${escapeHtml(r.name)}</strong>
          <small>${escapeHtml([r.region, r.country].filter(Boolean).join(", "))}</small>
        </li>
      `)
      .join("");
    list.hidden = results.length === 0;
  };

  const go = (query) => {
    input.value = "";
    input.blur();
    close();
    fetchWeather(query, { remember: true });
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) {
      close();
      return;
    }
    timer = setTimeout(async () => {
      const id = ++searchId;
      try {
        const res = await fetch(`${API_BASE}/search.json?key=${apiKey}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (id !== searchId) return;
        results = Array.isArray(data) ? data.slice(0, 5) : [];
        active = -1;
        renderList();
      } catch (err) {
        console.error(err);
      }
    }, 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      input.blur();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + results.length) % results.length;
      renderList();
    }
  });

  input.addEventListener("blur", close);

  // mousedown (bukan click) supaya terpilih sebelum input kehilangan fokus
  list.addEventListener("mousedown", (e) => {
    const item = e.target.closest("li");
    if (!item) return;
    e.preventDefault();
    go(`id:${results[item.dataset.i].id}`);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (active >= 0) go(`id:${results[active].id}`);
    else if (input.value.trim()) go(input.value.trim());
  });
}

/* ---------- Lokasi otomatis ---------- */

// Minta izin lokasi; kalau ditolak/gagal, pakai kota default
function loadWeatherFromLocation() {
  if (!navigator.geolocation) {
    fetchWeather(defaultCity);
    return;
  }

  $(".city").textContent = "Mencari lokasi...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      fetchWeather(`${latitude},${longitude}`);
    },
    (err) => {
      console.warn("Lokasi tidak tersedia:", err.message);
      fetchWeather(defaultCity);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
  );
}

/* ---------- Mulai ---------- */

function refreshIfStale() {
  if (currentQuery && !document.hidden && Date.now() - lastFetchedAt >= REFRESH_MS) {
    fetchWeather(currentQuery, { silent: true });
  }
}

window.onload = () => {
  setupSearch();

  $(".locate-btn").addEventListener("click", () => {
    save(STORAGE_CITY, null);
    loadWeatherFromLocation();
  });

  $(".unit-btn").addEventListener("click", () => {
    unit = unit === "c" ? "f" : "c";
    save(STORAGE_UNIT, unit);
    if (lastData) render(lastData, lastForecast);
    else $(".unit-btn").textContent = unitLabel();
  });

  $(".unit-btn").textContent = unitLabel();

  const savedCity = load(STORAGE_CITY);
  if (savedCity) fetchWeather(savedCity);
  else loadWeatherFromLocation();

  setInterval(updateClock, 1000);
  setInterval(refreshIfStale, 60 * 1000);
  document.addEventListener("visibilitychange", refreshIfStale);
};
