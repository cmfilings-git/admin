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
  "form-view-mount": "components/form-view.html",
  "mini-container-mount": "components/mini-container.html",
  "app-splash-screen-mount": "components/splash-screen.html",
  "app-loading-screen-mount": "components/loading-screen.html"
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
  initAppearanceTheme();
  const splashMount=document.createElement("div");
  splashMount.id="app-splash-screen-mount";
  const loadingMount=document.createElement("div");
  loadingMount.id="app-loading-screen-mount";
  const miniMount=document.getElementById("mini-container-mount")||document.createElement("div");
  miniMount.id="mini-container-mount";
  document.body.append(splashMount,loadingMount);
  if(!miniMount.isConnected)document.body.append(miniMount);
  await loadComponent("app-splash-screen-mount",componentMap["app-splash-screen-mount"]);
  const splash=document.getElementById("app-splash-screen");
  const splashStartedAt=performance.now();
  if(splash)splash.classList.add("is-visible");
  await Promise.all(Object.entries(componentMap)
    .filter(([id])=>id!=="app-splash-screen-mount"&&id!=="app-loading-screen-mount")
    .map(([id,url])=>loadComponent(id,url)));
  await loadComponent("app-loading-screen-mount",componentMap["app-loading-screen-mount"]);
  initCrmSubnav();
  if (window.lucide) window.lucide.createIcons();
  initAppearanceTheme();
  try{
    const {initHeaderPopovers}=await import(new URL("js/header-popovers.js",document.baseURI));
    initHeaderPopovers();
  }catch(error){
    console.error("Header notifications and profile could not initialize:",error);
  }
  initLoadingScreen();
  initDrawer();
  initNavigation();
  initChart();
  initDashboardControls();
  initModuleContainer();
  updateDate();
  if(splash){
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,650-(performance.now()-splashStartedAt))));
    splash.classList.remove("is-visible");
    splash.setAttribute("aria-hidden","true");
  }
}
function initCrmSubnav() {
  const nav=document.querySelector(".crm-tabs,.client-tabs");
  if(!nav)return;
  const container=document.querySelector(".crm-page,.client-page");
  const navContainer=nav.closest(".crm-tabs-wrap,.client-tabs-wrap");
  const pageHeader=container?.querySelector(".crm-head");
  if(pageHeader&&navContainer&&pageHeader.nextElementSibling!==navContainer)pageHeader.after(navContainer);
  container?.classList.add("crm-module-container");
  navContainer?.classList.add("crm-submodule-nav");
  const page=location.pathname.split("/").pop().toLowerCase();
  const section=location.hash.slice(1).toLowerCase();
  const activeKey=["clients.html","credentials.html","compliance.html"].includes(page)
    ? page.replace(".html","")
    : ["contacts","tasks"].includes(section)?section:"dashboard";
  const items=[
    ["dashboard","Dashboard","layout-dashboard","modules/crm/crm.html"],
    ["clients","Clients","contact-round","modules/crm/clients.html"],
    ["credentials","Credentials","shield-check","modules/crm/credentials.html"],
    ["compliance","Compliance","clipboard-check","modules/crm/compliance.html"],
    ["contacts","Contacts","contact","modules/crm/crm.html#contacts"],
    ["tasks","Tasks","list-checks","modules/crm/crm.html#tasks"]
  ];
  nav.setAttribute("aria-label","CRM sections");
  nav.removeAttribute("role");
  nav.replaceChildren(...items.map(([key,label,icon,href])=>{
    const link=document.createElement("a");
    link.className=`crm-tab${key===activeKey?" active":""}`;
    link.href=href;
    if(key===activeKey)link.setAttribute("aria-current","page");
    const glyph=document.createElement("i");
    glyph.setAttribute("data-lucide",icon);
    link.append(glyph,document.createTextNode(label));
    return link;
  }));
}
function initAppearanceTheme() {
  const storageKey="corebiq-theme";
  const root=document.documentElement;
  const storedTheme=localStorage.getItem(storageKey);
  const applyTheme=theme=>{
    const isDark=theme==="dark";
    root.dataset.theme=isDark?"dark":"light";
    document.body.dataset.theme=isDark?"dark":"light";
    document.querySelectorAll("[data-theme-toggle]").forEach(toggle=>{
      toggle.setAttribute("aria-checked",String(isDark));
      toggle.setAttribute("aria-label",`Switch to ${isDark?"light":"dark"} theme`);
    });
  };
  applyTheme(storedTheme==="dark"?"dark":"light");
  document.querySelectorAll("[data-theme-toggle]").forEach(toggle=>{
    if(toggle.dataset.themeBound==="true")return;
    toggle.dataset.themeBound="true";
    toggle.addEventListener("click",()=>{
      const theme=root.dataset.theme==="dark"?"light":"dark";
      localStorage.setItem(storageKey,theme);
      applyTheme(theme);
    });
  });
}
function initLoadingScreen() {
  const overlay=document.getElementById("app-loading-screen");
  if(!overlay)return;
  window.COREBIQ=window.COREBIQ||{};
  window.COREBIQ.showLoading=()=>{
    overlay.hidden=false;
    overlay.setAttribute("aria-hidden","false");
  };
  window.COREBIQ.hideLoading=()=>{
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
  };
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
function initNavigation() {
  const segments=location.pathname.split("/").filter(Boolean).map(part=>part.toLowerCase());
  const moduleNames=["crm","erp","inventory","hr","clients","transactions","reports","settings"];
  let activeKey="home";
  if(segments.length>1&&segments[segments.length-2]==="modules"&&moduleNames.includes(segments[segments.length-1].replace(/\.html?$/i,""))){
    activeKey=segments[segments.length-1].replace(/\.html?$/i,"");
  }else if(segments.includes("modules")){
    const moduleIndex=segments.lastIndexOf("modules");
    const moduleName=segments[moduleIndex+1];
    if(moduleNames.includes(moduleName))activeKey=moduleName;
  }else{
    const page=(segments[segments.length-1]||"index.html").replace(/\.html?$/i,"");
    const aliases={index:"home",home:"home",dashboard:"home"};
    activeKey=aliases[page]||activeKey;
  }
  document.querySelectorAll("[data-nav-key]").forEach(link=>{
    const active=link.dataset.navKey===activeKey;
    link.classList.toggle("active",active);
    if(active)link.setAttribute("aria-current","page");
    else link.removeAttribute("aria-current");
  });
}
function initModuleContainer() {
  const mount=document.getElementById("module-container-content");
  if(!mount)return;
  const config=window.COREBIQ_MODULE;
  if(!config){
    console.error("Module container configuration is missing.");
    mount.textContent="This module could not be loaded.";
    mount.setAttribute("role","alert");
    return;
  }
  document.title=`${config.title} | COREBIQ`;
  document.getElementById("module-title").textContent=config.title;
  document.getElementById("module-description").textContent=config.description;
  config.sections.forEach(section=>{
    const card=document.createElement(section.href?"a":"article");
    card.className="module-section-card";
    if(section.href)card.href=section.href;
    const icon=document.createElement("span");
    icon.className="module-section-icon";
    const iconElement=document.createElement("i");
    iconElement.setAttribute("data-lucide",section.icon);
    icon.appendChild(iconElement);
    const title=document.createElement("h2");
    title.textContent=section.title;
    const description=document.createElement("p");
    description.textContent=section.description;
    card.append(icon,title,description);
    mount.appendChild(card);
  });
  if(window.lucide)window.lucide.createIcons();
}
function initChart() {
  const canvas=document.getElementById("revenue-chart");
  if(!canvas||!window.Chart)return;
  const ctx=canvas.getContext("2d");
  const gradient=ctx.createLinearGradient(0,0,0,240);
  gradient.addColorStop(0,"rgba(26,115,232,.13)");gradient.addColorStop(1,"rgba(26,115,232,0)");
  const datasets={
    week:{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],data:[18,24,21,32,29,38,43]},
    month:{labels:["1","4","7","10","13","16","19","22","25","28","30"],data:[12,19,16,25,22,31,28,37,34,43,48]},
    year:{labels:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],data:[18,22,20,28,25,31,29,35,32,39,44,48]}
  };
  const chart=new Chart(ctx,{type:"line",data:{labels:datasets.month.labels,datasets:[{data:datasets.month.data,borderColor:"#1a73e8",backgroundColor:gradient,fill:true,tension:.38,borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:"#1765cc"}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:"#1f2937",padding:10,titleFont:{family:"Outfit",size:10},bodyFont:{family:"Outfit",size:11},callbacks:{label:c=>` ₹${c.raw}K`}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:"#687386",font:{family:"Outfit",size:10},maxRotation:0}},y:{beginAtZero:true,grid:{color:"#e1e7f0",drawTicks:false},border:{display:false},ticks:{color:"#687386",font:{family:"Outfit",size:9},padding:9,callback:v=>`₹${v}K`}}}}});
  document.getElementById("chart-period")?.addEventListener("change",e=>{const d=datasets[e.target.value]||datasets.month;chart.data.labels=d.labels;chart.data.datasets[0].data=d.data;chart.update();});
}
function initDashboardControls() {
  const year=document.getElementById("current-year");
  if(year)year.textContent=new Date().getFullYear();
  document.getElementById("add-work")?.addEventListener("click",()=>alert("Connect this action to your task creation form."));
  document.querySelectorAll(".icon-action").forEach(btn=>btn.addEventListener("click",()=>alert("Connect this action to your task edit/action menu.")));
}
function updateDate(){
  const el=document.getElementById("welcome-date");if(!el)return;
  el.textContent=new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
}
document.addEventListener("DOMContentLoaded",initDashboard);
