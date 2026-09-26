const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const DB_KEY = "the-gb-dash-demo-v1";
const seed = {
  members:[
    {id:"A001",name:"Nadia Putri",division:"Pendidikan",email:"nadia@example.test"},
    {id:"A002",name:"Rafi Pratama",division:"PSDM",email:"rafi@example.test"},
    {id:"A003",name:"Hafizh Ikhwanul",division:"Pendidikan",email:"hafizh@example.test"},
    {id:"A004",name:"Salsa Amalia",division:"Pubsos",email:"salsa@example.test"},
    {id:"A005",name:"Dimas Akbar",division:"Pubsos",email:"dimas@example.test"},
    {id:"A006",name:"Alya Rahmi",division:"Kewirausahaan",email:"alya@example.test"}
  ],
  activities:[
    {id:"K001",name:"Rapat Koordinasi",date:"2026-09-15",division:"Pengurus",note:"Kegiatan"},
    {id:"K002",name:"GenBI Mengajar",date:"2026-09-18",division:"Pendidikan",note:"Kegiatan"},
    {id:"K003",name:"Kampanye Literasi",date:"2026-09-22",division:"Pubsos",note:"Kegiatan"}
  ],
  tasks:[
    {id:"T001",name:"Menyusun konsep kegiatan",division:"Pendidikan",owner:"A001",status:"Selesai",progress:100,due:"2026-09-28",evidence:"https://example.com/bukti-t001",note:"Dokumen konsep sudah dikumpulkan."},
    {id:"T002",name:"Menyiapkan materi publikasi",division:"Pubsos",owner:"A004",status:"Proses",progress:60,due:"2026-09-29",evidence:"",note:"Menunggu konfirmasi desain dari tim."},
    {id:"T003",name:"Menyusun daftar kebutuhan",division:"PSDM",owner:"A002",status:"Belum Mulai",progress:0,due:"2026-10-02",evidence:"",note:""},
    {id:"T004",name:"Membuat rancangan evaluasi",division:"Pendidikan",owner:"A003",status:"Proses",progress:35,due:"2026-10-04",evidence:"",note:"Progres tertunda karena menunggu data."}
  ],
  reviews:[
    {id:"M001",date:"2026-09-18",member:"A001",activity:"K002",attendance:"Hadir",contribution:"Panitia",observer:"Auditor 01",note:"Catatan monitoring"},
    {id:"M002",date:"2026-09-18",member:"A003",activity:"K002",attendance:"Hadir",contribution:"Peserta aktif",observer:"Auditor 02",note:"Catatan monitoring"},
    {id:"M003",date:"2026-09-22",member:"A004",activity:"K003",attendance:"Hadir",contribution:"PIC publikasi",observer:"Auditor 03",note:"Catatan monitoring"},
    {id:"M004",date:"2026-09-22",member:"A005",activity:"K003",attendance:"Tidak Hadir",contribution:"-",observer:"Auditor 04",note:"Catatan monitoring"},
    {id:"M005",date:"2026-09-15",member:"A002",activity:"K001",attendance:"Hadir",contribution:"Notulis",observer:"Auditor 05",note:"Catatan monitoring"}
  ]
};
let db = loadDB();
let currentPage = "overview";
let editContext = null;
let selectedMemberId = null;
const demoKpi = {A001:28,A002:22,A003:31,A004:26,A005:18,A006:30};
const demoKpiHistory = {
 A001:[{date:"2026-09-18",label:"Mengikuti GenBI Mengajar",detail:"Kehadiran dan kontribusi",points:5},{date:"2026-09-20",label:"Disiplin administrasi",detail:"Pengumpulan laporan tepat waktu",points:3}],
 A002:[{date:"2026-09-15",label:"Rapat Koordinasi",detail:"Hadir sebagai notulis",points:5},{date:"2026-09-21",label:"Iuran belum dibayar",detail:"Pengurangan poin",points:-5}],
 A003:[{date:"2026-09-18",label:"GenBI Mengajar",detail:"Peserta aktif",points:5},{date:"2026-09-23",label:"Kontribusi kegiatan",detail:"Poin tambahan",points:4}],
 A004:[{date:"2026-09-22",label:"Kampanye Literasi",detail:"PIC publikasi",points:5}],
 A005:[{date:"2026-09-22",label:"Tidak hadir kegiatan",detail:"Pengurangan poin",points:-5}],
 A006:[{date:"2026-09-24",label:"Kontribusi kegiatan",detail:"Poin tambahan",points:5}]
};
function loadDB(){try{const saved=localStorage.getItem(DB_KEY);return saved?JSON.parse(saved):structuredClone(seed)}catch(e){return structuredClone(seed)}}
function saveDB(){localStorage.setItem(DB_KEY,JSON.stringify(db))}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function memberName(id){return db.members.find(x=>x.id===id)?.name||id||"—"}
function activityName(id){return db.activities.find(x=>x.id===id)?.name||id||"—"}
function nextId(type,arr){let n=Math.max(0,...arr.map(x=>Number((x.id||"").slice(1))||0))+1;return type+String(n).padStart(3,"0")}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function head(kicker,title,sub,action=""){return `<div class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="head-actions">${action}</div></div>`}
function stat(label,value,icon,color,foot=""){return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`}
function emptyRow(cols,msg="Belum ada data"){return `<tr><td colspan="${cols}" class="empty-cell"><div style="font-size:24px">▤</div><strong>${msg}</strong><span>Data akan muncul setelah ditambahkan.</span></td></tr>`}
function badge(status){let cls=status==="Selesai"||status==="Hadir"?"green":status==="Proses"||status==="Izin"?"orange":status==="Tidak Hadir"?"red":"gray";return `<span class="badge badge-${cls}">${esc(status||"—")}</span>`}
function table(headers,rows,emptyText){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows||emptyRow(headers.length,emptyText)}</tbody></table></div>`}
function overview(){
 const done=db.tasks.filter(t=>t.status==="Selesai").length;
 const avg=db.tasks.length?Math.round(db.tasks.reduce((a,t)=>a+(+t.progress||0),0)/db.tasks.length):0;
 return `${head("OVERVIEW","Dashboard","Ringkasan informasi anggota, acara, dan monitoring GenBI.")}
 <div class="stats-grid">${stat("Total Anggota",db.members.length,"♙","blue","")}${stat("Total Acara",db.activities.length,"▣","green","")}${stat("Total Tugas / Proker",db.tasks.length,"▤","purple","")}${stat("Progres Keseluruhan",avg+"%","▥","orange",done+" tugas selesai")}</div>
 ${taskStatusPanel()}
`
}
function taskStatusPanel(){const statuses=[{name:"Belum Mulai",color:"#b8c3d3"},{name:"Proses",color:"#f5a623"},{name:"Selesai",color:"#19a775"}];const total=db.tasks.length;const counts=statuses.map(x=>({...x,count:db.tasks.filter(t=>t.status===x.name).length}));const a=total?counts[0].count/total*100:0,b=total?counts[1].count/total*100:0;return `<section class="panel"><div class="panel-head"><div><h2>Status Tugas / Proker</h2><p>Ringkasan jumlah tugas berdasarkan status.</p></div></div><div class="donut-wrap"><div class="donut" style="background:${total?donutGradient():"conic-gradient(#dce3ed 0 100%)"}"><div class="donut-center"><strong>${total}</strong><small>Total tugas</small></div></div><div class="legend">${counts.map(x=>legendRow(x.name,x.count,x.color)).join("")}</div></div></section>`}
function legendRow(label,count,color){return `<div class="legend-row"><i class="dot" style="background:${color}"></i><span>${label}</span><strong>${count}</strong></div>`}
function donutGradient(){const total=db.tasks.length||1;const a=db.tasks.filter(t=>t.status==="Belum Mulai").length/total*100;const b=db.tasks.filter(t=>t.status==="Proses").length/total*100;return `conic-gradient(#b8c3d3 0 ${a}%,#f5a623 ${a}% ${a+b}%,#19a775 ${a+b}% 100%)`}
function memberRow(m){const score=demoKpi[m.id]??0;return `<tr><td><strong>${esc(m.id)}</strong></td><td><strong>${esc(m.name)}</strong></td><td>${esc(m.division)}</td><td><span class="badge ${score>=25?"badge-green":"badge-orange"}">${score}/25</span></td><td><div class="row-actions"><button class="mini-btn" data-member-detail="${esc(m.id)}">Detail</button></div></td></tr>`}
function membersPage(){const rows=db.members.map(memberRow).join("");
 return `${head("DATA & MONITORING","Monitoring Anggota","Cari anggota dan buka detail KPI serta riwayat monitoring.")}<section class="panel"><div class="toolbar"><input data-filter placeholder="Cari nama, NIM/ID, atau divisi..." /><select data-filter-select><option value="">Semua divisi</option>${[...new Set(db.members.map(m=>m.division))].map(x=>`<option>${esc(x)}</option>`).join("")}</select></div><div id="filteredTable">${table(["ID Anggota","Nama","Divisi","KPI","Aksi"],rows,"Belum ada anggota")}</div></section>`}
function memberDetailPage(){const m=db.members.find(x=>x.id===selectedMemberId);if(!m)return membersPage();const score=demoKpi[m.id]??0;const history=demoKpiHistory[m.id]||[];const rows=history.map(h=>`<tr><td>${esc(h.date)}</td><td><strong>${esc(h.label)}</strong><br><small>${esc(h.detail)}</small></td><td><span class="badge ${h.points>=0?"badge-green":"badge-red"}">${h.points>0?"+":""}${h.points}</span></td></tr>`).join("");return `${head("MONITORING ANGGOTA","Detail Anggota",`Profil dan riwayat KPI ${esc(m.name)}.`,`<button class="btn btn-light" data-page="members">← Kembali ke daftar</button>`)}<div class="stats-grid">${stat("Nama Anggota",esc(m.name),"♙","blue",m.id)}${stat("Divisi",esc(m.division),"▣","purple","Divisi anggota")}${stat("KPI Saat Ini",`${score}/25`,"✦",score>=25?"green":"orange",score>=25?"Memenuhi ambang contoh":"Di bawah ambang contoh")}${stat("Riwayat Poin",history.length,"◷","orange","Catatan riwayat")}</div><section class="panel"><div class="panel-head"><div><h2>Riwayat KPI</h2><p>Catatan aktivitas dan perubahan poin.</p></div></div>${table(["Tanggal","Aktivitas / Catatan","Poin"],rows,"Belum ada riwayat")}</section>`}
function evidenceCell(url){if(!url)return "—";const safe=String(url).trim();return /^https?:\/\//i.test(safe)?`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">Lihat bukti ↗</a>`:esc(safe)}
function taskRow(t){return `<tr><td><strong>${esc(t.id)}</strong></td><td>${esc(t.name)}</td><td>${esc(t.division)}</td><td>${badge(t.status)}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="progress-track"><div class="progress-fill" style="width:${t.progress}%"></div></div>${t.progress}%</div></td><td>${esc(t.due||"—")}</td><td>${evidenceCell(t.evidence)}</td><td>${esc(t.note||"—")}</td></tr>`}
function tasksPage(){const rows=db.tasks.map(taskRow).join("");
 return `${head("DATA & MONITORING","Monitoring Tugas","Pantau tugas, progres, bukti, dan catatan situasi khusus.")}<section class="panel"><div class="toolbar"><input data-filter placeholder="Cari tugas atau divisi..." /><select data-filter-select><option value="">Semua status</option><option>Belum Mulai</option><option>Proses</option><option>Selesai</option></select></div>${taskStatusPanel()}<div id="filteredTable">${table(["ID","Nama Tugas","Divisi","Status","Progres","Tenggat","Bukti","Catatan"],rows,"Belum ada tugas")}</div></section>`}
function activitiesPage(){const sorted=[...db.activities].sort((a,b)=>(a.date||"").localeCompare(b.date||""));const rows=sorted.map(a=>`<tr><td><strong>${esc(a.date||"—")}</strong></td><td><strong>${esc(a.name)}</strong><br><small>${esc(a.id)}</small></td><td><button class="mini-btn" data-event-detail="${esc(a.id)}">Detail</button></td></tr>`).join("");
 return `${head("AGENDA ORGANISASI","Kalender Acara","Agenda kegiatan berdasarkan tanggal.")}<div class="notice">Pilih Detail untuk melihat keterangan, lokasi, dan informasi acara lainnya.</div><section class="panel">${table(["Tanggal","Acara","Detail"],rows,"Belum ada acara")}</section>`}
function reviewsPage(){const rows=db.reviews.map(r=>`<tr><td><strong>${r.id}</strong></td><td>${esc(r.date)}</td><td>${esc(memberName(r.member))}</td><td>${esc(activityName(r.activity))}</td><td>${badge(r.attendance)}</td><td>${esc(r.contribution)}</td><td>${esc(r.observer)}</td><td><div class="row-actions"><button class="mini-btn" data-edit="reviews" data-id="${r.id}">Edit</button><button class="mini-btn" data-delete="reviews" data-id="${r.id}">Hapus</button></div></td></tr>`).join("");
 return `${head("MONITORING","Evaluasi & Catatan","Catatan pengawasan dari tim monitoring.",'<button class="btn btn-primary" data-add="reviews">＋ Tambah catatan</button>')}<div class="notice"></div><section class="panel">${table(["ID Catatan","Tanggal","Anggota","Kegiatan","Kehadiran","Kontribusi","Pengawas","Aksi"],rows,"Belum ada catatan")}</section>`}
function settingsPage(){return `${head("PREFERENSI","Pengaturan & Data","Kelola data demo dan ekspor cadangan.")}<div class="settings-grid"><section class="setting-box"><h2>Data dashboard</h2><p>Data disimpan di penyimpanan lokal browser (localStorage) pada perangkat ini. </p><div class="head-actions"><button class="btn btn-primary" data-action="export">⇩ Ekspor JSON</button><button class="btn btn-light" data-action="import">⇧ Impor JSON</button><input id="importFile" type="file" accept="application/json" hidden></div></section><section class="setting-box"><h2>Reset data</h2><p>Kembalikan anggota, kegiatan, tugas, dan catatan ke data awal. Perubahan lokal saat ini akan diganti.</p><button class="btn btn-danger" data-action="reset">↻ Reset data</button></section><section class="setting-box"><h2>Status implementasi</h2><p><b>Antarmuka:</b> berjalan di browser.<br><b>Data:</b> lokal.<br><b>Penyimpanan:</b> localStorage.<br><b>Login dan akses peran:</b> belum tersedia.<br><b>Integrasi Spreadsheet:</b> belum tersedia.</p></section><section class="setting-box"><h2>Catatan keamanan</h2><p>Jangan memasukkan data pribadi atau catatan evaluasi sensitif ke dashboard ini. localStorage bukan database terpusat dan tidak menyediakan kontrol akses antar pengguna.</p></section></div>`}
const pageRender={overview,members:membersPage,"member-detail":memberDetailPage,tasks:tasksPage,activities:activitiesPage};
const pageTitles={overview:"Dashboard",members:"Monitoring Anggota",tasks:"Monitoring Tugas",activities:"Kalender Acara"};
function render(){const fn=pageRender[currentPage]||overview;$("#content").innerHTML=fn();$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===currentPage));wireFilter();window.scrollTo({top:0,behavior:"smooth"})}
function go(page){currentPage=page;render();$("#sidebar").classList.remove("open")}
const schemas={
 members:[["name","Nama anggota","text",true],["division","Divisi","text",true],["email","Email","email",false]],
 activities:[["name","Nama kegiatan","text",true],["date","Tanggal","date",true],["location","Lokasi","text",false],["division","Divisi (opsional, jika proker divisi)","text",false],["note","Keterangan acara","textarea",false]],
 tasks:[["name","Nama tugas","text",true],["division","Divisi","text",true],["owner","Penanggung jawab","member",true],["status","Status","status",true],["progress","Progres (%)","number",true],["due","Tenggat","date",false],["evidence","Link bukti (URL)","url",false],["note","Catatan / situasi khusus","textarea",false]],
 reviews:[["date","Tanggal","date",true],["member","Anggota","member",true],["activity","Kegiatan","activity",true],["attendance","Kehadiran","attendance",true],["contribution","Kontribusi/peran","text",false],["observer","Nama pengawas","text",true],["note","Catatan","textarea",false]]
};
function fieldHtml([key,label,type,required],value=""){let input="";if(type==="member")input=`<select name="${key}" ${required?"required":""}><option value="">Pilih anggota</option>${db.members.map(m=>`<option value="${m.id}" ${value===m.id?"selected":""}>${m.id} — ${esc(m.name)}</option>`).join("")}</select>`;
 else if(type==="activity")input=`<select name="${key}" ${required?"required":""}><option value="">Pilih kegiatan</option>${db.activities.map(a=>`<option value="${a.id}" ${value===a.id?"selected":""}>${a.id} — ${esc(a.name)}</option>`).join("")}</select>`;
 else if(type==="status"||type==="attendance"){const opts=type==="status"?["Belum Mulai","Proses","Selesai"]:["Hadir","Izin","Tidak Hadir"];input=`<select name="${key}" required>${opts.map(o=>`<option ${value===o?"selected":""}>${o}</option>`).join("")}</select>`}
 else if(type==="textarea")input=`<textarea name="${key}">${esc(value)}</textarea>`;
 else input=`<input name="${key}" type="${type}" value="${esc(value)}" ${required?"required":""} ${type==="number"?'min="0" max="100"':''}>`;
 return `<div class="field ${type==="textarea"?"full":""}"><label>${label}${required?" *":""}</label>${input}</div>`}
function openForm(kind,id=null){if(!schemas[kind])return;const existing=id?db[kind].find(x=>x.id===id):null;editContext={kind,id};$("#modalEyebrow").textContent=id?"EDIT DATA":"TAMBAH DATA";$("#modalTitle").textContent=(id?"Edit ":"Tambah ")+({members:"Anggota",activities:"Kegiatan",tasks:"Tugas",reviews:"Catatan Monitoring"}[kind]);$("#modalFields").innerHTML=schemas[kind].map(f=>fieldHtml(f,existing?.[f[0]]??(f[0]==="status"?"Belum Mulai":f[0]==="attendance"?"Hadir":""))).join("");$("#modal").showModal()}
function closeModal(){$("#modal").close();editContext=null}
function wireFilter(){const input=$("[data-filter]"),sel=$("[data-filter-select]");if(!input)return;const update=()=>{const q=input.value.toLowerCase();const f=sel?.value||"";let rows="",headers=[];if(currentPage==="members"){headers=["ID Anggota","Nama","Divisi","KPI","Aksi"];rows=db.members.filter(m=>(`${m.id} ${m.name} ${m.division} ${m.email}`.toLowerCase().includes(q))&&(!f||m.division===f)).map(memberRow).join("")}
 else if(currentPage==="tasks"){headers=["ID","Nama Tugas","Divisi","Status","Progres","Tenggat","Bukti","Catatan"];rows=db.tasks.filter(t=>(`${t.id} ${t.name} ${t.division}`.toLowerCase().includes(q))&&(!f||t.status===f)).map(taskRow).join("")}
 if($("#filteredTable"))$("#filteredTable").innerHTML=table(headers,rows,"Tidak ada data yang cocok")}
 input.addEventListener("input",update);sel?.addEventListener("change",update)}
document.addEventListener("click",e=>{const evd=e.target.closest("[data-event-detail]");if(evd){const a=db.activities.find(x=>x.id===evd.dataset.eventDetail);if(a){$("#detailTitle").textContent=a.name;$("#detailBody").innerHTML=`<p><strong>Tanggal:</strong> ${esc(a.date||"—")}</p><p><strong>Lokasi:</strong> ${esc(a.location||"Belum ditentukan")}</p>${a.division?`<p><strong>Divisi:</strong> ${esc(a.division)}</p>`:""}<p><strong>Keterangan:</strong><br>${esc(a.note||"Belum ada keterangan")}</p>`;$("#detailModal").showModal()}return}const detail=e.target.closest("[data-member-detail]");if(detail){selectedMemberId=detail.dataset.memberDetail;go("member-detail");return}const nav=e.target.closest("[data-page]");if(nav){go(nav.dataset.page);return}});
$("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
function exportData(){const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="the-gb-dash-data.json";a.click();URL.revokeObjectURL(a.href);toast("File JSON diekspor")}
render();
