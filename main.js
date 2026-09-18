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
