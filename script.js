// Served by Flask (port 5000): use a relative path.
// Opened from Live Server or a file: call the Flask server directly.
const API = window.location.port === "5000" ? "/api" : "http://127.0.0.1:5000/api";
const MATERIALS = ["Paper", "Plastic", "Metal", "Glass"];
const COLORS = { Paper: "#c98a2b", Plastic: "#2e86ab", Metal: "#5b6b78", Glass: "#3f9b6b" };
const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const rs = (n) => "₹" + fmt(n);
const today = () => new Date().toISOString().slice(0, 10);

let editingId = null;
let charts = {};

/* ---------------- helpers ---------------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(path, options) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- form: validation + live total ---------------- */
const form = $("#entryForm");

function formData() {
  const f = new FormData(form);
  return Object.fromEntries(f.entries());
}

function showErrors(errors) {
  form.querySelectorAll(".err").forEach((el) => (el.textContent = errors[el.dataset.for] || ""));
  form.querySelectorAll("input, select").forEach((el) => el.classList.toggle("bad", !!errors[el.name]));
}

function validate(d) {
  const e = {};
  if (!d.seller_name.trim()) e.seller_name = "Enter the seller's name.";
  else if (!/^[A-Za-z ]{2,50}$/.test(d.seller_name.trim())) e.seller_name = "Use 2 to 50 letters and spaces only.";
  if (!d.material) e.material = "Choose a material.";
  const w = parseFloat(d.weight_kg);
  if (!(w > 0 && w <= 10000)) e.weight_kg = "Weight must be above 0 and up to 10000 kg.";
  const r = parseFloat(d.rate_per_kg);
  if (!(r > 0 && r <= 10000)) e.rate_per_kg = "Rate must be above 0 and up to 10000.";
  if (!d.entry_date) e.entry_date = "Pick a date.";
  else if (d.entry_date > today()) e.entry_date = "Date cannot be in the future.";
  return e;
}

function updateTotal() {
  const d = formData();
  const t = parseFloat(d.weight_kg) * parseFloat(d.rate_per_kg);
  $("#total").textContent = isFinite(t) && t > 0 ? rs(t.toFixed(2)) : "₹0";
}
["#weight", "#rate"].forEach((id) => $(id).addEventListener("input", updateTotal));

function resetForm() {
  editingId = null;
  form.reset();
  $("#date").value = today();
  $("#date").max = today();
  $("#slipTitle").textContent = "New weigh slip";
  $("#saveBtn").textContent = "Add entry";
  $("#cancelBtn").hidden = true;
  showErrors({});
  updateTotal();
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const d = formData();
  const errors = validate(d);
  showErrors(errors);
  if (Object.keys(errors).length) return;
  try {
    if (editingId) {
      await api(`/entries/${editingId}`, { method: "PUT", body: JSON.stringify(d) });
      toast("Entry updated");
    } else {
      await api("/entries", { method: "POST", body: JSON.stringify(d) });
      toast("Entry added");
    }
    resetForm();
    refresh();
  } catch (err) {
    showErrors(err.errors || {});
    if (!err.errors) toast("Could not reach the server. Is app.py running?");
  }
});
$("#cancelBtn").addEventListener("click", resetForm);

/* ---------------- table (Read / edit / delete) ---------------- */
async function loadEntries() {
  const q = encodeURIComponent($("#search").value.trim());
  const m = encodeURIComponent($("#filter").value);
  const list = await api(`/entries?q=${q}&material=${m}`);
  const body = $("#entriesTable tbody");
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No entries found. Fill in the weigh slip to add one.</td></tr>`;
    return;
  }
  body.innerHTML = list.map((e) => `
    <tr>
      <td>${e.entry_id}</td>
      <td>${esc(e.seller_name)}</td>
      <td><span class="dot" style="background:${COLORS[e.material]}"></span>${e.material}</td>
      <td class="num">${fmt(e.weight_kg)}</td>
      <td class="num">${fmt(e.rate_per_kg)}</td>
      <td>${e.entry_date}</td>
      <td class="num">${fmt(e.total_amount)}</td>
      <td class="num">
        <button data-edit='${JSON.stringify(e).replace(/'/g, "&#39;")}'>Edit</button>
        <button class="del" data-del="${e.entry_id}">Delete</button>
      </td>
    </tr>`).join("");
}

$("#entriesTable").addEventListener("click", async (ev) => {
  const editBtn = ev.target.closest("[data-edit]");
  const delBtn = ev.target.closest("[data-del]");
  if (editBtn) {
    const e = JSON.parse(editBtn.dataset.edit);
    editingId = e.entry_id;
    $("#seller").value = e.seller_name;
    $("#material").value = e.material;
    $("#weight").value = e.weight_kg;
    $("#rate").value = e.rate_per_kg;
    $("#date").value = e.entry_date;
    $("#slipTitle").textContent = `Edit entry ${e.entry_id}`;
    $("#saveBtn").textContent = "Save changes";
    $("#cancelBtn").hidden = false;
    showErrors({});
    updateTotal();
    $("#seller").focus();
  }
  if (delBtn && confirm(`Delete entry ${delBtn.dataset.del}? This cannot be undone.`)) {
    await api(`/entries/${delBtn.dataset.del}`, { method: "DELETE" });
    toast("Entry deleted");
    if (editingId == delBtn.dataset.del) resetForm();
    refresh();
  }
});

let timer;
$("#search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadEntries, 250); });
$("#filter").addEventListener("change", loadEntries);

/* ---------------- dashboard: KPIs, charts, insights ---------------- */
function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($("#" + id), config);
}

function renderSummary(s) {
  const byMat = MATERIALS.map((m) => s.by_material.find((x) => x.material === m) || { material: m, weight: 0, amount: 0, entries: 0 });
  const totalW = byMat.reduce((a, x) => a + x.weight, 0);
  const totalA = byMat.reduce((a, x) => a + x.amount, 0);
  const totalN = byMat.reduce((a, x) => a + x.entries, 0);
  const top = [...byMat].sort((a, b) => b.weight - a.weight)[0];

  $("#kpis").innerHTML = [
    ["Entries", fmt(totalN)],
    ["Total weight", fmt(totalW) + " kg"],
    ["Total paid", rs(totalA)],
    ["Most collected", totalN ? top.material : "None yet"],
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("#summaryTable tbody").innerHTML = byMat.map((x) => `
    <tr><td><span class="dot" style="background:${COLORS[x.material]}"></span>${x.material}</td>
    <td class="num">${x.entries}</td><td class="num">${fmt(x.weight)}</td><td class="num">${fmt(x.amount)}</td></tr>`).join("")
    + `<tr><th>Total</th><th class="num">${totalN}</th><th class="num">${fmt(totalW)}</th><th class="num">${fmt(totalA)}</th></tr>`;

  const colors = MATERIALS.map((m) => COLORS[m]);
  const base = { responsive: true, maintainAspectRatio: false };
  drawChart("weightChart", {
    type: "doughnut",
    data: { labels: MATERIALS, datasets: [{ data: byMat.map((x) => x.weight), backgroundColor: colors }] },
    options: { ...base, plugins: { legend: { position: "bottom" } } },
  });
  drawChart("amountChart", {
    type: "bar",
    data: { labels: MATERIALS, datasets: [{ data: byMat.map((x) => x.amount), backgroundColor: colors }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  drawChart("trendChart", {
    type: "line",
    data: { labels: s.trend.map((t) => t.date.slice(5)), datasets: [{ data: s.trend.map((t) => t.amount), borderColor: "#1c2b2d", backgroundColor: "#f4b400", tension: 0.25, pointRadius: 4 }] },
    options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  renderInsights(byMat, totalW, totalA, s.top_sellers);
}

function renderInsights(byMat, totalW, totalA, sellers) {
  const list = $("#insights");
  if (!totalW) { list.innerHTML = "<li>No data yet. Add a weigh slip and insights will appear here.</li>"; return; }
  const heaviest = [...byMat].sort((a, b) => b.weight - a.weight)[0];
  const richest = [...byMat].sort((a, b) => b.amount - a.amount)[0];
  const withRate = byMat.filter((x) => x.weight > 0).map((x) => ({ ...x, avg: x.amount / x.weight }));
  const bestRate = [...withRate].sort((a, b) => b.avg - a.avg)[0];
  const items = [
    `${heaviest.material} is the heaviest material: ${fmt(heaviest.weight)} kg, ${Math.round((heaviest.weight / totalW) * 100)}% of everything collected.`,
    `${richest.material} takes the most money: ${rs(richest.amount)}, ${Math.round((richest.amount / totalA) * 100)}% of the total paid.`,
    `${bestRate.material} has the highest average rate at ${rs(bestRate.avg.toFixed(2))} per kg.`,
  ];
  if (sellers.length) items.push(`${sellers[0].seller_name} is the top seller with ${fmt(sellers[0].weight)} kg worth ${rs(sellers[0].amount)}.`);
  const missing = byMat.filter((x) => x.entries === 0).map((x) => x.material);
  if (missing.length) items.push(`No entries yet for ${missing.join(", ")}.`);
  list.innerHTML = items.map((t) => `<li>${esc(t)}</li>`).join("");
}

async function refresh() {
  try {
    const [summary] = await Promise.all([api("/summary"), loadEntries()]);
    renderSummary(summary);
  } catch {
    toast("Could not reach the server. Is app.py running?");
  }
}

resetForm();
refresh();