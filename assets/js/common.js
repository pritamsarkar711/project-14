(function(){
  function $(s,r){return (r||document).querySelector(s)}
  function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  const themeButton=$('#theme-toggle');
  const themeColor=document.querySelector('meta[name="theme-color"]');
  function setTheme(isDark, persist){
    document.documentElement.classList.toggle('dark',!!isDark);
    if(themeButton){
      themeButton.setAttribute('aria-pressed',isDark?'true':'false');
      themeButton.setAttribute('aria-label',isDark?'Switch to light theme':'Switch to dark theme');
      const glyph=themeButton.querySelector('.material-icons');
      if(glyph)glyph.textContent=isDark?'light_mode':'dark_mode';
    }
    if(themeColor)themeColor.setAttribute('content',isDark?'#122136':'#1976d2');
    if(persist){try{localStorage.setItem('theme-mode',isDark?'dark':'light')}catch(e){}}
  }
  setTheme(document.documentElement.classList.contains('dark'),false);
  themeButton?.addEventListener('click',()=>setTheme(!document.documentElement.classList.contains('dark'),true));
  const trigger=$('#categories-trigger'), menu=$('#categories-menu');
  trigger?.addEventListener('click',()=>{const open=menu.hidden; menu.hidden=!open; trigger.setAttribute('aria-expanded',open?'true':'false'); const r=trigger.getBoundingClientRect(); menu.style.top=(r.bottom+8)+'px'; menu.style.left=r.left+'px'});
  document.addEventListener('click',e=>{if(menu && !menu.hidden && !menu.contains(e.target) && !trigger.contains(e.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false')}});
  const drawer=$('#drawer'), overlay=$('#drawer-overlay'), toggle=$('#drawer-toggle');
  function closeDrawer(){if(drawer){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true')} if(overlay) overlay.hidden=true}
  toggle?.addEventListener('click',()=>{drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');overlay.hidden=false}); overlay?.addEventListener('click',closeDrawer);
  const scroll=$('#scroll-top'); window.addEventListener('scroll',()=>{if(scroll) scroll.hidden=window.scrollY<300}); scroll?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  const s=$('#toolSearch')||$('#tool-search'); if(s) s.addEventListener('input',()=>{const q=s.value.toLowerCase();$$('.tool,[data-name]', $('#tool-grid')||document).forEach(c=>{const n=(c.dataset.name||c.textContent).toLowerCase();c.style.display=n.includes(q)?'':'none'})});
  // Keep both responsive navigation menus predictable for keyboard and pointer users.
  const navigationMenus=$$('.tools-menu,.mobile-menu');
  if(navigationMenus.length){
    document.addEventListener('click',e=>navigationMenus.forEach(menu=>{if(menu.open&&!menu.contains(e.target))menu.open=false;}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')navigationMenus.forEach(menu=>{menu.open=false;});});
  }
  window.sumly={engines:{}, esc:v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])), copy:t=>navigator.clipboard?.writeText(t)};
  window.addEventListener('DOMContentLoaded',()=>{const tool=window.SUMLY_TOOL, el=$('#tool-app'); if(tool&&el){(sumly.engines[tool.type]||sumly.engines.basic)(el,tool)}});
})();
