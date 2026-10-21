const $ = (s, root = document) => root.querySelector(s); const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const API_URL = "https://script.google.com/macros/s/AKfycbxYpvxxkElZVostCLGLV51N_kU1ZsEDf1Th6Ax3FvApkTCvgg7mlvDiFF4IFJDBREyu/exec";
const GOOGLE_CLIENT_ID = "913208175994-26v5bqfrqftd4ijpg6an1ihisnqmeu1a.apps.googleusercontent.com";

let currentDivision = "pendidikan";
let currentUser = null; // null = guest (belum login)
let idToken = null;
let globalData = { members: [], tasks: [], dashboard: [], allMembers: [] };
let currentPage = "members";
let isFetching = false;
let currentFetchDivision = null; // Untuk mencegah race condition
let selectedMemberId = null;
let memberQuery = "";
let sessionGeneration = 0;

const DIVISION_LABELS = {
  inti: "Pengurus Inti",
  pendidikan: "Pendidikan",
  pubsos: "Publikasi & Sosialisasi",
  pengabdian: "Pengabdian Masyarakat",
  kewirausahaan: "Kewirausahaan",
  lingkungan: "Lingkungan Hidup"
};
const isGuest = () => !currentUser;

function isCurrentUserKoord() {
  if (!currentUser || !currentUser.role) return false;
  const r = String(currentUser.role).toLowerCase();
  return r.includes("koordinator") ||
         r.includes("koord") ||
         r.includes("kord") ||
         r.includes("koor") ||
         r.includes("kadiv") ||
         r.includes("kepala divisi") ||
         r.includes("ketua divisi");
}

function isCurrentUserAdmin() {
  if (!currentUser || !currentUser.role) return false;
  return String(currentUser.role).toLowerCase().includes("admin");
}

function isCurrentUserAudit() {
  if (!currentUser || !currentUser.role) return false;
  return String(currentUser.role).toLowerCase().includes("audit");
}

let prokerSortOption = "default";

function isRegionalProkerId(id) {
  if (!id) return false;
  const upper = String(id).trim().toUpperCase();
  return (upper.startsWith("PR") && !/^[A-Z]/.test(upper.substring(2))) ||
         upper.startsWith("RPS") ||
         upper.startsWith("RPM") ||
         upper.startsWith("RLH") ||
         upper.startsWith("RK") ||
         (upper.startsWith("RP") && !/^[A-Z]/.test(upper.substring(2)));
}

function isKomisariatProkerId(id) {
  if (!id) return false;
  const upper = String(id).trim().toUpperCase();
  return upper.startsWith("PKOM") || upper.startsWith("PG");
}

function isGlobalProkerId(id) {
  return isKomisariatProkerId(id);
}

function isCrossDivisionProkerId(id) {
  return isRegionalProkerId(id) || isKomisariatProkerId(id);
}

function getProkerScopeType(t) {
  const prokerId = t.iDProker || t.idProker || t.IDProker || t.id || "";
  if (t.scope === "regional" || isRegionalProkerId(prokerId)) return "regional";
  if (t.scope === "komisariat" || t.scope === "global" || isKomisariatProkerId(prokerId)) return "komisariat";
  return "local";
}

function getProkerProgressNum(t) {
  let raw = Number(t.progres || t.Progres || t['%Progres'] || 0);
  return (raw > 0 && raw <= 1) ? Math.round(raw * 100) : raw;
}

function sortTasks(tasks, sortOption) {
  if (!tasks || !Array.isArray(tasks)) return [];
  const list = tasks.map((t, idx) => ({ ...t, _origIndex: idx }));

  if (sortOption === "regional-komisariat-local" || sortOption === "global-regional-local") {
    const rank = { regional: 1, komisariat: 2, local: 3 };
    return list.sort((a, b) => {
      const diff = rank[getProkerScopeType(a)] - rank[getProkerScopeType(b)];
      return diff !== 0 ? diff : a._origIndex - b._origIndex;
    });
  }

  if (sortOption === "local-regional-komisariat" || sortOption === "local-regional-global") {
    const rank = { local: 1, regional: 2, komisariat: 3 };
    return list.sort((a, b) => {
      const diff = rank[getProkerScopeType(a)] - rank[getProkerScopeType(b)];
      return diff !== 0 ? diff : a._origIndex - b._origIndex;
    });
  }

  if (sortOption === "progres-desc") {
    return list.sort((a, b) => {
      const diff = getProkerProgressNum(b) - getProkerProgressNum(a);
      return diff !== 0 ? diff : a._origIndex - b._origIndex;
    });
  }

  if (sortOption === "progres-asc") {
    return list.sort((a, b) => {
      const diff = getProkerProgressNum(a) - getProkerProgressNum(b);
      return diff !== 0 ? diff : a._origIndex - b._origIndex;
    });
  }

  return list;
}

function handleSortProker(val) {
  prokerSortOption = val;
  render();
}

// === 1. INISIALISASI: GOOGLE LOGIN ===
async function initApp() {
  const savedUser = sessionStorage.getItem("genbi_user");
  const savedToken = sessionStorage.getItem("genbi_token");

  if (savedUser && savedToken) {
    try {
      currentUser = JSON.parse(savedUser);
      idToken = savedToken;
      currentDivision = currentUser.divisionKey || "pendidikan";
      currentPage = "overview";
    } catch(e) {
      currentUser = null; idToken = null; currentPage = "members";
    }
  } else {
    currentUser = null; idToken = null; currentPage = "members";
  }

  applyRolePermissions();

  if (window.google) initializeGoogleSignIn();
  else window.addEventListener('load', initializeGoogleSignIn);

  if (isGuest()) {
    const cacheKey = "genbi_cache_all_members";
    let cachedData = null;
    try { cachedData = sessionStorage.getItem(cacheKey); } catch (e) {}
    if (cachedData) {
      try { globalData.allMembers = JSON.parse(cachedData); } catch (e) {}
    }
    render();
    fetchAllMembers();
  } else {
    const cacheKey = `genbi_cache_${currentDivision}`;
    const cachedData = sessionStorage.getItem(cacheKey);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        globalData.members = parsed.members || [];
        globalData.tasks = parsed.tasks || [];
      } catch (e) {}
    }
    render(); // Render dashboard state directly dengan data dari cache
    fetchDivisionData();
  }
}

function initializeGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    cancel_on_tap_outside: false
  });

  if (isGuest()) {
    const btnContainer = document.getElementById("googleLoginBtn");
    if (btnContainer) {
      btnContainer.innerHTML = "";
      google.accounts.id.renderButton(btnContainer, { theme: "outline", size: "medium", shape: "pill" });
    }
  }
}

function clearGenbiSessionStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("genbi_")) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (e) {
    console.error("Gagal membersihkan cache session:", e);
  }
}

async function handleCredentialResponse(response) {
  const token = response.credential;
  toast("Memvalidasi login...");
  const thisSession = sessionGeneration;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verifyLogin", idToken: token })
    }).then(r => r.json());

    // Tolak jika sesi berubah selama request validasi berlangsung
    if (thisSession !== sessionGeneration) return;

    if (res.status === "success") {
      sessionGeneration++;
      clearGenbiSessionStorage();
      isFetching = false;
      currentFetchDivision = null;
      globalData = { members: [], tasks: [], dashboard: [], allMembers: [] };
      selectedMemberId = null;
      if (window.currentTrackerData) window.currentTrackerData = [];

      currentUser = res.user;
      idToken = token;
      currentDivision = currentUser.divisionKey || "pendidikan";
      currentPage = "overview";

      sessionStorage.setItem("genbi_user", JSON.stringify(currentUser));
      sessionStorage.setItem("genbi_token", token);

      toast(`Selamat datang, ${currentUser.nama}!`);
      applyRolePermissions();

      const btnContainer = document.getElementById("googleLoginBtn");
      if (btnContainer) btnContainer.style.display = "none";

      render();
      await fetchDivisionData();
    } else {
      sessionGeneration++; // Batalkan request lama yang masih in-flight jika login ditolak/gagal
      currentUser = null;
      idToken = null;
      isFetching = false;
      currentFetchDivision = null;
      if (res.status === "debug_error") {
        const dbg = `DIAGNOSTIC LOGIN GAGAL:\n\nHTTP Code: ${res.httpCode}\nValid Audience: ${res.validAud}\nValid Issuer: ${res.validIss}\nValid Expiry: ${res.validExp}\nEmail Verified: ${res.emailVerified}\nHas Email: ${res.hasEmail}\nHas Sub: ${res.hasSub}`;
        alert(dbg);
        toast("Login ditolak. Lihat alert diagnostik.");
      } else {
        toast(res.message || "Gagal login.");
      }
      google.accounts.id.revoke(token, () => {});
      if (isGuest() && (!globalData.allMembers || globalData.allMembers.length === 0)) {
        fetchAllMembers();
      }
    }
  } catch (e) {
    sessionGeneration++; // Batalkan request lama jika terjadi error jaringan saat login
    currentUser = null;
    idToken = null;
    isFetching = false;
    currentFetchDivision = null;
    toast("Kesalahan jaringan saat validasi login.");
    if (isGuest() && (!globalData.allMembers || globalData.allMembers.length === 0)) {
      fetchAllMembers();
    }
  }
}

function handleLogout() {
  sessionGeneration++;
  if (idToken && window.google) google.accounts.id.revoke(idToken, () => {});
  clearGenbiSessionStorage(); // Bersihkan hanya cache The GB Dash (user, token, divisi, anggota, tracker)
  currentUser = null;
  idToken = null;
  currentPage = "members";
  selectedMemberId = null;
  memberQuery = "";
  currentDivision = "pendidikan";
  currentFetchDivision = null;
  isFetching = false;
  globalData = { members: [], tasks: [], dashboard: [], allMembers: [] };
  if (window.currentTrackerData) window.currentTrackerData = [];

  toast("Anda telah keluar.");
  applyRolePermissions();
  render();
  fetchAllMembers();
  setTimeout(() => initializeGoogleSignIn(), 100);
}

function applyRolePermissions() {
  const guest = isGuest();
  const select = $("#divisionSelect");
  if (select) {
    const hasGlobalAccess = isCurrentUserAdmin() || isCurrentUserAudit();
    // Non-Admin/Non-Audit (Koordinator & Member) hanya boleh melihat divisinya sendiri
    if (!guest && !hasGlobalAccess && currentUser && currentUser.divisionKey) {
      currentDivision = currentUser.divisionKey;
      select.value = currentUser.divisionKey;
      select.disabled = true;
    } else {
      select.disabled = false;
      if (!guest && currentUser && currentUser.divisionKey) select.value = currentDivision;
    }
    select.style.display = guest ? "none" : "";
  }

  $$(".nav-item").forEach(b => {
    const page = b.dataset.page;
    b.style.display = guest && page !== "members" ? "none" : "";
  });
  const membersNav = $('.nav-item[data-page="members"]');
  if (membersNav) membersNav.lastChild.textContent = guest ? " Cari Anggota" : " Monitoring Anggota";

  const googleBtn = $("#googleLoginBtn");
  if (googleBtn) googleBtn.style.display = guest ? "block" : "none";
  const loginBtn = $("#loginBtn");
  if (loginBtn) loginBtn.style.display = "none"; // Hide fallback button entirely

  const userProfile = $("#userProfile");
  if (userProfile) {
    userProfile.style.display = guest ? "none" : "flex";
    const userBadge = $("#userBadge");
    const userAvatar = $("#userAvatar");
    if (!guest) {
      if (userBadge) userBadge.textContent = `${currentUser.nama} · ${currentUser.role}`;
      if (userAvatar) userAvatar.textContent = String(currentUser.nama).charAt(0).toUpperCase();
    } else {
      if (userBadge) userBadge.textContent = "";
      if (userAvatar) userAvatar.textContent = "";
    }
  }
}

function openMyProfile() {
  selectedMemberId = "me";
  go("member-detail");
}

// === 1b. FETCH DAFTAR ANGGOTA SEMUA DIVISI (MODE GUEST) ===
async function fetchAllMembers() {
  if (!isGuest()) return; // Batalkan jika user telah login
  const thisSession = sessionGeneration;
  const cacheKey = "genbi_cache_all_members";
  let cachedData = null;
  try { cachedData = sessionStorage.getItem(cacheKey); } catch (e) {}

  if (cachedData) {
    try {
      globalData.allMembers = JSON.parse(cachedData);
      if (thisSession === sessionGeneration && isGuest()) render();
    } catch (e) { cachedData = null; }
  }
  if (!cachedData && thisSession === sessionGeneration && isGuest()) {
    $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat daftar anggota...</strong></div>`;
  }

  try {
    const res = await fetch(`${API_URL}?action=getAllMembers`).then(r => r.json());
    if (thisSession !== sessionGeneration || !isGuest()) return; // Batalkan jika user telah login atau sesi berubah
    const fresh = res.data || [];
    if (!cachedData || JSON.stringify(fresh) !== JSON.stringify(globalData.allMembers)) {
      globalData.allMembers = fresh;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch (e) {}
      // Jangan render ulang kalau user sedang mengetik di kolom cari
      if (thisSession === sessionGeneration && isGuest() && document.activeElement?.id !== "memberSearch") render();
    }
  } catch (e) {
    if (thisSession !== sessionGeneration || !isGuest()) return;
    if (!cachedData) {
      $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Gagal memuat data. Periksa koneksi lalu muat ulang halaman.</strong></div>`;
    }
  }
}

// === 2. FETCH DATA DIVISI ===
async function fetchDivisionData() {
  if (isGuest()) return; // Batalkan jika tidak sedang login
  const thisSession = sessionGeneration;
  const targetDivision = currentDivision; // Capture divisi saat ini untuk memblokir race condition

  const cacheKey = `genbi_cache_${targetDivision}`;
  const cachedData = sessionStorage.getItem(cacheKey);

  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      globalData.members = parsed.members;
      globalData.tasks = parsed.tasks;
      if (currentDivision === targetDivision && thisSession === sessionGeneration && !isGuest()) render();
    } catch (e) {}
  } else {
    if (!isFetching) {
      $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat Data Google Sheets (${targetDivision.toUpperCase()})...</strong></div>`;
    }
  }

  if (isFetching) return;
  isFetching = true;
  currentFetchDivision = targetDivision;

  try {
    const [membersRes, kpiRes] = await Promise.all([
      fetch(`${API_URL}?action=getMembers&division=${targetDivision}${idToken ? '&idToken=' + idToken : ''}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${targetDivision}${idToken ? '&idToken=' + idToken : ''}`).then(r => r.json())
    ]);

    // Batalkan respons jika sesi login telah berubah atau user telah logout
    if (thisSession !== sessionGeneration || isGuest()) return;

    const freshMembers = membersRes.data || [];
    const freshTasks = kpiRes.data || [];

    if (membersRes.status === "error") {
      toast(membersRes.message);
      if (membersRes.message.includes("Akses ditolak")) {
        // Clean screen or show error
        $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>${membersRes.message}</strong></div>`;
        return;
      }
    }

    // Bandingkan apakah ada perubahan data (members ATAU tasks)
    const membersChanged = JSON.stringify(freshMembers) !== JSON.stringify(globalData.members);
    const tasksChanged = JSON.stringify(freshTasks) !== JSON.stringify(globalData.tasks);
    const hasChanged = membersChanged || tasksChanged;

    if (hasChanged || !cachedData) {
      // Pastikan user belum pindah divisi sebelum data selesai dimuat
      if (currentDivision === targetDivision && thisSession === sessionGeneration && !isGuest()) {
        globalData.members = freshMembers;
        globalData.tasks = freshTasks;

        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            members: freshMembers,
            tasks: freshTasks
          }));
        } catch (e) {}

        render();
      }
    }
  } catch (e) {
    console.error("Gagal memuat data dari server:", e);
  } finally {
    if (thisSession === sessionGeneration) {
      isFetching = false;
      currentFetchDivision = null;
      // Jika ada request pindah divisi tertunda yang diblokir oleh isFetching
      if (!isGuest() && targetDivision !== currentDivision) {
        fetchDivisionData();
      }
    }
  }
}

// === 3. HELPER TAMPILAN ===
function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function head(kicker, title, sub, action = "") {
  return `<div class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="head-actions">${action}</div></div>`;
}

function stat(label, value, icon, color, foot = "") {
  return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}

function badge(status) {
  let cls = status === "Selesai" ? "green" : status === "Proses" ? "orange" : "gray";
  return `<span class="badge badge-${cls}">${esc(status || "—")}</span>`;
}

function renderEvidenceLinks(evidenceStr) {
  if (!evidenceStr) return "—";
  const links = String(evidenceStr).split("\n").filter(l => l.trim().length > 0);
  return links.map((url, idx) => {
    let clean = url.trim();
    return /^https?:\/\//i.test(clean) ? `<a href="${esc(clean)}" target="_blank" rel="noopener">Bukti ${idx + 1} ↗</a>` : esc(clean);
  }).join("<br>");
}

// === 4. HALAMAN DASHBOARD & MONITORING TUGAS ===
function overview() {
  const tasks = globalData.tasks || [];
  const members = globalData.members || [];
  const done = tasks.filter(t => t.status === "Selesai").length;

  return `
    ${head("OVERVIEW", "Dashboard", `Monitoring Divisi ${currentDivision.toUpperCase()}`)}
    <div class="stats-grid">
      ${stat("Total Anggota", members.length, "♙", "blue", "Anggota terdaftar")}
      ${stat("Total Proker", tasks.length, "▤", "purple", "Program kerja")}
      ${stat("Proker Selesai", done, "▥", "green", "Telah selesai")}
    </div>
  `;
}

function taskRow(t) {
  const prokerId = t.iDProker || t.idProker || t.IDProker || t.id || "";
  const namaTugas = t.namaProgramKerja || t.namaProker || t.namaTugas || t.nama || "-";
  const picTugas = t.pIC || t.penanggungJawab || t.pj || "-";
  const linkBukti = t.linkBuktiUtama || t.bukti || t.linkBukti || "";
  const hasBukti = Boolean(linkBukti);

  let rawProgres = Number(t.progres || t.Progres || t['%Progres'] || 0);
  const progresNum = (rawProgres > 0 && rawProgres <= 1) ? Math.round(rawProgres * 100) : rawProgres;

  let tenggatTampil = t.tenggat || t.tenggatWaktu || "-";
  if (String(tenggatTampil).includes('T')) tenggatTampil = tenggatTampil.split('T')[0];

  const isAdmin = isCurrentUserAdmin();
  const isAudit = isCurrentUserAudit();
  const isKoord = isCurrentUserKoord();
  const isRegional = isRegionalProkerId(prokerId);
  const isKomisariat = isKomisariatProkerId(prokerId);
  const isCrossScope = t.scope === "regional" || t.scope === "komisariat" || t.scope === "global" || isRegional || isKomisariat;

  // Admin: akses penuh (edit & hapus semua proker).
  // Audit: boleh mengedit KPI di seluruh divisi, tidak menghapus proker.
  // Koordinator: boleh mengedit proker divisinya & proker terpusat (Regional/Komisariat).
  //              HANYA boleh menghapus proker lokal divisinya sendiri (TIDAK boleh menghapus Regional/Komisariat).
  // Member: hanya melihat (read-only).
  const canEdit = isAdmin || isAudit || (isKoord && (isCrossScope || currentUser.divisionKey === currentDivision));
  const canDelete = isAdmin || (isKoord && !isCrossScope && currentUser.divisionKey === currentDivision);

  let actionsHTML = "-";
  if (canEdit || canDelete) {
    const scopeVal = isRegional ? "regional" : (isKomisariat ? "komisariat" : "local");
    const editBtn = canEdit ? `<button class="mini-btn" onclick="openUploadModal('${esc(prokerId)}')">Edit</button>` : "";
    const deleteBtn = canDelete ? `<button class="mini-btn" style="background:#fce8e8;color:#d32f2f;" onclick="handleDeleteProker('${esc(prokerId)}', '${scopeVal}')">Hapus</button>` : "";
    actionsHTML = `
      <div style="display:flex;align-items:center;gap:4px">
        ${editBtn}
        ${deleteBtn}
      </div>
    `;
  }

  let scopeBadge = "";
  if (isRegional) {
    scopeBadge = ' <span class="badge badge-purple" style="font-size:0.7em">Regional</span>';
  } else if (isKomisariat) {
    scopeBadge = ' <span class="badge badge-blue" style="font-size:0.7em">Komisariat</span>';
  } else {
    scopeBadge = ' <span class="badge badge-gray" style="font-size:0.7em">Lokal</span>';
  }

  if (!window._prokerNotes) window._prokerNotes = {};
  let catatanHTML = "—";
  const rawCatatan = t.catatan || t.Catatan || "";
  const cleanCatatan = String(rawCatatan).trim();
  if (cleanCatatan && cleanCatatan !== "-" && cleanCatatan !== "—" && cleanCatatan.toLowerCase() !== "null") {
    window._prokerNotes[prokerId] = cleanCatatan;
    const isMultiLine = cleanCatatan.includes("\n");
    const isLong = cleanCatatan.length > 45;

    if (isMultiLine || isLong) {
      const firstLine = cleanCatatan.split("\n")[0].trim();
      const snippet = firstLine.length > 35 ? firstLine.substring(0, 35) + "..." : (firstLine + (isMultiLine ? "..." : ""));
      catatanHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">
          <span>${esc(snippet)}</span>
          <button class="mini-btn" type="button" style="padding:3px 7px;font-size:10px;" onclick="openNoteModal('${esc(prokerId)}', '${esc(namaTugas)}')">Cek Catatan</button>
        </div>
      `;
    } else {
      catatanHTML = esc(cleanCatatan);
    }
  }

  return `
    <tr>
      <td><strong>${esc(prokerId)}</strong>${scopeBadge}</td>
      <td>${esc(namaTugas)}</td>
      <td>${esc(t.divisi || currentDivision)}</td>
      <td>${esc(picTugas)}</td>
      <td>${badge(t.status || "Belum Mulai")}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress-track" style="min-width:60px;"><div class="progress-fill" style="width:${progresNum}%"></div></div>
          ${progresNum}%
        </div>
      </td>
      <td>${esc(tenggatTampil)}</td>
      <td>${renderEvidenceLinks(linkBukti)}</td>
      <td>${catatanHTML}</td>
      <td>${actionsHTML}</td>
    </tr>
  `;
}

function tasksPage() {
  const rawTasks = globalData.tasks || [];
  const sortedTasks = sortTasks(rawTasks, prokerSortOption);
  const rows = sortedTasks.map(taskRow).join("");

  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isKoord = roleLower.includes("koordinator") || roleLower.includes("kord");

  let addBtn = "";
  if (isAdmin || isKoord) {
    addBtn = `<button class="btn btn-primary" onclick="handleAddProkerPrompt()">+ Tambah Proker Baru</button>`;
  }

  const sortControls = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:6px">
        <label for="prokerSortSelect" style="font-size:0.82em;font-weight:600;color:var(--text-muted);white-space:nowrap;">Urutan:</label>
        <select id="prokerSortSelect" class="select" onchange="handleSortProker(this.value)" style="padding:6px 10px;font-size:0.85em;border-radius:6px;">
          <option value="default" ${prokerSortOption === 'default' ? 'selected' : ''}>Standar</option>
          <option value="regional-komisariat-local" ${(prokerSortOption === 'regional-komisariat-local' || prokerSortOption === 'global-regional-local') ? 'selected' : ''}>Regional → Komisariat → Lokal</option>
          <option value="local-regional-komisariat" ${(prokerSortOption === 'local-regional-komisariat' || prokerSortOption === 'local-regional-global') ? 'selected' : ''}>Lokal → Regional → Komisariat</option>
          <option value="progres-desc" ${prokerSortOption === 'progres-desc' ? 'selected' : ''}>Progres Tertinggi → Terendah</option>
          <option value="progres-asc" ${prokerSortOption === 'progres-asc' ? 'selected' : ''}>Progres Terendah → Tertinggi</option>
        </select>
      </div>
      ${addBtn}
    </div>
  `;

  return `
    ${head("DATA & MONITORING", "Monitoring Tugas", "Pantau tugas, progres, bukti, dan catatan situasi khusus.", sortControls)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nama Tugas</th>
              <th>Divisi</th>
              <th>Penanggung Jawab</th>
              <th>Status</th>
              <th>Progres</th>
              <th>Tenggat</th>
              <th>Bukti</th>
              <th>Catatan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="10" class="empty-cell">Belum ada proker terdaftar.</td></tr>'}</tbody>
        </table>
      </div>
      </section>
  `;
}

// === 5. HALAMAN ANGGOTA & DETAIL PROFIL (DENGAN TRACKER TAB) ===
// Backend mengubah header "ID Anggota" menjadi key "iDAnggota", jadi cek beberapa kemungkinan.
// Kalau kolom ID kosong, pakai nama lengkap agar tombol Detail tetap berfungsi.
// Untuk daftar lintas divisi (guest), awalan divisionKey menjaga ID tetap unik.
function getMemberId(m) {
  const base = String(m.iDAnggota || m.idAnggota || m.IDAnggota || m.id || m.namaLengkap || m.nama || "").trim();
  return (m.divisionKey ? m.divisionKey + "|" : "") + base;
}

function getMemberDivisionKey(m) {
  return m.divisionKey || currentDivision;
}

function currentMemberList() {
  return isGuest() ? (globalData.allMembers || []) : (globalData.members || []);
}

function filterMembers(list, query) {
  const named = list.filter(m => m.namaLengkap || m.nama);
  const q = String(query || "").trim().toLowerCase();
  if (!q) return named;
  return named.filter(m => [
    m.namaLengkap, m.nama, m.namaPanggilan, m.panggilan,
    m.divisi, DIVISION_LABELS[getMemberDivisionKey(m)], m.role, m.iDAnggota
  ].some(v => String(v || "").toLowerCase().includes(q)));
}

function memberRow(m) {
  const id = getMemberId(m);
  const idTampil = m.iDAnggota || m.idAnggota || m.IDAnggota || m.id || "—";
  const divTampil = m.divisi || DIVISION_LABELS[getMemberDivisionKey(m)] || getMemberDivisionKey(m);
  return `
    <tr>
      <td><strong>${esc(idTampil)}</strong></td>
      <td><strong>${esc(m.namaLengkap || m.nama || "—")}</strong></td>
      <td>${esc(divTampil)}</td>
      <td><button class="mini-btn" data-member-detail="${esc(id)}">Detail</button></td>
    </tr>
  `;
}

function memberRows(list) {
  const filtered = filterMembers(list, memberQuery);
  if (filtered.length === 0) {
    const msg = memberQuery ? `Tidak ada anggota yang cocok dengan "${esc(memberQuery)}".` : "Belum ada anggota.";
    return `<tr><td colspan="4" class="empty-cell">${msg}</td></tr>`;
  }
  return filtered.map(memberRow).join("");
}

// Hanya isi tabel yang diganti agar kolom cari tidak kehilangan fokus saat mengetik
function onMemberSearch(value) {
  memberQuery = value;
  const tbody = $("#memberTableBody");
  if (tbody) tbody.innerHTML = memberRows(currentMemberList());
}


function membersPage() {
  const guest = isGuest();
  const members = currentMemberList();

  return `
    ${head(
      guest ? "PROFIL ANGGOTA" : "DATA & MONITORING",
      guest ? "Cari Anggota" : "Monitoring Anggota",
      guest ? "Cari anggota GenBI dari semua divisi dan buka profilnya." : "Cari anggota dan buka profil detail."
    )}
    <section class="panel">
      <div class="toolbar">
        <input id="memberSearch" type="search" placeholder="Cari nama, panggilan, divisi, atau role..." value="${esc(memberQuery)}" oninput="onMemberSearch(this.value)" autocomplete="off">
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID Anggota</th>
              <th>Nama Lengkap</th>
              <th>Divisi</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody id="memberTableBody">${memberRows(members)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function memberDetailPage() {
  const isMe = selectedMemberId === "me";
  const m = isMe ? currentUser : currentMemberList().find(x => getMemberId(x) === String(selectedMemberId));

  if (!m) return membersPage();

  const divKey = isMe ? m.divisionKey : getMemberDivisionKey(m);
  const backBtn = `<button class="btn btn-light" data-page="${isMe ? 'overview' : 'members'}">? Kembali</button>`;
  const namaPanggilan = m.panggilan || m.namaPanggilan || String(m.namaLengkap || m.nama || "").split(' ')[0];

  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isAudit = roleLower.includes("audit");
  // Hanya Admin dan Audit yang memiliki hak untuk mengelola tracker
  const canManageTracker = isAdmin || isAudit;
  // Hanya Admin dan Audit yang dapat melihat nominal poin per aktivitas (disembunyikan untuk Member biasa)
  const canSeePoin = isAdmin || isAudit;

  // Ambil data tracker dari tab perorangan di Google Sheets
  const cacheKeyTracker = `genbi_tracker_${divKey}_${namaPanggilan}`;

  const renderTrackerRows = (dataList) => {
    if (!dataList || dataList.length === 0) {
      return `<tr><td colspan="3" class="empty-cell">Belum ada riwayat / Tab '${esc(namaPanggilan)}' tidak ditemukan.</td></tr>`;
    }
    return dataList.map((t, idx) => {
      let dateStr = t.tanggal;
      if (t.tanggal instanceof Date) dateStr = t.tanggal.toLocaleDateString('id-ID');
      else if (String(t.tanggal).includes('T')) dateStr = t.tanggal.split('T')[0];

      let actionBtns = "-";
      if (canManageTracker && t.rowId) {
        actionBtns = `
          <div style="display:flex;gap:4px">
            <button class="mini-btn" onclick="openTrackerModal('edit', '${divKey}', '${esc(namaPanggilan)}', ${t.rowId}, ${idx})">Edit</button>
            <button class="mini-btn" style="background:#fce8e8;color:#d32f2f;" onclick="deleteTrackerRow('${divKey}', '${esc(namaPanggilan)}', ${t.rowId})">Hapus</button>
          </div>
        `;
      }

      const poinBadge = canSeePoin
        ? ` <span class="badge ${t.poin > 0 ? 'badge-green' : (t.poin < 0 ? 'badge-red' : 'badge-gray')}" style="margin-left:8px;">${t.poin > 0 ? '+' : ''}${esc(t.poin)} Poin</span>`
        : "";

      return `
      <tr>
        <td style="white-space: nowrap;">${esc(dateStr)}</td>
        <td>
          <strong>${esc(t.kegiatan)}</strong>${poinBadge}
          <br><small>${esc(t.catatan)}</small>
        </td>
        <td>${actionBtns}</td>
      </tr>
    `}).join("");
  };

  const updateTrackerDOM = (res) => {
    if (res.totalPoin !== undefined) {
      const totalPoin = Number(res.totalPoin) || 0;
      const statusText = res.statusEvaluasi || "Belum memenuhi";
      const statusColor = statusText === "Memenuhi" ? "#15966a" : (totalPoin > 0 ? "#e88a22" : "#71819a");

      const txtEl = $("#progressText");
      if (txtEl) txtEl.textContent = `${totalPoin} Poin`;

      const statusEl = $("#progressStatus");
      if (statusEl) {
        statusEl.textContent = statusText;
        statusEl.style.color = statusColor;
        statusEl.style.fontWeight = "600";
      }
    }

    const tbody = $("#trackerTableBody");
    if (!tbody) return;

    if (res.status === "error") {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-cell" style="color:#b93a3a;"><strong>Akses Ditolak:</strong> ${esc(res.message)}</td></tr>`;
    } else if (res.status === "success" && Array.isArray(res.data)) {
      window.currentTrackerData = res.data; // Simpan untuk edit
      tbody.innerHTML = renderTrackerRows(res.data);
    } else {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Belum ada riwayat / Tab '${esc(namaPanggilan)}' tidak ditemukan.</td></tr>`;
    }
  };

  let initialTbodyHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px;"><em>Memuat riwayat poin...</em></td></tr>`;
  const cachedTracker = sessionStorage.getItem(cacheKeyTracker);
  if (cachedTracker) {
    try {
      const parsedTracker = JSON.parse(cachedTracker);
      if (parsedTracker && parsedTracker.status === "success" && Array.isArray(parsedTracker.data)) {
        window.currentTrackerData = parsedTracker.data;
        initialTbodyHTML = renderTrackerRows(parsedTracker.data);
      }
    } catch(e) {}
  }

  const thisSession = sessionGeneration;
  const currentMemberId = selectedMemberId;
  fetch(`${API_URL}?action=getTracker&division=${encodeURIComponent(divKey)}&nickname=${encodeURIComponent(namaPanggilan)}${idToken ? '&idToken=' + idToken : ''}`)
    .then(r => r.json())
    .then(res => {
      if (thisSession !== sessionGeneration || isGuest()) return;
      try { sessionStorage.setItem(cacheKeyTracker, JSON.stringify(res)); } catch(e) {}
      if (currentPage === "member-detail" && selectedMemberId === currentMemberId) {
        updateTrackerDOM(res);
      }
    })
    .catch(() => {
      if (thisSession !== sessionGeneration || isGuest()) return;
      if (currentPage === "member-detail" && selectedMemberId === currentMemberId && !cachedTracker) {
        const tbody = $("#trackerTableBody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Gagal memuat riwayat. Periksa koneksi.</td></tr>`;
      }
    });

  let addTrackerBtnHTML = "";
  if (canManageTracker) {
    addTrackerBtnHTML = `<button class="btn btn-primary" style="margin-top:10px" onclick="openTrackerModal('add', '${divKey}', '${esc(namaPanggilan)}')">+ Tambah Riwayat</button>`;
  }

  return `
    ${head("MONITORING ANGGOTA", "Detail Anggota", `Profil dan riwayat keaktifan ${esc(m.namaLengkap || m.nama)}.`, backBtn)}

    <div class="stats-grid">
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-label">Nama Anggota</span>
          <span class="stat-icon blue">♙</span>
        </div>
        <div class="stat-value">${esc(m.namaLengkap || m.nama)}</div>
        <div class="stat-foot">${esc(m.iDAnggota || m.idAnggota || m.id || "—")}</div>
        <div style="font-size: 0.85em; color: #666; margin-top: 4px; overflow-wrap: anywhere;">
          ${esc(m.email || m.surel || namaPanggilan)}
        </div>
      </article>

      ${stat("Divisi", esc(m.divisi || DIVISION_LABELS[divKey] || divKey), "▣", "purple", "Divisi aktif")}
      ${stat("Role / Jabatan", esc(m.role || m.jabatan || "Anggota"), "✦", "green", "Posisi kepengurusan")}
    </div>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Riwayat Keaktifan</h2>
          <p>Daftar riwayat aktivitas, keaktifan, dan evaluasi anggota.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 150px;">Tanggal</th>
              <th>Aktivitas & Catatan Auditor</th>
              <th style="width: 120px;">Aksi</th>
            </tr>
          </thead>
          <tbody id="trackerTableBody">
            ${initialTbodyHTML}
          </tbody>
        </table>
      </div>
      ${addTrackerBtnHTML}
      </section>
  `;
}

// === 6. MODAL UPLOAD LINK & TAMBAH PROKER ===
function openNoteModal(prokerId, namaTugas) {
  const modal = $("#noteDetailModal");
  if (!modal) return;
  const note = (window._prokerNotes && window._prokerNotes[prokerId]) || "Tidak ada catatan.";
  const titleEl = $("#noteModalTitle");
  const bodyEl = $("#noteModalBody");
  if (titleEl) titleEl.textContent = `Catatan: ${namaTugas} (${prokerId})`;
  if (bodyEl) bodyEl.textContent = note;
  modal.showModal();
}

function openUploadModal(idProker) {
  const task = globalData.tasks.find(t => String(t.iDProker || t.idProker || t.id) === String(idProker));
  if (!task) {
    toast("ID Proker tidak ditemukan!");
    return;
  }

  const isRegional = isRegionalProkerId(idProker);
  const isKomisariat = isKomisariatProkerId(idProker);
  const isCrossScope = isRegional || isKomisariat || task.scope === "regional" || task.scope === "komisariat" || task.scope === "global";

  const isAdmin = isCurrentUserAdmin();
  const isAudit = isCurrentUserAudit();
  const isKoord = isCurrentUserKoord();
  const canManage = isAdmin || isAudit || (isKoord && (isCrossScope || currentUser.divisionKey === currentDivision));
  if (!canManage) {
    toast("Akses ditolak: Anda tidak memiliki hak untuk mengedit proker ini.");
    return;
  }

  $("#formProkerId").value = idProker;
  $("#modalProkerTitle").textContent = `Update: ${task.namaProgramKerja || task.namaProker || idProker}`;

  if ($("#formNamaProker")) {
    $("#formNamaProker").value = task.namaProgramKerja || task.namaProker || task.namaTugas || task.nama || "";
  }

  // Konversi progres untuk input form
  let rawProgres = Number(task.progres || task.Progres || task['%Progres'] || 0);
  $("#formProgres").value = (rawProgres > 0 && rawProgres <= 1) ? Math.round(rawProgres * 100) : rawProgres;

  $("#formStatus").value = task.status || "Belum Mulai";
  $("#formPic").value = task.pIC || task.penanggungJawab || task.pj || "";
  $("#formCatatan").value = task.catatan || "";
  $("#formLinkBukti").value = task.linkBuktiUtama || task.bukti || task.linkBukti || "";

  // Ambil tanggal untuk ditaruh di type="date"
  let tgl = task.tenggat || task.tenggatWaktu || "";
  if (String(tgl).includes('T')) tgl = String(tgl).split('T')[0];
  $("#formTenggat").value = tgl;

  // Validasi hak akses tenggat waktu: Hanya Audit dan Admin yang dapat mengatur / mengedit
  const canEditTenggat = isAdmin || isAudit;
  const tenggatInput = $("#formTenggat");
  if (tenggatInput) {
    tenggatInput.disabled = !canEditTenggat;
  }
  const tenggatHelp = $("#formTenggatHelp");
  if (tenggatHelp) {
    tenggatHelp.style.display = canEditTenggat ? "none" : "block";
  }

  $("#uploadModal")?.showModal();
}

function handleAddProkerPrompt() {
  const isAdmin = isCurrentUserAdmin();
  const isKoord = isCurrentUserKoord();
  if (!isAdmin && !isKoord) {
    toast("Akses ditolak: Hanya Admin dan Koordinator yang dapat menambah program kerja.");
    return;
  }
  $("#addProkerForm")?.reset();
  const scopeContainer = $("#addProkerScopeContainer");
  if (scopeContainer) {
    scopeContainer.style.display = (isAdmin || isKoord) ? "block" : "none";
  }
  $("#addProkerModal")?.showModal();
}

function submitAddProker(e) {
  e.preventDefault();
  const isAdmin = isCurrentUserAdmin();
  const isKoord = isCurrentUserKoord();
  if (!isAdmin && !isKoord) {
    toast("Akses ditolak: Hanya Admin dan Koordinator yang dapat menambah program kerja.");
    return;
  }

  const namaProker = $("#addProkerName").value.trim();
  const scope = $("#addProkerScope") ? $("#addProkerScope").value : "local";
  const pic = $("#addProkerPic") ? $("#addProkerPic").value.trim() : "-";
  const tenggat = $("#addProkerTenggat") ? $("#addProkerTenggat").value : "";

  if (!namaProker) {
    toast("Nama Program Kerja tidak boleh kosong!");
    return;
  }

  $("#addProkerModal")?.close();
  toast("Menyiapkan proker baru...");

  const payload = {
    action: "addProker",
    division: currentDivision,
    scope: scope,
    prokerData: {
      namaProker: namaProker,
      pic: pic || "-",
      tenggat: tenggat || ""
    }
  };

  sendPostPayload(payload);
}

function handleDeleteProker(idProker, scope) {
  const isAdmin = isCurrentUserAdmin();
  const isKoord = isCurrentUserKoord();
  const isRegional = isRegionalProkerId(idProker);
  const isKomisariat = isKomisariatProkerId(idProker);
  const isCrossScope = scope === "regional" || scope === "komisariat" || scope === "global" || isRegional || isKomisariat;

  // Kebijakan ketat: Penghapusan Regional & Komisariat HANYA dapat dilakukan oleh Admin
  if (isCrossScope && !isAdmin) {
    toast("Akses ditolak: Penghapusan proker Regional dan Komisariat hanya dapat dilakukan oleh Admin.");
    return;
  }

  const canManage = isAdmin || (isKoord && !isCrossScope && currentUser.divisionKey === currentDivision);
  if (!canManage) {
    toast("Akses ditolak: Anda tidak memiliki hak untuk menghapus proker ini.");
    return;
  }

  if (!confirm(`Apakah Anda yakin ingin menghapus proker ${idProker}? Tindakan ini tidak dapat dibatalkan.`)) return;

  toast(`Menghapus proker ${idProker}...`);
  const effectiveScope = scope || (isRegional ? "regional" : (isKomisariat ? "komisariat" : "local"));
  sendPostPayload({
    action: "deleteProker",
    division: currentDivision,
    scope: effectiveScope,
    idProker: idProker
  });
}

async function handleSaveProker(e) {
  e.preventDefault();
  const idProker = $("#formProkerId").value;
  const isRegional = isRegionalProkerId(idProker);
  const isKomisariat = isKomisariatProkerId(idProker);
  const isCrossScope = isRegional || isKomisariat;

  const isAdmin = isCurrentUserAdmin();
  const isAudit = isCurrentUserAudit();
  const isKoord = isCurrentUserKoord();
  const canManage = isAdmin || isAudit || (isKoord && (isCrossScope || currentUser.divisionKey === currentDivision));
  if (!canManage) {
    toast("Akses ditolak: Anda tidak memiliki hak untuk mengedit proker ini.");
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";
  }

  const canEditTenggat = isAdmin || isAudit;
  const payload = {
    action: "uploadEvidence",
    division: currentDivision,
    scope: isRegional ? "regional" : (isKomisariat ? "komisariat" : "local"),
    idProker: idProker,
    namaProker: $("#formNamaProker") ? $("#formNamaProker").value.trim() : "",
    progres: Number($("#formProgres").value),
    status: $("#formStatus").value,
    pic: $("#formPic").value.trim(),
    catatan: $("#formCatatan").value.trim(),
    linkBukti: $("#formLinkBukti").value.trim(),
    tenggat: $("#formTenggat") ? $("#formTenggat").value : ""
  };

  toast("Menyimpan data ke Google Sheets...");
  try {
    await sendPostPayload(payload);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan Perubahan";
    }
  }
}

async function sendPostPayload(payload) {
  if (idToken) payload.idToken = idToken;
  const thisSession = sessionGeneration;
  try {
    const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) }).then(r => r.json());
    if (thisSession !== sessionGeneration || isGuest()) {
      return null; // Sesi usang: jangan ubah UI atau trigger sinkronisasi
    }
    if (res.status === "success") {
      toast(res.message || "Berhasil disimpan!");
      $("#uploadModal")?.close();
      $("#addProkerModal")?.close();
      $("#trackerModal")?.close();

      // Background sync
      fetchDivisionData();
      return res;
    } else {
      toast("Gagal: " + res.message);
      return Promise.reject(res.message);
    }
  } catch (err) {
    if (thisSession !== sessionGeneration || isGuest()) return null;
    toast("Terjadi kesalahan koneksi!");
    return Promise.reject(err);
  }
}

// === 7. EVENT LISTENER & NAVIGASI ===
const pageRender = {
  overview,
  members: membersPage,
  "member-detail": memberDetailPage,
  tasks: tasksPage
};

function render() {
  // Guest hanya boleh melihat pencarian anggota & profil
  if (isGuest() && !["members", "member-detail"].includes(currentPage)) currentPage = "members";
  const fn = pageRender[currentPage] || overview;
  $("#content").innerHTML = fn();
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === (currentPage === "member-detail" ? "members" : currentPage)));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function go(page) {
  currentPage = page;
  render();
  $("#sidebar")?.classList.remove("open");
}

document.addEventListener("click", e => {
  const nav = e.target.closest("[data-page]");
  if (nav) { go(nav.dataset.page); return; }

  const detailBtn = e.target.closest("[data-member-detail]");
  if (detailBtn) {
    selectedMemberId = detailBtn.dataset.memberDetail;
    go("member-detail");
  }

  // Close sidebar on mobile when clicking outside
  const sidebar = $("#sidebar");
  if (sidebar && sidebar.classList.contains("open") && !e.target.closest("#sidebar") && !e.target.closest("#menuBtn")) {
    sidebar.classList.remove("open");
  }
});

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "divisionSelect") {
    currentDivision = e.target.value;
    fetchDivisionData();
  }
});

$("#menuBtn").onclick = () => $("#sidebar")?.classList.add("open");
if ($("#closeSidebarBtn")) {
  $("#closeSidebarBtn").onclick = () => $("#sidebar")?.classList.remove("open");
}

// Swipe Gestures for Mobile Sidebar
let touchStartX = 0;
let touchStartY = 0;
document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

document.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].screenX;
  const touchEndY = e.changedTouches[0].screenY;
  const swipeDistX = touchEndX - touchStartX;
  const swipeDistY = Math.abs(touchEndY - touchStartY);
  const sidebar = $("#sidebar");
  if (!sidebar) return;

  // Pastikan swipe lebih horizontal daripada vertikal (mencegah scroll vertikal memicu sidebar)
  if (Math.abs(swipeDistX) > swipeDistY) {
    // Usap ke kanan untuk membuka (jika mulai dari pinggir kiri)
    if (swipeDistX > 50 && touchStartX < 30) {
      sidebar.classList.add("open");
    }
    // Usap ke kiri untuk menutup
    if (swipeDistX < -50 && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
    }
  }
}, {passive: true});

// Jalankan Inisialisasi Utama
initApp();





// === TRACKER CRUD FUNCTIONS ===
window.currentTrackerContext = {};

function openTrackerModal(action, divKey, nickname, rowId = null, dataIdx = null) {
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isAudit = roleLower.includes("audit");
  if (!isAdmin && !isAudit) {
    toast("Akses ditolak: Hanya Admin dan Audit yang memiliki hak untuk mengelola riwayat keaktifan.");
    return;
  }

  window.currentTrackerContext = { action, divKey, nickname, rowId };
  $("#trackerModalTitle").textContent = action === "add" ? "Tambah Riwayat" : "Edit Riwayat";
  $("#formTrackerAction").value = action;
  $("#formTrackerRowId").value = rowId || "";

  if (action === "edit" && window.currentTrackerData && window.currentTrackerData[dataIdx]) {
    const t = window.currentTrackerData[dataIdx];
    let dateStr = t.tanggal;
    if (t.tanggal instanceof Date) dateStr = t.tanggal.toISOString().split('T')[0];
    else if (String(t.tanggal).includes('T')) dateStr = t.tanggal.split('T')[0];
    else {
      try { dateStr = new Date(t.tanggal).toISOString().split('T')[0]; } catch(e) { dateStr = ""; }
    }

    $("#formTrackerTanggal").value = dateStr;
    $("#formTrackerKegiatan").value = t.kegiatan || "";
    $("#formTrackerPoin").value = t.poin || 0;
    $("#formTrackerCatatan").value = t.catatan || "";
  } else {
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const localDate = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
    $("#formTrackerTanggal").value = localDate;
    $("#formTrackerKegiatan").value = "";
    $("#formTrackerPoin").value = "";
    $("#formTrackerCatatan").value = "";
  }

  $("#trackerModal")?.showModal();
}

function handleSaveTracker(e) {
  e.preventDefault();
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isAudit = roleLower.includes("audit");
  if (!isAdmin && !isAudit) {
    toast("Akses ditolak: Hanya Admin dan Audit yang memiliki hak untuk mengelola riwayat keaktifan.");
    return;
  }

  const ctx = window.currentTrackerContext;
  if (!ctx || !ctx.divKey) return;

  $("#trackerModal")?.close();
  toast("Menyimpan riwayat...");

  const payload = {
    action: "manageTracker",
    division: ctx.divKey,
    actionTracker: $("#formTrackerAction").value,
    nickname: ctx.nickname,
    rowId: $("#formTrackerRowId").value ? Number($("#formTrackerRowId").value) : null,
    tanggal: $("#formTrackerTanggal").value,
    kegiatan: $("#formTrackerKegiatan").value.trim(),
    poin: Number($("#formTrackerPoin").value),
    catatan: $("#formTrackerCatatan").value.trim()
  };

  sendPostPayload(payload).then((res) => {
    if (res && currentPage === "member-detail") go("member-detail");
  }).catch(() => {});
}

function deleteTrackerRow(divKey, nickname, rowId) {
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isAudit = roleLower.includes("audit");
  if (!isAdmin && !isAudit) {
    toast("Akses ditolak: Hanya Admin dan Audit yang memiliki hak untuk mengelola riwayat keaktifan.");
    return;
  }

  if (!confirm("Hapus baris riwayat ini? Tindakan ini tidak dapat dibatalkan.")) return;
  toast("Menghapus riwayat...");
  const payload = {
    action: "manageTracker",
    division: divKey,
    actionTracker: "delete",
    nickname: nickname,
    rowId: rowId
  };
  sendPostPayload(payload).then((res) => {
    if (res && currentPage === "member-detail") go("member-detail");
  }).catch(() => {});
}















