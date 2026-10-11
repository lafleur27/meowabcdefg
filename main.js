const burger = document.getElementById("burger");
const links = document.getElementById("links");

burger.addEventListener("click", () => {
  burger.classList.toggle("open");
  links.classList.toggle("open");
});

links.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    burger.classList.remove("open");
    links.classList.remove("open");
  })
);

const copyBtn = document.getElementById("copy");
const ca = document.getElementById("ca");

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ca.textContent.trim());
    copyBtn.textContent = "Copied";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "Copy";
      copyBtn.classList.remove("copied");
    }, 1600);
  } catch {
    ca.removeAttribute("readonly");
    const r = document.createRange();
    r.selectNodeContents(ca);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
});

const counters = document.querySelectorAll("[data-count]");

function animateCount(el) {
  const target = parseInt(el.dataset.count, 10);
  const dur = 1400;
  const start = performance.now();
  const fmt = (n) => n.toLocaleString("en-US");
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      if (e.target.matches("[data-count]")) animateCount(e.target);
      e.target.querySelectorAll("[data-count]").forEach(animateCount);
      io.unobserve(e.target);
    });
  },
  { threshold: 0.2 }
);

document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

document.querySelectorAll(".toko-row").forEach((row) => {
  row.style.setProperty("--v", row.dataset.value);
  io.observe(row);
});

/* ---- live coin stats (DexScreener) ---- */

const PLACEHOLDER_CA = "REPLACE-WITH-YOUR-CONTRACT-ADDRESS";
const STATS_REFRESH_MS = 60000;

const statEls = {
  price: document.getElementById("stat-price"),
  change: document.getElementById("stat-change"),
  volume: document.getElementById("stat-volume"),
  liquidity: document.getElementById("stat-liquidity"),
};

function fmtUsd(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function fmtPrice(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return "$" + n.toFixed(n >= 0.01 ? 4 : 6);
}

async function loadStats() {
  const addr = ca.textContent.trim();
  if (!addr || addr === PLACEHOLDER_CA) return;
  document.querySelectorAll(".buy-link").forEach((a) => {
    a.href = `https://dexscreener.com/solana/${addr}`;
    a.target = "_blank";
    a.rel = "noopener";
  });
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
    if (!res.ok) throw new Error(res.status);
    const { pairs } = await res.json();
    const pair = (pairs || [])
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0))[0];
    if (!pair) return;
    statEls.price.textContent = fmtPrice(parseFloat(pair.priceUsd));
    const chg = pair.priceChange?.h24;
    if (chg != null) {
      statEls.change.textContent = (chg >= 0 ? "+" : "") + Number(chg).toFixed(1) + "%";
    }
    statEls.volume.textContent = fmtUsd(pair.volume?.h24);
    statEls.liquidity.textContent = fmtUsd(pair.liquidity?.usd);
  } catch {
    /* keep placeholders on failure */
  }
}

loadStats();
setInterval(loadStats, STATS_REFRESH_MS);

/* ---- Live dashboard (GeckoTerminal pools + pooled volume history) ---- */

const LOOP = ca.textContent.trim();
const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/solana";
const HOLDER_SHARE = 0.03; // holders get 50% of the 6% tax = 3% of traded volume
const POOLS_TTL = 15 * 60 * 1000;
const OHLCV_TTL = 6 * 60 * 60 * 1000;
const MAX_OHLCV_POOLS = 4;
const TRACK_KEY = "track_liq";

function stash(k, v) {
  try { localStorage.setItem("loop_" + k, JSON.stringify(v)); } catch {}
}
function retrieve(k) {
  try { return JSON.parse(localStorage.getItem("loop_" + k)); } catch { return null; }
}

async function fetchCached(url, ttl, key) {
  const c = retrieve(key);
  if (c && c.v && Date.now() - c.t < ttl) return c.v;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const v = await res.json();
    stash(key, { t: Date.now(), v });
    return v;
  } catch {
    return c && c.v ? c.v : null; // serve last-known copy if the API throttles
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(t) {
  const d = new Date(t);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function loadPools() {
  if (!LOOP || LOOP === PLACEHOLDER_CA) return null;
  const data = await fetchCached(`${GT_BASE}/tokens/${LOOP}/pools?page=1`, POOLS_TTL, "gt_pools");
  if (!data || !Array.isArray(data.data)) return null;
  return data.data
    .map((p) => {
      const a = p.attributes || {};
      const v = a.volume_usd || {};
      return {
        address: a.address,
        name: a.name || "Pool",
        price: parseFloat(a.base_token_price_usd) || 0,
        liq: parseFloat(a.reserve_in_usd) || 0,
        vol24: parseFloat(v.h24) || 0,
        created: String(a.pool_created_at || "").slice(0, 10),
      };
    })
    .sort((a, b) => b.liq - a.liq);
}

async function loadHistory(pools) {
  const active = pools.slice().sort((a, b) => b.vol24 - a.vol24).slice(0, MAX_OHLCV_POOLS);
  const dayVol = {};
  for (const p of active) {
    if (!p.vol24) continue;
    const data = await fetchCached(`${GT_BASE}/pools/${p.address}/ohlcv/day?limit=30`, OHLCV_TTL, "gt_ohlcv_" + p.address);
    const list = data && data.data && data.data.attributes && data.data.attributes.ohlcv_list;
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const t = (row[0] || 0) * 1000;
      const vol = row[5] || 0;
      const day = new Date(t);
      day.setHours(0, 0, 0, 0);
      dayVol[day.getTime()] = (dayVol[day.getTime()] || 0) + vol;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const times = Object.keys(dayVol).map(Number).sort((a, b) => a - b);
  const daily = times.map((t) => ({ t, vol: dayVol[t], dist: HOLDER_SHARE * dayVol[t] }));
  let cum = 0;
  daily.forEach((d) => { cum += d.dist; d.cum = cum; });
  return daily;
}

function trackLiquidity(liq) {
  const buf = retrieve(TRACK_KEY) || { pts: [] };
  const pts = buf.pts;
  const now = Date.now();
  if (!pts.length || now - pts[pts.length - 1][0] > 5 * 60 * 1000) pts.push([now, liq]);
  while (pts.length > 1200) pts.shift();
  stash(TRACK_KEY, { pts });
  const start = pts[0][0];
  return [{ t: start, v: liq }, ...pts.map((p) => ({ t: p[0], v: p[1] }))];
}

function drawGrowthChart({ rewards, liq }) {
  const svg = document.getElementById("growthChart");
  if (!svg) return;
  const W = 820, H = 280, padL = 8, padR = 8, padT = 10, padB = 14;
  const iw = W - padL - padR, ih = H - padT - padB;
  const all = [...rewards.map((p) => p.t), ...liq.map((p) => p.t)];
  if (!all.length) return;
  let x0 = Math.min(...all), x1 = Math.max(...all);
  if (x1 === x0) x1 = x0 + 1;
  const ymax = Math.max(1, ...rewards.map((p) => p.v), ...liq.map((p) => p.v));
  const X = (t) => padL + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v) => padT + (1 - v / ymax) * ih;
  const path = (pts) =>
    pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join("");
  let grid = "";
  for (let g = 1; g <= 4; g++) {
    const y = padT + (ih * g) / 5;
    grid += `<line class="chart-grid" x1="${padL}" y1="${y}" x2="${padL + iw}" y2="${y}"/>`;
  }
  svg.innerHTML =
    grid +
    `<path d="${path(rewards)}" fill="none" stroke="#000" stroke-width="2"/>` +
    `<path d="${path(liq)}" fill="none" stroke="#a3a3a3" stroke-width="2" stroke-dasharray="3 3"/>`;
  document.getElementById("chart-time-min").textContent = fmtDate(x0);
  document.getElementById("chart-time-max").textContent = fmtDate(x1);
}

function renderDaily(daily) {
  const el = document.getElementById("daily-list");
  const max = Math.max(...daily.map((d) => d.dist));
  const recent = daily.slice(-10).reverse();
  el.innerHTML = recent
    .map(
      (d) => `
      <div class="daily-row">
        <span class="daily-date">${fmtDate(d.t)}</span>
        <span class="daily-bar"><i style="width:${max ? ((d.dist / max) * 100).toFixed(1) : 0}%"></i></span>
        <span class="daily-amt">${fmtUsd(d.dist)}</span>
      </div>`
    )
    .join("") || `<div class="pool-empty">No distribution data yet.</div>`;
}

function renderDailyBars(daily) {
  const svg = document.getElementById("dailyChart");
  if (!svg) return;
  const W = 820, H = 290, padT = 8, padB = 24, padL = 6, padR = 6;
  const iw = W - padL - padR, ih = H - padT - padB;
  const days = daily.slice(-20);
  const max = Math.max(...days.map((d) => d.dist));
  const slot = iw / days.length;
  const bw = slot * 0.72;
  let buf = `<line class="chart-grid" x1="${padL}" y1="${padT + ih}" x2="${padL + iw}" y2="${padT + ih}"/>`;
  days.forEach((d, i) => {
    const hh = max ? (d.dist / max) * ih : 0;
    const x = padL + i * slot + (slot - bw) / 2;
    buf += `<rect x="${x.toFixed(1)}" y="${(padT + ih - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="#000"/>`;
  });
  svg.innerHTML = buf;
  document.getElementById("daily-min").textContent = fmtDate(days[0].t);
  document.getElementById("daily-max").textContent = fmtDate(days[days.length - 1].t);
}

async function loadDashboard() {
  const pools = await loadPools();
  if (!pools) return;
  const totalLiq = pools.reduce((s, p) => s + p.liq, 0);
  const totalVol = pools.reduce((s, p) => s + p.vol24, 0);
  const rewards24 = HOLDER_SHARE * totalVol;
  document.getElementById("dash-liquidity").textContent = fmtUsd(totalLiq);
  document.getElementById("dash-rewards24").textContent = fmtUsd(rewards24);
  document.getElementById("dash-pools").textContent = pools.length + " " + (pools.length === 1 ? "pool" : "pools");

  document.getElementById("pool-list").innerHTML = pools
    .slice(0, 12)
    .map(
      (p) => `
      <div class="pool-row">
        <div>
          <div class="pool-name"><a href="https://www.geckoterminal.com/solana/pools/${p.address}" target="_blank" rel="noopener">${esc(p.name)}</a></div>
          <div class="pool-meta">since ${esc(p.created)} · ${fmtPrice(p.price)}</div>
        </div>
        <div class="pool-totals">
          <div class="pool-liq">${fmtUsd(p.liq)}</div>
          <div class="pool-vol">${fmtUsd(p.vol24)} / 24h</div>
        </div>
      </div>`
    )
    .join("");

  const daily = await loadHistory(pools);
  if (daily && daily.length) {
    const totalRewards = daily[daily.length - 1].cum;
    document.getElementById("dash-rewards").textContent = fmtUsd(totalRewards);
    renderDaily(daily);
    renderDailyBars(daily);
    drawGrowthChart({ rewards: daily.map((d) => ({ t: d.t, v: d.cum })), liq: trackLiquidity(totalLiq) });
    document.getElementById("chart-note").textContent =
      "Holder rewards = 3% of pooled trading volume (50% of the 6% tax), in USD. Liquidity line tracks live while the page is open.";
  } else {
    document.getElementById("dash-rewards24").textContent = fmtUsd(rewards24);
  }
}

const distToggle = document.getElementById("dist-chart-toggle");
if (distToggle) {
  distToggle.addEventListener("click", (e) => {
    e.preventDefault();
    const wrap = document.getElementById("daily-chart-wrap");
    wrap.classList.toggle("hidden");
    distToggle.textContent = wrap.classList.contains("hidden") ? "list" : "chart";
  });
}

if (LOOP && LOOP !== PLACEHOLDER_CA) {
  loadDashboard();
  setInterval(loadDashboard, 60000);
}
