(function(){
  function $(s,r){return (r||document).querySelector(s)}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  const saved=localStorage.getItem('theme-mode'); if(saved==='dark') document.documentElement.classList.add('dark');
  const themeBtn=$('#theme-toggle'), themeIcon=$('#theme-toggle .material-icons');
  function syncThemeIcon(){ const isDark=document.documentElement.classList.contains('dark'); if(themeIcon){ themeIcon.textContent=isDark?'light_mode':'dark_mode'; } if(themeBtn){ themeBtn.setAttribute('aria-label', isDark?'Switch to light mode':'Switch to dark mode'); } }
  syncThemeIcon();
  themeBtn?.addEventListener('click',()=>{document.documentElement.classList.toggle('dark');localStorage.setItem('theme-mode',document.documentElement.classList.contains('dark')?'dark':'light');syncThemeIcon()});
  const trigger=$('#categories-trigger'), menu=$('#categories-menu');
  trigger?.addEventListener('click',()=>{const open=menu.hidden; menu.hidden=!open; trigger.setAttribute('aria-expanded',open?'true':'false'); const r=trigger.getBoundingClientRect(); menu.style.top=(r.bottom+8)+'px'; menu.style.left=r.left+'px'});
  document.addEventListener('click',e=>{if(menu && !menu.hidden && !menu.contains(e.target) && !trigger.contains(e.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false')}});
  const drawer=$('#drawer'), overlay=$('#drawer-overlay'), toggle=$('#drawer-toggle');
  function closeDrawer(){if(drawer){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true')} if(overlay) overlay.hidden=true}
  toggle?.addEventListener('click',()=>{drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');overlay.hidden=false}); overlay?.addEventListener('click',closeDrawer);
  const scroll=$('#scroll-top'); window.addEventListener('scroll',()=>{if(scroll) scroll.hidden=window.scrollY<300}); scroll?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  const s=$('#toolSearch')||$('#tool-search'); if(s) s.addEventListener('input',()=>{const q=s.value.toLowerCase();$$('.tool,[data-name]', $('#tool-grid')||document).forEach(c=>{const n=(c.dataset.name||c.textContent).toLowerCase();c.style.display=n.includes(q)?'':'none'})});
  // Other Tools dropdown: close on outside click and Escape
  const toolsMenu=document.querySelector('.tools-menu');
  if(toolsMenu){
    document.addEventListener('click',e=>{if(toolsMenu.open&&!toolsMenu.contains(e.target))toolsMenu.open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toolsMenu.open)toolsMenu.open=false;});
  }
  window.sumly={engines:{}, esc:v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])), copy:t=>navigator.clipboard?.writeText(t)};
  window.addEventListener('DOMContentLoaded',()=>{const tool=window.SUMLY_TOOL, el=$('#tool-app'); if(tool&&el){(sumly.engines[tool.type]||sumly.engines.basic)(el,tool)}});
})();
