/* COREBIQ dashboard bootstrap: loads shared components and wires interactions. */
const componentMap = {
  "desktop-sidebar-mount": "components/sidebar.html",
  "desktop-header-mount": "components/header.html",
  "mobile-header-mount": "components/app/header.html",
  "app-sidebar-mount": "components/app/sidebar.html",
  "bottom-nav-mount": "components/app/bottom-nav.html",
  "welcome-mount": "components/kpi-welcomecard.html",
  "kpi-mini-mount": "components/kpi-mini.html",
  "chart-mount": "components/chart.html",
  "form-view-mount": "components/form-view.html"
};

async function loadComponent(mountId, url) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    mount.innerHTML = await response.text();
  } catch (error) {
    console.error("Component could not load:", error);
    mount.innerHTML = `<div class="component-error">Unable to load ${url}</div>`;
  }
}

async function initDashboard() {
  await Promise.all(Object.entries(componentMap).map(([id,url]) => loadComponent(id,url)));
  if (window.lucide) window.lucide.createIcons();
  initDrawer();
  initBottomNav();
  initChart();
  initDashboardControls();
  updateDate();
}

function initDrawer() {
  const drawer = document.getElementById("app-drawer");
  const backdrop = document.getElementById("app-drawer-backdrop");
  if (!drawer || !backdrop) return;
  const open = () => { drawer.classList.add("open"); backdrop.classList.add("show"); drawer.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden"; };
  const close = () => { drawer.classList.remove("open"); backdrop.classList.remove("show"); drawer.setAttribute("aria-hidden","true"); document.body.style.overflow=""; };
  document.querySelectorAll("[data-open-app-sidebar],[data-bottom-menu]").forEach(el => el.addEventListener("click",open));
  document.getElementById("close-app-sidebar")?.addEventListener("click",close);
  backdrop.addEventListener("click",close);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
  let sx=0,sy=0,edge=false;
  document.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;edge=sx<24&&!drawer.classList.contains("open");},{passive:true});
  document.addEventListener("touchend",e=>{if(!edge||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-sx;const dy=Math.abs(e.changedTouches[0].clientY-sy);if(dx>65&&dy<90)open();edge=false;},{passive:true});
  let dx0=0,dy0=0;
  drawer.addEventListener("touchstart",e=>{dx0=e.touches[0].clientX;dy0=e.touches[0].clientY;},{passive:true});
  drawer.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-dx0;const dy=Math.abs(e.changedTouches[0].clientY-dy0);if(dx< -65&&dy<90)close();},{passive:true});
}
function initBottomNav() {
  const page=(location.pathname.split("/").pop()||"index.html").replace(/\.html?$/i,"").toLowerCase();
  const aliases={home:["index","home","dashboard"],crm:["crm","clients","leads"],erp:["erp","transactions","invoices"],hr:["hr","staff","payroll"]};
  document.querySelectorAll("[data-bottom-key]").forEach(a=>{const key=a.dataset.bottomKey;if((aliases[key]||[key]).includes(page)){a.setAttribute("aria-current","page");}});
}
function initChart() {
  const canvas=document.getElementById("revenue-chart");
  if(!canvas||!window.Chart)return;
  const ctx=canvas.getContext("2d");
  const gradient=ctx.createLinearGradient(0,0,0,240);
  gradient.addColorStop(0,"rgba(16,163,127,.13)");gradient.addColorStop(1,"rgba(16,163,127,0)");
  const datasets={
    week:{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],data:[18,24,21,32,29,38,43]},
    month:{labels:["1","4","7","10","13","16","19","22","25","28","30"],data:[12,19,16,25,22,31,28,37,34,43,48]},
    year:{labels:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],data:[18,22,20,28,25,31,29,35,32,39,44,48]}
  };
  const chart=new Chart(ctx,{type:"line",data:{labels:datasets.month.labels,datasets:[{data:datasets.month.data,borderColor:"#10a37f",backgroundColor:gradient,fill:true,tension:.38,borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:"#0d8c6d"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:"#20242b",padding:10,titleFont:{family:"Inter",size:10},bodyFont:{family:"Inter",size:11},callbacks:{label:c=>` ₹${c.raw}K`}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:"#969da7",font:{family:"Inter",size:10},maxRotation:0}},y:{beginAtZero:true,grid:{color:"#eeeeee",drawTicks:false},border:{display:false},ticks:{color:"#969da7",font:{family:"Inter",size:9},padding:9,callback:v=>`₹${v}K`}}}}});
  document.getElementById("chart-period")?.addEventListener("change",e=>{const d=datasets[e.target.value]||datasets.month;chart.data.labels=d.labels;chart.data.datasets[0].data=d.data;chart.update();});
}
function initDashboardControls() {
  document.getElementById("current-year").textContent=new Date().getFullYear();
  document.getElementById("add-work")?.addEventListener("click",()=>alert("Connect this action to your task creation form."));
  document.getElementById("filter-work")?.addEventListener("click",()=>{
    const rows=[...document.querySelectorAll("[data-task]")];
    const pending=rows.some(r=>r.style.display==="none");
    rows.forEach(r=>r.style.display=pending?"":"none");
    if(!pending) rows.forEach(r=>{if(r.textContent.toLowerCase().includes("pending")||r.textContent.toLowerCase().includes("progress"))r.style.display="";});
  });
  document.querySelectorAll(".icon-action").forEach(btn=>btn.addEventListener("click",()=>alert("Connect this action to your task edit/action menu.")));
  document.getElementById("desktop-search-button")?.addEventListener("click",()=>alert("Connect global search here."));
}
function updateDate(){
  const el=document.getElementById("welcome-date");if(!el)return;
  el.textContent=new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
}
document.addEventListener("DOMContentLoaded",initDashboard);
