
// ═══════════════ JNUS AI · consumer logic ═══════════════
const API='';
let OPTIONS=null, answers={}, step=0, lastResult=null;

function icon(id){return `<svg class="ic"><use href="#${id}"/></svg>`;}

// ── Fallback de imágenes: si un asset falta, placeholder limpio (sin ícono roto) ──
function imgFail(el,kind){
  if(el.dataset.failed) return;        // evita bucles
  el.dataset.failed='1';
  el.style.display='none';
  const ph=document.createElement('div');
  ph.className='img-ph '+(kind||'');
  ph.innerHTML='<svg class="ic"><use href="#i-landmark"/></svg>';
  if(el.parentNode) el.parentNode.insertBefore(ph,el);
}

// ── Estructura de negocio: 3 categorías + subcategorías (UI) → mapeo al modelo ──
// El backend/engine NO cambia: traducimos a los valores que el modelo ya conoce.
const CATEGORIES=[
  {id:'consumo', name:'Crédito de Consumo', desc:'Gastos del hogar, salud, educación y más', img:'/static/consumo.png',
   sub:[
     {id:'hogar', label:'Gastos del hogar', icon:'i-home', model:'Personal'},
     {id:'educacion', label:'Educación', icon:'i-graduation', model:'Personal'},
     {id:'salud', label:'Salud', icon:'i-heart', model:'Personal'},
     {id:'vehiculo', label:'Compra de vehículo', icon:'i-car', model:'Vehicular'},
     {id:'personal', label:'Consumo personal', icon:'i-wallet', model:'Personal'},
     {id:'refin', label:'Refinanciar deudas', icon:'i-refresh-debt', model:'Personal'},
     {id:'otros', label:'Otros gastos familiares', icon:'i-users', model:'Personal'},
   ]},
  {id:'micro', name:'Microcrédito', desc:'Para tu negocio o emprendimiento', img:'/static/microcredito.png',
   sub:[
     {id:'simple', label:'Microcrédito Simple', icon:'i-store', model:'Microcrédito'},
     {id:'ampliado', label:'Microcrédito Ampliado', icon:'i-trending', model:'Productivo'},
   ]},
  {id:'inmob', name:'Crédito Inmobiliario', desc:'Compra, construcción o remodelación', img:'/static/inmobiliario.png',
   sub:[
     {id:'compra', label:'Compra de vivienda', icon:'i-home', model:'Hipotecario'},
     {id:'construccion', label:'Construcción', icon:'i-hammer', model:'Hipotecario'},
     {id:'remodel', label:'Remodelación', icon:'i-key', model:'Hipotecario'},
     {id:'ampliacion', label:'Ampliación de vivienda', icon:'i-expand', model:'Hipotecario'},
   ]},
];

// Situación laboral (mismos valores que el modelo)
const EMPLOYMENT=[
  {v:'Empleado Público', icon:'i-landmark'},
  {v:'Empleado Privado', icon:'i-building'},
  {v:'Emprendedor', icon:'i-trending'},
  {v:'Negocio Propio', icon:'i-store'},
  {v:'Trabajo Informal', icon:'i-briefcase'},
  {v:'Desempleado', icon:'i-user'},
];

// Tipo de institución (UI) → mapeo a una institución que el modelo conoce
const INSTITUTIONS=[
  {id:'jep', label:'Cooperativa JEP', img:'/static/coops/jep.png', model:'Cooperativa JEP'},
  {id:'jardin', label:'Jardín Azuayo', img:'/static/coops/jardin.png', model:'Cooperativa JEP'},
  {id:'mego', label:'CoopMego', img:'/static/coops/mego.png', model:'Cooperativa JEP'},
  {id:'once', label:'Once de Junio', img:'/static/coops/once.png', model:'Cooperativa JEP'},
  {id:'santa', label:'Santa Rosa Ltda.', img:'/static/coops/santa.png', model:'Cooperativa JEP'}
];

// ── nav ──
function go(t){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.getElementById('t-'+t).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  document.querySelector('.screen').scrollTop=0;
  if(t==='home') renderDashboard();
  if(t==='history') renderHistory();
  if(t==='profile') renderProfile();
}
function toast(m,c=''){const t=document.getElementById('toast');t.textContent=m;t.className='show '+c;
  clearTimeout(window._t);window._t=setTimeout(()=>t.className='',3500);}

// ── load options (educación, historial, sexo desde backend) ──
async function loadOptions(){
  try{ OPTIONS=await (await fetch(API+'/api/options')).json(); }
  catch{ OPTIONS={education:["Primaria","Secundaria","Universitaria","Posgrado"],
    payment_history:["Malo","Regular","Bueno","Excelente"], sex:["Masculino","Femenino"]}; }
}

// ── WIZARD ──  pasos: categoría, subcategoría, situación, datos, institución+revisión
// STEPS es dinámico: si se entra con un tipo ya elegido (desde el Home), se omite 'categoria'.
let STEPS=['categoria','subcategoria','situacion','personal','institucion'];

function startWizard(catId){
  answers={catId:null, subId:null, tipo_credito:null, situacion_laboral:null,
    edad:35, sexo:'Masculino', educacion:'Universitaria', cargas_familiares:1,
    ingresos_mensuales:800, creditos_activos:1, monto_solicitado:5000,
    antiguedad_laboral:3, historial_pagos:'Bueno',
    tasa_interes:15, plazo_meses:24, _coop:null,
    instId:null, institucion:null};
  // Entrada directa: si el Home mandó un tipo válido, se salta la elección de categoría
  if(typeof catId==='string' && CATEGORIES.some(c=>c.id===catId)){
    answers.catId=catId;
    STEPS=['subcategoria','situacion','personal','institucion'];
  } else {
    STEPS=['categoria','subcategoria','situacion','personal','institucion'];
  }
  step=0;
  document.getElementById('wizard').classList.add('open');
  renderStep();
}
// Relleno de sliders en vivo (delegado: cubre los range recreados en cada paso)
document.getElementById('wiz-body').addEventListener('input',e=>{
  if(e.target && e.target.type==='range') paintRange(e.target);
});
function closeWizard(){document.getElementById('wizard').classList.remove('open');}

// ── COOPERATIVAS (marketplace) ──
//   logo = imagen real (guárdala en static/coops/<id>.png). Si falta, se muestra el monograma de respaldo.
//   EDITA tasa/plazo con datos reales.
const COOPS=[
  {id:'jep',    name:'Cooperativa JEP',   logo:'/static/coops/jep.png',    mono:'JEP',  color:'#009A44', rate:'15.2%', term:'3–48 meses'},
  {id:'jardin', name:'Jardín Azuayo',     logo:'/static/coops/jardin.png', mono:'JA',   color:'#5AA82E', rate:'14.8%', term:'6–60 meses'},
  {id:'mego',   name:'CoopMego',          logo:'/static/coops/mego.png',   mono:'Mego', color:'#0A4FA0', rate:'15.6%', term:'3–60 meses'},
  {id:'once',   name:'Once de Junio',     logo:'/static/coops/once.png',   mono:'11',   color:'#1E6B34', rate:'15.5%', term:'6–48 meses'},
  {id:'santa',  name:'Santa Rosa Ltda.',  logo:'/static/coops/santa.png',  mono:'SR',   color:'#1C4DA1', rate:'16.0%', term:'3–36 meses'}
];
// Devuelve el HTML del logo: imagen real si existe, con monograma de color como respaldo (onerror)
function coopLogoHTML(c, cls){
  return `<img class="${cls}-img" src="${c.logo}" alt="${c.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
       + `<span class="${cls}-fb" style="display:none;background:#fff;color:${c.color}">${c.mono}</span>`;
}
function openCoops(){ const el=document.getElementById('coops'); el.classList.add('open'); renderCoopList(); startLogoCarousel(); }
function closeCoops(){ const el=document.getElementById('coops'); el.classList.remove('open'); stopLogoCarousel(); }
function renderCoopList(){
  document.getElementById('coops-list').innerHTML=COOPS.map(c=>`
    <div class="coop-item">
      <div class="coop-logo">${coopLogoHTML(c,'coop-logo')}</div>
      <div class="coop-info"><div class="coop-nm">${c.name}</div>
        <div class="coop-meta"><span>Tasa <b>${c.rate}</b></span><span>Plazo ${c.term}</span></div></div>
      <button class="coop-go" onclick="pickCoop('${c.id}')" aria-label="Evaluar en ${c.name}">${icon('i-arrow-right')}</button>
    </div>`).join('');
}
function pickCoop(id){ const c=COOPS.find(x=>x.id===id); closeCoops(); startWizard();
  if(c){ answers._coop=c;
    answers.tasa_interes=parseFloat(String(c.rate).replace(/[^0-9.]/g,''))||15;
    const nums=String(c.term).match(/\d+/g)||[]; answers.plazo_meses=nums.length?+nums[nums.length-1]:24; // plazo máximo ofertado
    toast('Evaluando para '+c.name); } }
// Carrusel de logos: columnas que rotan con blur (adaptación vanilla del componente React)
let _lcTimer=null, _lcT=0;
function startLogoCarousel(){
  const host=document.getElementById('coop-logos'); if(!host) return;
  const COLS=3, items=COOPS.slice();
  const cols=Array.from({length:COLS},()=>[]);
  items.forEach((it,i)=>cols[i%COLS].push(it));
  const maxLen=Math.max(...cols.map(c=>c.length));
  cols.forEach(c=>{ while(c.length<maxLen) c.push(items[Math.floor(Math.random()*items.length)]); });
  host.innerHTML=cols.map(c=>`<div class="lc-col">${c.map((it,mi)=>`<div class="lc-logo ${mi===0?'on':''}"><div class="coop-mono">${coopLogoHTML(it,'coop-mono')}</div></div>`).join('')}</div>`).join('');
  _lcT=0; clearInterval(_lcTimer);
  _lcTimer=setInterval(()=>{
    _lcT+=100;
    host.querySelectorAll('.lc-col').forEach((col,ci)=>{
      const logos=[...col.children], n=logos.length; if(!n) return;
      const idx=Math.floor(((_lcT+ci*200)%(2000*n))/2000);
      logos.forEach((l,li)=>l.classList.toggle('on',li===idx));
    });
  },100);
}
function stopLogoCarousel(){ clearInterval(_lcTimer); _lcTimer=null; }

function wizBack(){ if(step===0){closeWizard();} else {step--;renderStep();} }

// Pinta el relleno de un slider según su valor (gradiente azul → línea)
function paintRange(el){
  const min=+el.min||0, max=+el.max||100, v=+el.value;
  const p=max>min ? ((v-min)/(max-min))*100 : 50;
  el.style.setProperty('--p', p+'%');
}

// Campos numéricos del wizard (stepper + slider sincronizados)
const WZF={edad:['edad',18,75,1,''], ingresos_mensuales:['ing',0,6000,50,'$'],
  cargas_familiares:['car',0,8,1,''], creditos_activos:['cre',0,8,1,''],
  monto_solicitado:['monto',300,50000,100,'$'], antiguedad_laboral:['antig',0,40,1,'']};
function wzSet(key,val){
  const [sid,mn,mx,st]=WZF[key], unit=WZF[key][4];
  val=Math.max(mn,Math.min(mx,Math.round(val/st)*st));
  answers[key]=val;
  const d=document.getElementById('v-'+sid);
  if(d){ d.textContent = unit==='$' ? '$'+val.toLocaleString() : val;
    d.classList.remove('bump'); void d.offsetWidth; d.classList.add('bump'); }
  const r=document.getElementById('r-'+sid);
  if(r){ if(+r.value!==val) r.value=val; paintRange(r); }
}
function wzBump(key,dir){ wzSet(key,(+answers[key])+dir*WZF[key][3]); }

// ── TECLADO NUMÉRICO (estilo Send Money) para las variables numéricas ──
const KP_FIELDS=[
  {k:'edad',               label:'Edad',               unit:'años',     icon:'i-cake',      max:75,     money:false},
  {k:'ingresos_mensuales', label:'Ingresos mensuales', unit:'al mes',   icon:'i-banknote',  max:100000, money:true},
  {k:'monto_solicitado',   label:'Monto que solicitas',unit:'',         icon:'i-coins',     max:200000, money:true},
  {k:'cargas_familiares',  label:'Cargas familiares',  unit:'personas', icon:'i-users',     max:20,     money:false},
  {k:'creditos_activos',   label:'Créditos activos',   unit:'créditos', icon:'i-wallet',    max:20,     money:false},
  {k:'antiguedad_laboral', label:'Antigüedad laboral', unit:'años',     icon:'i-briefcase', max:50,     money:false},
];
let _kpField='edad', _kpFresh=true;    // _kpFresh: el 1er dígito tras seleccionar reemplaza (no añade)
function _kpDef(k){ return KP_FIELDS.find(x=>x.k===k); }
function kpFmt(f,v){ v=Math.round(+v||0); return f.money ? '$'+v.toLocaleString() : String(v); }
function kpSelect(k){ _kpField=k; _kpFresh=true; kpRefresh(); }
function kpDigit(d){ const f=_kpDef(_kpField);
  let s = _kpFresh ? '' : String(Math.round(answers[_kpField]||0));
  _kpFresh=false;
  if(s==='0') s='';
  s=(s+d).slice(0,7);
  let n=Math.min(+s, f.max); answers[_kpField]=n; kpRefresh(true); }
function kpBack(){ _kpFresh=false; let s=String(Math.round(answers[_kpField]||0)); s=s.slice(0,-1)||'0'; answers[_kpField]=+s; kpRefresh(true); }
function kpClear(){ _kpFresh=false; answers[_kpField]=0; kpRefresh(true); }
function kpRefresh(bump){
  document.querySelectorAll('.kp-pill').forEach(p=>{ const k=p.dataset.k, f=_kpDef(k);
    p.classList.toggle('on', k===_kpField);
    const vv=p.querySelector('.kpp-v'); if(vv) vv.textContent=kpFmt(f,answers[k]); });
  const f=_kpDef(_kpField);
  const lab=document.getElementById('kpd-label'); if(lab) lab.innerHTML=icon(f.icon)+' '+f.label;
  const val=document.getElementById('kpd-value');
  if(val){ val.textContent=kpFmt(f,answers[_kpField]) + (f.money?'':(f.unit?' ':''));
    if(!f.money){ val.innerHTML=kpFmt(f,answers[_kpField])+' <small>'+f.unit+'</small>'; }
    if(bump){ val.classList.remove('bump'); void val.offsetWidth; val.classList.add('bump'); } }
}

// ── Hoja de acciones propia: confirm()/prompt() nativos NO aparecen en el PWA instalado ──
let _sheetDone=null;
function sheetOpen(title,sub,actions,cancelLabel){
  return new Promise(res=>{
    _sheetDone=res;
    document.getElementById('sheet-title').textContent=title;
    const s=document.getElementById('sheet-sub');
    s.style.display=sub?'block':'none'; s.textContent=sub||'';
    const box=document.getElementById('sheet-acts'); box.innerHTML='';
    actions.forEach((a,i)=>{
      const b=document.createElement('button'); b.type='button';
      b.className='sheet-btn'+(a.danger?' danger':(i>0?' line':''));
      b.textContent=a.label;
      b.onclick=()=>sheetClose(a.value!==undefined?a.value:a.label);
      box.appendChild(b);
    });
    document.getElementById('sheet-cancel').textContent=cancelLabel||'Cancelar';
    document.getElementById('sheet').classList.add('open');
  });
}
function sheetClose(v){ document.getElementById('sheet').classList.remove('open'); const d=_sheetDone; _sheetDone=null; if(d)d(v); }
function jnusConfirm(title,sub,okLabel,danger){
  return sheetOpen(title,sub,[{label:okLabel||'Confirmar',value:true,danger:!!danger}]).then(v=>v===true);
}

// ── SEGURIDAD: bloqueo con PIN (hash local) + huella/rostro (WebAuthn) ──
async function sha256(s){ const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function pinIsSet(){ return !!localStorage.getItem('janus_pin'); }
function bioIsSet(){ return !!localStorage.getItem('janus_bio'); }
let _pinBuf='', _pinMode='verify', _pinFirst='', _appGated=false, _pinAfter=null;
function updatePinDots(){ document.querySelectorAll('#pin-dots i').forEach((d,i)=>d.classList.toggle('on', i<_pinBuf.length)); }
function lockOpen(mode, after){
  _pinMode=mode||'verify'; _pinBuf=''; _pinFirst=''; _pinAfter=after||null;
  const t=document.getElementById('lock-title'), s=document.getElementById('lock-sub'), fg=document.getElementById('lock-forgot');
  if(_pinMode==='verify'){ t.textContent='Ingresa tu PIN'; s.textContent='Tu evaluación está protegida'; fg.style.display='inline-block'; }
  else if(_pinMode==='set1'){ t.textContent='Crea un PIN'; s.textContent='4 dígitos para proteger tu app'; fg.style.display='none'; }
  else if(_pinMode==='set2'){ t.textContent='Repite tu PIN'; s.textContent='Confírmalo para guardarlo'; fg.style.display='none'; }
  document.getElementById('lock-bio').style.display=(_pinMode==='verify' && bioIsSet())?'flex':'none';
  updatePinDots();
  document.getElementById('lock').classList.add('open');
}
function lockClose(){ document.getElementById('lock').classList.remove('open'); }
function lockBack(){ _pinBuf=_pinBuf.slice(0,-1); updatePinDots(); }
async function lockDigit(d){ if(_pinBuf.length>=4) return; _pinBuf+=d; updatePinDots();
  if(_pinBuf.length===4) setTimeout(pinComplete,120); }
// Teclado físico (PC): dígitos de la fila superior y del numpad + Backspace
document.addEventListener('keydown',e=>{
  const lock=document.getElementById('lock');
  if(!lock || !lock.classList.contains('open')) return;
  if(e.key>='0' && e.key<='9'){ e.preventDefault(); lockDigit(e.key); }
  else if(e.key==='Backspace'){ e.preventDefault(); lockBack(); }
});
async function pinComplete(){
  if(_pinMode==='verify'){
    if(await sha256(_pinBuf)===localStorage.getItem('janus_pin')) lockOK(); else pinErr();
  } else if(_pinMode==='set1'){ const first=_pinBuf; lockOpen('set2', _pinAfter); _pinFirst=first; }
  else if(_pinMode==='set2'){
    if(_pinBuf===_pinFirst){ localStorage.setItem('janus_pin', await sha256(_pinBuf)); lockClose(); toast('PIN activado 🔒','ok');
      renderProfile(); maybeOfferBio(); if(_pinAfter) _pinAfter(); }
    else { pinErr('Los PIN no coinciden'); setTimeout(()=>lockOpen('set1', _pinAfter),450); }
  }
}
function pinErr(msg){ const dots=document.getElementById('pin-dots'); dots.classList.add('err');
  if(navigator.vibrate) navigator.vibrate(120);
  setTimeout(()=>{ dots.classList.remove('err'); _pinBuf=''; updatePinDots(); if(msg) toast(msg,'err'); },440); }
function lockOK(){ lockClose(); if(!_appGated){ _appGated=true; maybeWelcome(); } }
async function lockForgot(){
  if(!await jnusConfirm('¿Restablecer tu PIN?','Se borrará el PIN y la biometría; deberás crear uno nuevo.','Restablecer',true)) return;
  localStorage.removeItem('janus_pin'); localStorage.removeItem('janus_bio'); lockClose();
  _appGated=true; maybeWelcome();
}
// Gate al abrir la app: si hay PIN, exige desbloqueo antes de entrar
function gateThenWelcome(){ if(pinIsSet()){ _appGated=false; lockOpen('verify'); } else { _appGated=true; maybeWelcome(); } }
// Biometría (WebAuthn, autenticador de plataforma = huella/rostro del equipo)
async function bioRegister(){
  if(!window.PublicKeyCredential){ toast('Este equipo no soporta biometría','err'); return false; }
  try{
    const u=getUser()||{};
    const cred=await navigator.credentials.create({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      rp:{name:'JNUS AI'},
      user:{id:crypto.getRandomValues(new Uint8Array(16)), name:(u.email||'jnus-user'), displayName:(u.name||'JNUS')},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{authenticatorAttachment:'platform', userVerification:'required'},
      timeout:60000, attestation:'none'
    }});
    const id=btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    localStorage.setItem('janus_bio', id); toast('Huella/rostro activado','ok'); renderProfile(); return true;
  }catch(e){ toast('No se pudo activar la biometría','err'); return false; }
}
async function bioUnlock(){
  const id=localStorage.getItem('janus_bio'); if(!id) return;
  try{
    const raw=Uint8Array.from(atob(id), c=>c.charCodeAt(0));
    await navigator.credentials.get({publicKey:{
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials:[{type:'public-key', id:raw, transports:['internal']}],
      userVerification:'required', timeout:60000
    }});
    lockOK();
  }catch(e){ toast('Biometría fallida, usa tu PIN','err'); }
}
function maybeOfferBio(){ if(window.PublicKeyCredential && !bioIsSet()){
  if(confirm('¿Activar huella o rostro para desbloquear más rápido?')) bioRegister(); } }
// Desde el perfil: configurar/quitar PIN y biometría
async function securitySetup(){
  if(!pinIsSet()){ lockOpen('set1'); return; }
  const c=await sheetOpen('Seguridad', bioIsSet()?'PIN y huella/rostro activos':'PIN activo', [
    {label:'Cambiar PIN', value:'pin'},
    {label:bioIsSet()?'Quitar huella/rostro':'Activar huella/rostro', value:'bio'},
    {label:'Quitar toda la seguridad', value:'off', danger:true}
  ]);
  if(c==='pin') lockOpen('set1');
  else if(c==='bio'){ if(bioIsSet()){ localStorage.removeItem('janus_bio'); toast('Biometría quitada'); renderProfile(); } else bioRegister(); }
  else if(c==='off'){ if(await jnusConfirm('¿Quitar PIN y biometría?',null,'Quitar seguridad',true)){ localStorage.removeItem('janus_pin'); localStorage.removeItem('janus_bio'); toast('Seguridad desactivada'); renderProfile(); } }
}

// ── ILUSTRACIONES MATISSE (Adobe-style, siluetas negras profesionales) ──
const DOODLE_HERO=`<svg class="doodle" viewBox="0 0 200 200" role="img" aria-label="Evaluación crediticia" style="max-width:200px">
  <rect x="120" y="34" width="40" height="40" rx="8"/>
  <rect class="fillk" x="131" y="45" width="18" height="18" rx="4"/><path class="wln" d="M136 54h8"/>
  <path d="M128 26v8M140 26v8M152 26v8M128 74v8M140 74v8M152 74v8M112 42h8M112 54h8M112 66h8M160 42h8M160 54h8M160 66h8"/>
  <path d="M96 30l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>
  <circle cx="58" cy="86" r="12"/><path class="fillk" d="M46 84c1-8 6-12 12-12s11 4 12 12c-2-6-6-8-12-8s-10 2-12 8z"/>
  <path class="fillk" d="M44 142v-24c0-12 6-20 14-20 7 0 13 5 17 13l7 13-6 4-9-12v26z"/>
  <path d="M62 116c8 8 18 12 28 13"/>
  <path class="fillk" d="M96 108l40-6v28l-40 6z"/><path class="wln" d="M104 116l24-3M104 124l16-2"/>
  <path d="M96 136l40-6 14 14-40 8z"/>
  <line x1="36" y1="152" x2="164" y2="152"/><path d="M44 152v20M152 152v20"/>
</svg>`;
const DOODLE_WIN=`<svg class="doodle" viewBox="0 0 200 200" role="img" aria-label="¡Resultado listo!" style="max-width:200px">
  <circle cx="52" cy="74" r="11"/><path class="fillk" d="M42 71c1-7 5-10 10-10s9 3 10 10c-2-5-5-7-10-7s-8 2-10 7z"/>
  <path class="fillk" d="M38 136v-30c0-10 6-17 14-17 6 0 10 3 13 8"/>
  <path d="M38 136v34M56 136v34"/><path class="fillk" d="M31 170h13v6H31zM50 170h13v6H50z"/>
  <circle cx="100" cy="64" r="12"/><path class="fillk" d="M89 61c1-7 5-11 11-11s10 4 11 11c-2-5-6-7-11-7s-9 2-11 7z"/>
  <path d="M84 130v-40c0-9 7-16 16-16s16 7 16 16v40"/>
  <path d="M87 82c-8 2-14 6-20 10M113 82c8 2 14 6 20 10"/>
  <path d="M90 130v40M110 130v40"/><path class="fillk" d="M83 170h13v6H83zM103 170h13v6h-13z"/>
  <circle class="fillk" cx="95" cy="98" r="2"/><circle class="fillk" cx="100" cy="106" r="2"/><circle class="fillk" cx="105" cy="98" r="2"/>
  <circle cx="148" cy="74" r="11"/><path class="fillk" d="M138 71c1-7 5-10 10-10s9 3 10 10c-2-5-5-7-10-7s-8 2-10 7z"/>
  <path class="fillk" d="M162 136v-30c0-10-6-17-14-17-6 0-10 3-13 8"/>
  <path d="M144 136v34M162 136v34"/><path class="fillk" d="M137 170h13v6h-13zM156 170h13v6h-13z"/>
  <line x1="28" y1="176" x2="172" y2="176"/>
</svg>`;
const DOODLE_NEGOCIO=`<svg class="doodle" viewBox="0 0 200 200" role="img" aria-label="Situación laboral" style="max-width:200px">
  <path d="M112 148V70M112 148h56"/>
  <rect x="120" y="126" width="12" height="22" rx="2"/><rect x="136" y="110" width="12" height="38" rx="2"/><rect class="fillk" x="152" y="90" width="12" height="58" rx="2"/>
  <path d="M118 100l14-14 12 8 18-22"/><path class="fillk" d="M156 66l10 2-4 9z"/>
  <circle cx="64" cy="62" r="13"/><path class="fillk" d="M52 59c1-8 6-12 12-12s11 4 12 12c-2-6-6-8-12-8s-10 2-12 8z"/>
  <path class="fillk" d="M46 134v-34c0-14 8-24 18-24s18 10 18 24v34z"/><path class="wln" d="M58 90v20"/>
  <path d="M80 84c10-2 18-4 26-4"/><path d="M48 84c-6 5-9 12-10 20"/>
  <path d="M52 134v32M76 134v32"/><path class="fillk" d="M44 166h14v6H44zM68 166h14v6H68z"/>
  <line x1="34" y1="172" x2="166" y2="172"/>
</svg>`;
function injectDoodles(){ const re=document.getElementById('re-doodle'); if(re && !re.innerHTML) re.innerHTML=DOODLE_HERO; }

function renderStep(){
  document.getElementById('wiz-bar').style.width=((step+1)/STEPS.length*100)+'%';
  document.getElementById('wiz-step').textContent=(step+1)+'/'+STEPS.length;
  const body=document.getElementById('wiz-body');
  const next=document.getElementById('wiz-next');
  next.innerHTML= step===STEPS.length-1?icon('i-spark')+' Analizar mi perfil':'Continuar';
  body.scrollTop=0;

  if(STEPS[step]==='categoria'){
    const TONE={consumo:'linear-gradient(150deg,#3A4C8F,var(--ill-navy))',
                micro:'linear-gradient(150deg,var(--ill-gold-lt),var(--ill-gold))',
                inmob:'linear-gradient(150deg,var(--ill-ochre-lt),var(--ill-ochre))'};
    const ICO={consumo:'i-wallet',micro:'i-store',inmob:'i-building'};
    body.innerHTML=`<div class="wiz-q">¿Qué crédito deseas solicitar?</div>
      <div class="wiz-hint">Desliza y toca para elegir tu tipo de crédito</div>
      <div class="watch-picker">
        <div class="wp-track" id="wp-track" data-mode="cat">${CATEGORIES.map(c=>
          `<div class="wcard" data-id="${c.id}" style="--wc-grad:${TONE[c.id]||'linear-gradient(150deg,#3A4C8F,var(--ill-navy))'}" onclick="wpTap('${c.id}')">
            <div class="wc-ic">${icon(ICO[c.id]||'i-wallet')}</div>
            <div class="wc-nm">${c.name}</div>
            <div class="wc-ds">${c.desc}</div>
            <span class="wc-pick">Elegir ${icon('i-arrow-right')}</span>
          </div>`).join('')}</div>
        <div class="wp-dots" id="wp-dots">${CATEGORIES.map((c,i)=>`<i class="${i===0?'on':''}"></i>`).join('')}</div>
      </div>`;
    setTimeout(wpInit,30);
  }
  else if(STEPS[step]==='subcategoria'){
    const cat=CATEGORIES.find(c=>c.id===answers.catId);
    const q=cat.id==='consumo'?'¿Para qué usarás el crédito?':cat.id==='micro'?'¿Qué tipo de microcrédito?':'¿Qué deseas hacer?';
    const TONES=['linear-gradient(150deg,#3A4C8F,var(--ill-navy))',
                 'linear-gradient(150deg,var(--ill-gold-lt),var(--ill-gold))',
                 'linear-gradient(150deg,var(--ill-ochre-lt),var(--ill-ochre))'];
    body.innerHTML=`<div class="wiz-q">${q}</div>
      <div class="wiz-hint">${cat.name} · desliza y toca</div>
      <div class="watch-picker">
        <div class="wp-track" id="wp-track" data-mode="sub">${cat.sub.map((s,i)=>
          `<div class="wcard" data-id="${s.id}" style="--wc-grad:${TONES[i%3]}" onclick="wpTap('${s.id}')">
            <div class="wc-ic">${icon(s.icon)}</div>
            <div class="wc-nm">${s.label}</div>
            <div class="wc-ds">${cat.name}</div>
            <span class="wc-pick">Elegir ${icon('i-arrow-right')}</span>
          </div>`).join('')}</div>
        <div class="wp-dots" id="wp-dots">${cat.sub.map((s,i)=>`<i class="${i===0?'on':''}"></i>`).join('')}</div>
      </div>`;
    setTimeout(wpInit,30);
  }
  else if(STEPS[step]==='situacion'){
    body.innerHTML=`<div style="margin-bottom:12px">${DOODLE_NEGOCIO}</div>
      <div class="wiz-q">¿Cuál es tu situación laboral?</div>
      <div class="wiz-hint">Esto ayuda a estimar tu estabilidad</div>
      <div class="opt-grid">${EMPLOYMENT.map(e=>
        `<div class="opt ${answers.situacion_laboral===e.v?'sel':''}" onclick="pickEmp('${e.v}')">
          <div class="ic-box">${icon(e.icon)}</div><div class="lbl">${e.v}</div></div>`).join('')}</div>`;
  }
  else if(STEPS[step]==='personal'){
    if(!KP_FIELDS.some(f=>f.k===_kpField)) _kpField='edad';
    body.innerHTML=`<div class="wiz-q">Tu información financiera</div>
      <div class="wiz-hint">Toca un dato y escríbelo con el teclado</div>
      <div class="kp-pills">${KP_FIELDS.map(f=>
        `<button type="button" class="kp-pill ${f.k===_kpField?'on':''}" data-k="${f.k}" onclick="kpSelect('${f.k}')">
           <span class="kpp-l">${f.label}</span><span class="kpp-v">${kpFmt(f,answers[f.k])}</span></button>`).join('')}</div>
      <div class="kp-display">
        <div class="kpd-label" id="kpd-label"></div>
        <div class="kpd-value" id="kpd-value">0</div>
      </div>
      <div class="kp-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" class="kp-key" onclick="kpDigit('${n}')">${n}</button>`).join('')}
        <button type="button" class="kp-key kp-fn" onclick="kpClear()">C</button>
        <button type="button" class="kp-key" onclick="kpDigit('0')">0</button>
        <button type="button" class="kp-key kp-fn" onclick="kpBack()">${icon('i-arrow-left')}</button>
      </div>
      <div class="field"><label><span class="lab-l">${icon('i-user')} Sexo</span></label>
        <div class="seg">${OPTIONS.sex.map(s=>`<button class="${answers.sexo===s?'on':''}" onclick="pick('sexo','${s}')">${s}</button>`).join('')}</div></div>
      <div class="field"><label><span class="lab-l">${icon('i-graduation')} Nivel educativo</span></label>
        <div class="chips-sel">${OPTIONS.education.map(s=>`<button class="${answers.educacion===s?'on':''}" onclick="pick('educacion','${s}')">${s}</button>`).join('')}</div></div>
      <div class="field"><label><span class="lab-l">${icon('i-calendar')} Historial de pagos</span></label>
        <div class="chips-sel">${OPTIONS.payment_history.map(s=>`<button class="${answers.historial_pagos===s?'on':''}" onclick="pick('historial_pagos','${s}')">${s}</button>`).join('')}</div></div>`;
    setTimeout(kpRefresh,10);
  }
  else if(STEPS[step]==='institucion'){
    body.innerHTML=`<div class="wiz-q">¿Qué cooperativa te interesa?</div>
      <div class="wiz-hint">Confirma y analiza tu perfil</div>
      <div class="opt-grid" style="margin-bottom:20px">${INSTITUTIONS.map(i=>
        `<div class="opt full ${answers.instId===i.id?'sel':''}" onclick="pickInst('${i.id}')">
          <div class="ic-box" style="background:#fff">${i.img ? `<img src="${i.img}" style="width:100%;height:100%;object-fit:contain;padding:4px;border-radius:10px" alt=""/>` : icon(i.icon)}</div><div class="lbl">${i.label}</div></div>`).join('')}</div>
      <div class="card" id="review-box"></div>`;
    renderReview();
  }
  // Pinta el relleno de los sliders del paso recién renderizado
  document.querySelectorAll('#wiz-body input[type=range]').forEach(paintRange);
}

function renderReview(){
  const box=document.getElementById('review-box'); if(!box) return;
  const cat=CATEGORIES.find(c=>c.id===answers.catId);
  const sub=cat?cat.sub.find(s=>s.id===answers.subId):null;
  const r=(k,v)=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)"><span style="color:var(--muted);font-size:13px">${k}</span><span style="font-weight:700;color:var(--navy);font-size:13px;text-align:right">${v||'—'}</span></div>`;
  box.innerHTML=`<div style="font-family:var(--fd);font-weight:800;font-size:15px;color:var(--navy);margin-bottom:8px">Resumen de tu solicitud</div>
    ${r('Crédito',cat?cat.name:'')}
    ${r('Destino',sub?sub.label:'')}
    ${r('Situación laboral',answers.situacion_laboral)}
    ${r('Edad',answers.edad+' años')}
    ${r('Ingresos','$'+answers.ingresos_mensuales.toLocaleString())}
    ${r('Monto solicitado','$'+answers.monto_solicitado.toLocaleString())}
    ${r('Antigüedad laboral',answers.antiguedad_laboral+' años')}
    ${r('Cargas familiares',answers.cargas_familiares)}
    ${r('Créditos activos',answers.creditos_activos)}
    ${r('Educación',answers.educacion)}
    ${r('Historial de pagos',answers.historial_pagos)}`;
}

// ── Carrusel Apple-Watch: detectar tarjeta centrada + elegir ──
function wpFocusUpdate(){
  const track=document.getElementById('wp-track'); if(!track) return;
  const cards=[...track.querySelectorAll('.wcard')]; if(!cards.length) return;
  const mid=track.scrollLeft + track.clientWidth/2;
  let best=0, bd=Infinity;
  cards.forEach((c,i)=>{ const cc=c.offsetLeft + c.offsetWidth/2, d=Math.abs(cc-mid); if(d<bd){bd=d;best=i;} });
  cards.forEach((c,i)=>c.classList.toggle('focus',i===best));
  document.querySelectorAll('#wp-dots i').forEach((d,i)=>d.classList.toggle('on',i===best));
  track._focus=best;
}
function wpInit(){
  const track=document.getElementById('wp-track'); if(!track) return;
  const cards=[...track.querySelectorAll('.wcard')];
  const sel = track.dataset.mode==='sub' ? answers.subId : answers.catId;
  let idx=cards.findIndex(c=>c.dataset.id===sel); if(idx<0) idx=0;
  const c=cards[idx]; if(c) track.scrollLeft=c.offsetLeft-(track.clientWidth-c.offsetWidth)/2;
  wpFocusUpdate();
  let raf; track.addEventListener('scroll',()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(wpFocusUpdate); });
}
function wpTap(id){
  const track=document.getElementById('wp-track');
  const pick = (track && track.dataset.mode==='sub') ? pickSub : pickCat;
  if(!track) return pick(id);
  const cards=[...track.querySelectorAll('.wcard')], i=cards.findIndex(c=>c.dataset.id===id);
  if(track._focus===i) pick(id);                           // ya centrada → elegir y avanzar
  else { const c=cards[i]; track.scrollTo({left:c.offsetLeft-(track.clientWidth-c.offsetWidth)/2,behavior:'smooth'}); }
}
function pickCat(id){answers.catId=id;answers.subId=null;renderStep();setTimeout(wizNext,200);}
function pickSub(id){const cat=CATEGORIES.find(c=>c.id===answers.catId);const s=cat.sub.find(x=>x.id===id);
  answers.subId=id;answers.tipo_credito=s.model;renderStep();setTimeout(wizNext,200);}
function pickEmp(v){answers.situacion_laboral=v;renderStep();setTimeout(wizNext,200);}
function pick(key,val){answers[key]=val;renderStep();}
function pickInst(id){const i=INSTITUTIONS.find(x=>x.id===id);answers.instId=id;answers.institucion=i.model;renderStep();}

function wizNext(){
  const s=STEPS[step];
  if(s==='categoria' && !answers.catId){toast('Selecciona una categoría','err');return;}
  if(s==='subcategoria' && !answers.subId){toast('Selecciona una opción','err');return;}
  if(s==='situacion' && !answers.situacion_laboral){toast('Selecciona tu situación laboral','err');return;}
  if(s==='institucion' && !answers.instId){toast('Selecciona un tipo de institución','err');return;}
  if(step<STEPS.length-1){ step++; renderStep(); }
  else { runAnalysis(); }
}

// ── AI ANALYSIS animation + real scoring ──
async function runAnalysis(){
  closeWizard();
  const robot = document.querySelector('.robot-scene');
  if(robot) robot.style.display = 'block';
  const logoCont = document.getElementById('an-logo-container');
  if(logoCont) logoCont.style.display = 'none';
  const a=document.getElementById('analysis'); a.classList.add('open');
  document.querySelectorAll('.ai-step').forEach(s=>s.classList.remove('on','done'));
  const anFill=document.getElementById('an-fill'), anPc=document.getElementById('an-pc');
  const setProg=p=>{ if(anFill)anFill.style.width=p+'%'; if(anPc)anPc.textContent=Math.round(p)+'%'; };
  setProg(0);

  // payload con SOLO los campos que el modelo conoce (mapeados) + quién evalúa
  const payload={
    edad:answers.edad, sexo:answers.sexo, educacion:answers.educacion,
    cargas_familiares:answers.cargas_familiares, ingresos_mensuales:answers.ingresos_mensuales,
    creditos_activos:answers.creditos_activos, monto_solicitado:answers.monto_solicitado,
    antiguedad_laboral:answers.antiguedad_laboral, historial_pagos:answers.historial_pagos,
    tasa_interes:answers.tasa_interes, plazo_meses:answers.plazo_meses,
    institucion:answers.institucion, tipo_credito:answers.tipo_credito,
    situacion_laboral:answers.situacion_laboral,
    _user:getUser()   // {id,name} para guardar la evaluación en la base de datos
  };
  const scoreP=fetch(API+'/api/score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(r=>r.json()).catch(e=>({error:e.message}));

  const steps=document.querySelectorAll('.ai-step');
  for(let i=0;i<steps.length;i++){
    steps[i].classList.add('on'); setProg((i+0.5)/steps.length*100); await sleep(620);
    steps[i].classList.remove('on'); steps[i].classList.add('done'); setProg((i+1)/steps.length*100);
  }
  setProg(100);
  await sleep(300);
  const data=await scoreP;
  a.classList.remove('open');
  if(data.error){toast(data.error,'err');return;}
  lastResult=data;
  saveHistory(data);
  renderResult(data);
  go('result');
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── RESULT ──
function renderResult(d){
  document.getElementById('result-empty').style.display='none';
  const rc=document.getElementById('result-content');
  rc.style.display='block';
  rc.classList.remove('reveal-in'); void rc.offsetWidth; rc.classList.add('reveal-in');
  const wd=document.getElementById('win-doodle');
  if(wd) wd.innerHTML = (d.percent>=55) ? '<img src="/static/win_doodle.png" alt="Aprobado" style="max-width:180px; margin-bottom:12px">' : '<img src="/static/lose_doodle.png" alt="Rechazado" style="max-width:180px; margin-bottom:12px">';
  const pct=d.percent;
  document.getElementById('r-pct').textContent=pct+'%';
  const C=553, arc=document.getElementById('gauge-arc');
  arc.style.transition='stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1),stroke .6s';
  arc.style.strokeDashoffset=C-(C*d.probability);
  arc.setAttribute('stroke',d.risk_color);
  const pill=document.getElementById('r-risk');
  document.getElementById('r-risk-label').textContent=d.risk_label;
  pill.querySelector('.dot').style.background=d.risk_color;
  pill.style.background=d.risk==='alta'?'var(--green-soft)':d.risk==='media'?'var(--gold-soft)':'var(--red-soft)';
  pill.style.color=d.risk_color;
  document.getElementById('r-verdict').textContent=d.verdict;

  const fac=(f,cls)=>`<div class="factor ${cls}"><div class="ic-box">${icon(cls==='pos'?'i-trending':'i-trending-down')}</div>
    <div class="body"><div class="nm">${f.label}</div><div class="bar"><i style="width:${Math.max(12,f.weight*100)}%"></i></div></div></div>`;
  document.getElementById('r-pos').innerHTML=(d.positive_factors||[]).map(f=>fac(f,'pos')).join('')||'<p style="color:var(--muted);font-size:13px">Sin factores positivos destacados.</p>';
  document.getElementById('r-neg').innerHTML=(d.negative_factors||[]).map(f=>fac(f,'neg')).join('')||'<p style="color:var(--muted);font-size:13px">No hay factores negativos relevantes.</p>';

  const RECIC={'\u{1F4B3}':'i-wallet','\u{1F4C5}':'i-calendar','\u{1F4B5}':'i-banknote','\u2705':'i-check'};
  document.getElementById('r-recs').innerHTML=(d.recommendations||[]).map(r=>{
    const ic=RECIC[r.icon]||'i-spark';
    const txt=(r.text||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'').trim();
    return `<div class="rec"><div class="ic-box">${icon(ic)}</div><span class="tx">${txt}</span>${r.gain>0?`<span class="gain">+${r.gain}%</span>`:''}</div>`;
  }).join('');

  const names={logit:'Regresión Logística',random_forest:'Random Forest',xgboost:'XGBoost',neural_net:'Red Neuronal'};
  document.getElementById('r-models').innerHTML=Object.entries(d.per_model||{}).map(([k,v])=>
    `<div class="mchip"><div class="nm">${names[k]||k}</div><div class="pc">${v}%</div></div>`).join('');
}

// ── PDF REPORT (informe imprimible → Guardar como PDF) ──
function downloadReport(){
  const d = lastResult;
  if(!d){ toast('Realiza una evaluación primero','err'); return; }
  const cat = CATEGORIES.find(c=>c.id===answers.catId);
  const sub = cat ? cat.sub.find(s=>s.id===answers.subId) : null;
  const fecha = new Date().toLocaleString('es-EC',{dateStyle:'long',timeStyle:'short'});
  const names = {logit:'Regresión Logística',random_forest:'Random Forest',xgboost:'XGBoost',neural_net:'Red Neuronal'};

  const row=(k,v)=>`<tr><td style="color:#64748B;padding:6px 0;border-bottom:1px solid #E5E9F0">${k}</td><td style="text-align:right;font-weight:700;color:#0F172A;padding:6px 0;border-bottom:1px solid #E5E9F0">${v||'—'}</td></tr>`;
  const facList=(arr,color,sign)=>(arr||[]).map(f=>`<li style="margin:4px 0;color:#334155"><span style="color:${color};font-weight:800">${sign}</span> ${f.label}</li>`).join('')||'<li style="color:#94A3B8">—</li>';
  const recList=(d.recommendations||[]).map(r=>{
    const txt=(r.text||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'').trim();
    return `<li style="margin:5px 0;color:#334155">${txt}${r.gain>0?` <b style="color:#16A34A">(+${r.gain}%)</b>`:''}</li>`;
  }).join('');
  const models=Object.entries(d.per_model||{}).map(([k,v])=>
    `<span style="display:inline-block;background:#F4F6FA;border:1px solid #E5E9F0;border-radius:8px;padding:6px 12px;margin:3px;font-size:12px"><b>${names[k]||k}</b>: ${v}%</span>`).join('');

  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
  <title>Informe JNUS AI · ${d.percent}%</title>
  <style>
    @page{margin:18mm}
    *{box-sizing:border-box;margin:0;font-family:'Segoe UI',system-ui,sans-serif}
    body{color:#0F172A;font-size:13px;line-height:1.5}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:3px solid #C8A24B;padding-bottom:14px;margin-bottom:18px}
    .hd img{width:52px;height:52px;border-radius:12px}
    .hd .t{font-size:22px;font-weight:800;letter-spacing:1px}
    .hd .t span{color:#C8A24B;font-size:13px}
    .hd .meta{margin-left:auto;text-align:right;color:#64748B;font-size:11px}
    .score{display:flex;align-items:center;gap:20px;background:#0F172A;color:#fff;border-radius:14px;padding:20px 24px;margin-bottom:18px}
    .score .pct{font-size:46px;font-weight:800;line-height:1}
    .score .lbl{font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:1px}
    .pill{display:inline-block;padding:5px 14px;border-radius:20px;font-weight:800;font-size:13px}
    h3{font-size:14px;margin:16px 0 8px;color:#0F172A;border-left:3px solid #C8A24B;padding-left:8px}
    table{width:100%;border-collapse:collapse}
    ul{margin:0;padding-left:18px}
    .foot{margin-top:22px;padding-top:12px;border-top:1px solid #E5E9F0;color:#94A3B8;font-size:10px;text-align:center}
    .cols{display:flex;gap:24px}.cols>div{flex:1}
  </style></head><body>
    <div class="hd">
      <img src="/static/logo.png" onerror="this.style.display='none'"/>
      <div class="t">JNUS<span> AI</span><div style="font-size:11px;color:#64748B;font-weight:600;letter-spacing:0">Informe de evaluación crediticia</div></div>
      <div class="meta">Generado: ${fecha}<br/>Documento orientativo</div>
    </div>
    <div class="score">
      <div><div class="pct">${d.percent}%</div><div class="lbl">Probabilidad de aprobación</div></div>
      <div style="margin-left:auto"><span class="pill" style="background:${d.risk_color}22;color:${d.risk_color}">${d.risk_label}</span>
        <div style="color:#CBD5E1;font-size:11px;margin-top:8px;max-width:280px">${d.verdict||''}</div></div>
    </div>
    <h3>Datos de la solicitud</h3>
    <table>
      ${row('Tipo de crédito',cat?cat.name:'')}
      ${row('Destino',sub?sub.label:'')}
      ${row('Institución',answers.institucion)}
      ${row('Situación laboral',answers.situacion_laboral)}
      ${row('Edad',answers.edad+' años')}
      ${row('Ingresos mensuales','$'+(answers.ingresos_mensuales||0).toLocaleString())}
      ${row('Cargas familiares',answers.cargas_familiares)}
      ${row('Créditos activos',answers.creditos_activos)}
      ${row('Nivel educativo',answers.educacion)}
      ${row('Historial de pagos',answers.historial_pagos)}
    </table>
    <div class="cols">
      <div><h3>Factores a favor</h3><ul>${facList(d.positive_factors,'#16A34A','▲')}</ul></div>
      <div><h3>Factores a mejorar</h3><ul>${facList(d.negative_factors,'#DC2626','▼')}</ul></div>
    </div>
    <h3>Recomendaciones</h3><ul>${recList||'<li style="color:#94A3B8">—</li>'}</ul>
    <h3>Análisis por modelo de IA</h3><div>${models}</div>
    <div class="foot">JNUS AI · Advanced Financial System · SIAC · Machala, Ecuador<br/>
      Esta evaluación es una estimación generada por inteligencia artificial con fines orientativos y no constituye una aprobación de crédito.</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>
  </body></html>`;

  const w=window.open('','_blank');
  if(!w){ toast('Permite las ventanas emergentes para descargar el PDF','err'); return; }
  w.document.write(html); w.document.close();
  toast('Abriendo informe… elige "Guardar como PDF"','ok');
}

// ── HISTORY ──
function saveHistory(d){
  const h=JSON.parse(localStorage.getItem('janus_hist')||'[]');
  const cat=CATEGORIES.find(c=>c.id===answers.catId);
  h.unshift({pct:d.percent,risk:d.risk_label,color:d.risk_color,
    tipo:cat?cat.name:'Crédito',date:new Date().toISOString()});
  localStorage.setItem('janus_hist',JSON.stringify(h.slice(0,20)));
}
function renderHistory(){
  const h=JSON.parse(localStorage.getItem('janus_hist')||'[]');
  const el=document.getElementById('hist-list');
  if(!h.length){el.innerHTML=`<div class="empty"><img src="/static/sin_historial.png" alt="Sin historial" style="max-width:180px; margin-bottom:12px; mix-blend-mode: multiply;"><h3 style="margin-top:6px">Sin evaluaciones aún</h3><p>Tu historial aparecerá aquí.</p></div>`;return;}
  el.innerHTML=h.map(x=>{
    const off=553-(553*x.pct/100);
    const dt=new Date(x.date).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'});
    return `<div class="hist-item">
      <svg class="ring" viewBox="0 0 210 210"><circle cx="105" cy="105" r="88" fill="none" stroke="#E5E9F0" stroke-width="20"/>
      <circle cx="105" cy="105" r="88" fill="none" stroke="${x.color}" stroke-width="20" stroke-linecap="round"
      stroke-dasharray="553" stroke-dashoffset="${off}" transform="rotate(-90 105 105)"/>
      <text x="105" y="120" text-anchor="middle" font-size="54" font-weight="800" fill="#0F172A" font-family="Manrope">${x.pct}</text></svg>
      <div class="meta"><div class="t">${x.tipo} · ${x.risk}</div><div class="d">${dt}</div></div></div>`;
  }).join('');
}
async function clearHistory(){ if(!await jnusConfirm('¿Borrar todo tu historial?',null,'Borrar historial',true)) return;
  localStorage.removeItem('janus_hist');renderHistory();renderDashboard();toast('Historial borrado','ok'); }

// ── DASHBOARD (Home) ──
let dp=null;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if(isIos && !window.navigator.standalone){const r=document.getElementById('install-row');if(r)r.style.display='flex';}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();dp=e;const r=document.getElementById('install-row');if(r)r.style.display='flex';});
function installPWA(){if(dp){dp.prompt();dp=null;}else if(isIos){toast('Para instalar en iPhone:\nToca el ícono Compartir (cuadro con flecha) y elige "Agregar a Inicio"');}else{toast('Usa el menú del navegador \n  "Añadir a pantalla de inicio"');}}
function renderDashboard(){
  const u=getUser()||{};
  const nm=document.getElementById('dash-name'); if(nm) nm.textContent=(u.name||'Invitado').split(' ')[0];
  const av=document.getElementById('dash-av');
  if(av){ av.innerHTML = u.avatar ? `<img src="${u.avatar}" alt=""/>` : icon('i-user'); }
  const h=JSON.parse(localStorage.getItem('janus_hist')||'[]');
  const sc=document.getElementById('dash-score');
  if(sc) sc.textContent = h.length ? h[0].pct+'%' : 'Sin evaluar';
  const rec=document.getElementById('dash-recent');
  if(rec){
    if(!h.length){ rec.innerHTML='<div class="dash-empty">'+DOODLE_HERO+'<div style="margin-top:4px">Aún no tienes evaluaciones. Toca <b>Evaluar</b> para empezar.</div></div>'; }
    else{
      rec.innerHTML=h.slice(0,3).map(x=>{
        const dt=new Date(x.date).toLocaleDateString('es',{day:'2-digit',month:'short'});
        return `<div class="dash-recent-item" onclick="go('history')">
          <div class="dri-ic">${icon('i-chart')}</div>
          <div class="dri-tx"><div class="dri-t">${x.tipo}</div><div class="dri-d">${x.risk} · ${dt}</div></div>
          <div class="dri-v">${x.pct}%</div></div>`;
      }).join('');
    }
  }
}

// ── PWA ──
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/app'}).catch(()=>{}));}

// ── ADMIN MODE (solo con ?admin=1) ──
function isAdmin(){
  try{return new URLSearchParams(location.search).get('admin')==='1';}catch{return false;}
}
async function loadAdminPanel(){
  if(!isAdmin()) return;
  const panel=document.getElementById('admin-panel');
  if(panel) panel.style.display='block';
  try{
    const m=await (await fetch(API+'/api/model_info')).json();
    if(m.error){document.getElementById('admin-model-info').innerHTML='<span style="color:var(--red)">'+m.error+'</span>';return;}
    const row=(k,v)=>`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)"><span style="color:var(--muted)">${k}</span><span style="font-weight:700;color:var(--navy)">${v}</span></div>`;
    const extra=Object.entries(m.metrics||{}).map(([k,v])=>row('AUC · '+k, v)).join('');
    document.getElementById('admin-model-info').innerHTML=
      row('Versión del modelo', m.version)+
      row('Fecha de entrenamiento', m.training_date)+
      row('Tamaño del dataset', (m.dataset_size||0).toLocaleString()+' registros')+
      row('Mejor algoritmo', m.best_algorithm)+
      row('AUC (mejor)', m.best_auc)+
      row('Archivo', m.bundle_path)+
      '<div style="margin-top:10px;font-size:11px;color:var(--muted)">Métricas por modelo:</div>'+extra;
  }catch(e){document.getElementById('admin-model-info').textContent='No se pudo cargar la info del modelo.';}
}

// ── CUENTA · estado + caché local (offline) ──
let CURRENT_USER=null;      // {id,name,email,avatar,guest?}
let _suAvatar=null;         // foto elegida al crear cuenta (data-URI)
let _epAvatar=undefined;    // foto elegida al editar (undefined = sin cambio)
function getUser(){ try{ return JSON.parse(localStorage.getItem('janus_user')||'null'); }catch{ return null; } }
function cacheUser(u){ CURRENT_USER=u; try{ localStorage.setItem('janus_user',JSON.stringify(u||null)); }catch{} }
function initials(name){ const n=(name||'').trim(); if(!n||n.toLowerCase()==='invitado') return '';
  return n.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

// Pinta nombre + avatar (foto real o iniciales) en la cabecera del perfil
function setProfileName(name, avatar){
  const el=document.getElementById('prof-name'); if(el) el.textContent = name||'Invitado';
  const av=document.getElementById('prof-av');
  if(av){
    if(avatar){ av.classList.add('has-img'); av.innerHTML=`<img src="${avatar}" alt=""/>`; }
    else{ av.classList.remove('has-img'); const ini=initials(name);
      av.innerHTML = ini || '<svg class="ic"><use href="#i-user"/></svg>'; }
  }
}

// ── PERFIL DINÁMICO · estadísticas + datos de cuenta ──
function renderProfile(){
  const h=JSON.parse(localStorage.getItem('janus_hist')||'[]');
  const u=CURRENT_USER||getUser();
  setProfileName(u&&u.name, u&&u.avatar);
  const sub=document.getElementById('prof-sub');
  if(sub){
    if(u&&u.email) sub.textContent=u.email;
    else sub.textContent = h.length ? `${h.length} ${h.length===1?'evaluación':'evaluaciones'} · JNUS AI`
                                    : (u&&u.guest?'Invitado · JNUS AI':'Usuario de JNUS AI');
  }
  // Estado de seguridad (PIN / biometría)
  const secSt=document.getElementById('sec-state');
  if(secSt) secSt.textContent = pinIsSet() ? (bioIsSet()?'PIN + huella':'PIN activo') : 'Desactivado';
  // Acciones de cuenta: editar / cerrar sesión solo si hay cuenta real (con email)
  const acc=document.getElementById('account-actions');
  if(acc) acc.style.display = (u&&u.email)?'block':'none';
  const guestCta=document.getElementById('guest-cta');
  if(guestCta) guestCta.style.display = (u&&u.email)?'none':'block';
  const cnt=document.getElementById('ps-count'), best=document.getElementById('ps-best'), last=document.getElementById('ps-last');
  if(cnt) cnt.textContent=h.length;
  if(h.length){
    const mx=Math.max(...h.map(x=>x.pct));
    if(best) best.textContent=mx+'%';
    if(last) last.textContent=h[0].pct+'%';
  }else{ if(best)best.textContent='—'; if(last)last.textContent='—'; }
  const sp=document.getElementById('prof-spark');
  if(sp){
    const recent=h.slice(0,8).reverse();
    if(!recent.length){ sp.innerHTML=''; }
    else sp.innerHTML=recent.map((x,i)=>
      `<div class="sb" style="height:${Math.max(8,x.pct)}%;background:linear-gradient(180deg,${x.color},${x.color}aa);animation-delay:${i*55}ms"
        title="${x.tipo}: ${x.pct}%"></div>`).join('');
  }
}
function closeWelcome(){ document.getElementById('welcome').classList.remove('open'); document.body.classList.remove('modal-bg'); playAppEntrance(); }

// Entrada escalonada de las tarjetas del inicio (una sola vez, tras el splash/modal)
let _appEntered=false;
function playAppEntrance(){
  if(_appEntered) return; _appEntered=true;
  document.body.classList.add('app-in');
  setTimeout(()=>document.body.classList.remove('app-in'), 1600);
  renderDashboard();
  initReveal();
}

// Reveal de secciones al hacer scroll (landing largo estilo btodigital)
let _revealInit=false;
function initReveal(){
  if(_revealInit) return; _revealInit=true;
  const screen=document.querySelector('.screen');
  const els=document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('in')); return; }
  const io=new IntersectionObserver(ents=>{
    ents.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  },{root:screen, rootMargin:'0px 0px -6% 0px', threshold:0.06});
  els.forEach(e=>io.observe(e));
}
function scrollToHow(){
  const a=document.getElementById('how-anchor'), s=document.querySelector('.screen');
  if(a&&s) s.scrollTo({top:a.offsetTop-14, behavior:'smooth'});
}

// ── Pestañas crear cuenta / iniciar sesión ──
function authTab(which){
  const su=which==='signup';
  document.getElementById('tab-signup').classList.toggle('on',su);
  document.getElementById('tab-login').classList.toggle('on',!su);
  document.getElementById('auth-ind').classList.toggle('right',!su);
  document.getElementById('form-signup').style.display=su?'flex':'none';
  document.getElementById('form-login').style.display=su?'none':'flex';
  document.getElementById('auth-title').textContent=su?'Crea tu cuenta':'Bienvenido de vuelta';
  document.getElementById('auth-sub').textContent=su?'Guarda tu historial y evalúa tu crédito cuando quieras.':'Inicia sesión para continuar donde lo dejaste.';
}

// ── Foto de perfil: redimensiona en el cliente a 256px (data-URI ligero) ──
function resizeImage(file, max=256){
  return new Promise((resolve,reject)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url);
      let{width:w,height:h}=img; const s=Math.min(1,max/Math.max(w,h)); w=Math.round(w*s); h=Math.round(h*s);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      resolve(c.toDataURL('image/jpeg',0.82)); };
    img.onerror=reject; img.src=url;
  });
}
async function pickAvatar(input, prevId, target){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>8*1024*1024){ toast('La imagen es muy grande (máx 8MB)','err'); return; }
  try{
    const data=await resizeImage(f);
    if(target==='edit') _epAvatar=data; else _suAvatar=data;
    const prev=document.getElementById(prevId);
    if(prev){ prev.classList.add('has-img'); prev.innerHTML=`<img src="${data}" alt=""/>`; }
  }catch(e){ toast('No se pudo procesar la imagen','err'); }
}

async function doSignup(e){
  e.preventDefault();
  const name=val('su-name'), email=val('su-email'), p1=val('su-pass'), p2=val('su-pass2');
  if(!name){ toast('Escribe tu nombre','err'); return false; }
  if(!email){ toast('Escribe tu email','err'); return false; }
  if(p1.length<6){ toast('La contraseña debe tener al menos 6 caracteres','err'); return false; }
  if(p1!==p2){ toast('Las contraseñas no coinciden','err'); return false; }
  if(!document.getElementById('su-consent').checked){ toast('Debes aceptar la Política de Privacidad para crear tu cuenta','err'); return false; }
  const remember=document.getElementById('su-remember').checked;
  try{
    const r=await fetch(API+'/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,email,password:p1,avatar:_suAvatar,remember,consent:true})});
    const d=await r.json();
    if(d.error){ toast(d.error,'err'); return false; }
    cacheUser(d.user); renderProfile(); closeWelcome(); toast('¡Cuenta creada! Hola, '+d.user.name,'ok');
  }catch(e){ toast('Sin conexión. Intenta de nuevo.','err'); }
  return false;
}
async function doLogin(e){
  e.preventDefault();
  const email=val('li-email'), p=val('li-pass');
  if(!email||!p){ toast('Escribe tu email y contraseña','err'); return false; }
  const remember=document.getElementById('li-remember').checked;
  try{
    const r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password:p,remember})});
    const d=await r.json();
    if(d.error){ toast(d.error,'err'); return false; }
    cacheUser(d.user); renderProfile(); closeWelcome(); toast('¡Hola de nuevo, '+d.user.name+'!','ok');
  }catch(e){ toast('Sin conexión. Intenta de nuevo.','err'); }
  return false;
}
function val(id){ return (document.getElementById(id)?.value||'').trim(); }

function skipName(){ cacheUser({name:'Invitado',guest:true}); setProfileName('Invitado'); closeWelcome(); }

async function logoutUser(){
  if(!await jnusConfirm('¿Cerrar tu sesión?','Podrás volver a entrar cuando quieras.','Cerrar sesión',true)) return;
  try{ await fetch(API+'/api/logout',{method:'POST'}); }catch(e){}
  cacheUser(null); CURRENT_USER=null;
  toast('Sesión cerrada','ok');
  document.getElementById('welcome').classList.add('open'); document.body.classList.add('modal-bg');
  authTab('login');
}
// Derecho de supresión (LOPDP): borra la cuenta y todos los datos del usuario
async function deleteAccount(){
  if(!await jnusConfirm('¿Eliminar tu cuenta y TODOS tus datos?','Borra tu perfil y tu historial de forma permanente. No se puede deshacer.','Eliminar todo',true)) return;
  if(!await jnusConfirm('Confirma otra vez','Se eliminarán definitivamente tus datos de nuestros servidores.','Sí, eliminar',true)) return;
  try{
    const r=await fetch(API+'/api/account',{method:'DELETE'});
    const d=await r.json();
    if(d.error){ toast(d.error,'err'); return; }
    // Limpieza local total: cuenta, historial, PIN y biometría del dispositivo
    try{ localStorage.removeItem('janus_user'); localStorage.removeItem('janus_hist');
         localStorage.removeItem('janus_pin'); localStorage.removeItem('janus_bio'); }catch(e){}
    cacheUser(null); CURRENT_USER=null;
    toast('Cuenta y datos eliminados','ok');
    document.getElementById('welcome').classList.add('open'); document.body.classList.add('modal-bg');
    authTab('signup');
  }catch(e){ toast('Sin conexión. Intenta de nuevo.','err'); }
}

// ── Editar perfil (modal) ──
function openEditProfile(){
  const u=CURRENT_USER||getUser(); if(!u) return;
  _epAvatar=undefined;
  document.getElementById('ep-name').value=u.name||'';
  document.getElementById('ep-pass').value='';
  const prev=document.getElementById('ep-prev');
  if(u.avatar){ prev.classList.add('has-img'); prev.innerHTML=`<img src="${u.avatar}" alt=""/>`; }
  else{ prev.classList.remove('has-img'); prev.innerHTML='<svg class="ic"><use href="#i-camera"/></svg>'; }
  document.getElementById('editp').classList.add('open'); document.body.classList.add('modal-bg');
}
function closeEditProfile(){ document.getElementById('editp').classList.remove('open'); document.body.classList.remove('modal-bg'); }
async function saveEditProfile(e){
  e&&e.preventDefault();
  const name=val('ep-name'), pass=val('ep-pass');
  const body={name}; if(pass) body.password=pass; if(_epAvatar!==undefined) body.avatar=_epAvatar;
  try{
    const r=await fetch(API+'/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.error){ toast(d.error,'err'); return false; }
    cacheUser(d.user); renderProfile(); closeEditProfile(); toast('Perfil actualizado','ok');
  }catch(e){ toast('No se pudo guardar','err'); }
  return false;
}

// Al abrir la app (tras la intro): la pantalla de CUENTA es lo primero.
// Solo se entra directo si hay una cuenta REAL con sesión activa; así el
// usuario siempre puede crear su cuenta / iniciar sesión y guardar credenciales.
async function maybeWelcome(){
  let user=null;
  try{
    const r=await fetch(API+'/api/me'); const d=await r.json();
    user = d.user || null;                       // cuenta real con sesión en el servidor
  }catch(e){
    const u=getUser();                           // sin red: solo cuentas reales cacheadas
    if(u && u.email) user=u;
  }
  if(user){ cacheUser(user); setProfileName(user.name,user.avatar); playAppEntrance(); return; }
  // Invitado recordado → entra directo (el perfil tiene el CTA para crear cuenta)
  const g = getUser();
  if(g && g.guest){ CURRENT_USER=g; setProfileName('Invitado'); playAppEntrance(); return; }
  // Sin cuenta → mostrar Crear cuenta / Iniciar sesión PRIMERO (con opción invitado)
  document.getElementById('welcome').classList.add('open'); document.body.classList.add('modal-bg');
  if(typeof authTab==='function') authTab('signup');
  setTimeout(()=>document.getElementById('su-name')?.focus(),450);
}

// ── SPLASH CINEMÁTICO ──
// Narrativa (storyboard): red dorada de vida → energía que converge → cristal IA
// → núcleo verde (decisión/aprobación) → revelado de marca JNUS.
// Motor principal: 3D WebGL (Three.js + GSAP, ~7s). Fallback: 2D canvas (5s).
const SPLASH_T0 = Date.now();
const SPLASH_DUR = 5000;          // duración de la animación 2D (fallback)
let splashAnimDone = false;       // animación terminó
let appInitDone = false;          // datos de la app listos

function startSplash2D(){
  const cv = document.getElementById('splash-cv');
  if(!cv){ splashAnimDone = true; return; }
  const ctx = cv.getContext('2d');
  let W,H,cx,cy,dpr,P=[],dot,orbR,iconDefs=[];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  const sstep = t => t<=0?0 : t>=1?1 : t*t*(3-2*t);
  const seg = (t,a,b) => sstep((t-a)/(b-a));
  const lerp = (a,b,t) => a+(b-a)*t;

  // Sprite de punto suave dorado (se dibuja con drawImage = muy rápido)
  function makeDot(){
    dot=document.createElement('canvas'); dot.width=dot.height=26;
    const d=dot.getContext('2d');
    const g=d.createRadialGradient(13,13,0,13,13,13);
    g.addColorStop(0,'rgba(228,190,112,0.98)');
    g.addColorStop(0.4,'rgba(196,158,74,0.62)');
    g.addColorStop(1,'rgba(196,158,74,0)');
    d.fillStyle=g; d.beginPath(); d.arc(13,13,13,0,6.2832); d.fill();
  }

  // ── Siluetas (se dibujan en un canvas oculto y se MUESTREAN como puntos) ──
  function famPath(c,s){
    const fy=s*0.72, F=[[-0.80,0.92],[-0.30,1.50],[0.20,1.42],[0.66,0.80]];
    for(const [dx,h0] of F){ const px=s*dx,h=s*h0,hr=h*0.16,sh=fy-h+2*hr,sw=h*0.17,bw=h*0.21;
      c.beginPath(); c.arc(px,fy-h+hr,hr,0,6.2832); c.fill();
      c.beginPath(); c.moveTo(px-bw,fy); c.lineTo(px-sw,sh); c.quadraticCurveTo(px,sh-hr*0.8,px+sw,sh); c.lineTo(px+bw,fy); c.quadraticCurveTo(px,fy+h*0.05,px-bw,fy); c.closePath(); c.fill(); }
  }
  function housePath(c,s){
    const w=s*1.05,h=s*0.62,rh=s*0.5,bx=-w/2,by=-h*0.04;
    c.beginPath(); c.moveTo(bx-s*0.14,by); c.lineTo(0,by-rh); c.lineTo(bx+w+s*0.14,by); c.closePath(); c.fill();
    c.beginPath(); c.rect(bx,by,w,h); c.fill();
    c.beginPath(); c.rect(bx+w*0.66,by-rh*0.74,s*0.13,rh*0.62); c.fill();
  }
  function cartPath(c,s){
    const w=s*1.05;
    c.beginPath(); c.moveTo(-w*0.38,-s*0.30); c.lineTo(w*0.52,-s*0.30); c.lineTo(w*0.34,s*0.16); c.lineTo(-w*0.24,s*0.16); c.closePath(); c.fill();
    c.lineWidth=s*0.11; c.strokeStyle='#fff'; c.lineCap='round'; c.lineJoin='round';
    c.beginPath(); c.moveTo(-w*0.38,-s*0.30); c.lineTo(-w*0.58,-s*0.46); c.lineTo(-w*0.74,-s*0.46); c.stroke();
    c.beginPath(); c.arc(-w*0.10,s*0.36,s*0.12,0,6.2832); c.fill();
    c.beginPath(); c.arc(w*0.28,s*0.36,s*0.12,0,6.2832); c.fill();
  }
  function storePath(c,s){
    const w=s*1.1,h=s*0.6,top=-s*0.02;
    c.beginPath(); c.rect(-w/2,top,w,h); c.fill();
    c.beginPath(); c.moveTo(-w*0.6,top); c.lineTo(-w*0.44,top-s*0.28); c.lineTo(w*0.44,top-s*0.28); c.lineTo(w*0.6,top); c.closePath(); c.fill();
    c.beginPath(); c.rect(-w*0.17,top-s*0.5,w*0.34,s*0.2); c.fill();
  }
  // Posiciones/escala de las 4 figuras (compartidas por silueta y puntos)
  function computeDefs(){
    const m=Math.min(W,H);
    iconDefs=[
      {fn:famPath,   type:'family', x:cx-W*0.21, y:cy+H*0.02, s:m*0.165},  // familia
      {fn:housePath, type:'house',  x:cx+W*0.23, y:cy-H*0.15, s:m*0.135},  // inmobiliario
      {fn:cartPath,  type:'cart',   x:cx-W*0.22, y:cy+H*0.22, s:m*0.110},  // consumo
      {fn:storePath, type:'store',  x:cx+W*0.22, y:cy+H*0.19, s:m*0.128},  // negocio
    ];
  }
  function sampleTargets(){
    const off=document.createElement('canvas'); off.width=W; off.height=H;
    const o=off.getContext('2d'); o.fillStyle='#fff';
    for(const d of iconDefs){ o.save(); o.translate(d.x,d.y); d.fn(o,d.s); o.restore(); }
    const data=o.getImageData(0,0,W,H).data, pts=[], st=5;
    for(let y=0;y<H;y+=st) for(let x=0;x<W;x+=st){ if(data[((y*W+x)<<2)+3]>140) pts.push([x+(Math.random()-0.5)*st, y+(Math.random()-0.5)*st]); }
    for(let i=pts.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0,tmp=pts[i]; pts[i]=pts[j]; pts[j]=tmp; }
    return pts.slice(0,1100);
  }
  // Silueta suave con volumen 3D (para que las figuras SE VEAN claramente)
  function drawBaseSil(d,alpha){
    if(alpha<=0.012) return;
    ctx.save(); ctx.globalAlpha=Math.min(1,alpha); ctx.translate(d.x,d.y);
    ctx.shadowColor='rgba(40,55,85,0.16)'; ctx.shadowBlur=16; ctx.shadowOffsetY=9;
    const g=ctx.createLinearGradient(-d.s*0.8,-d.s,d.s*0.8,d.s);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.55,'#eef2f8'); g.addColorStop(1,'#dde4ee');
    ctx.fillStyle=g; ctx.strokeStyle=g;
    d.fn(ctx,d.s);
    ctx.restore();
  }

  function resize(){
    dpr=Math.min(window.devicePixelRatio||1,2);
    W=cv.clientWidth; H=cv.clientHeight; cv.width=W*dpr; cv.height=H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0); cx=W/2; cy=H*0.46; build();
  }
  function build(){
    orbR=Math.min(W,H)*0.05; makeDot(); computeDefs(); P=[];
    const mk=(tx,ty,amb)=>{ const a=Math.random()*6.2832, rad=Math.max(W,H)*(0.45+Math.random()*0.45);
      P.push({sx:cx+Math.cos(a)*rad, sy:cy+Math.sin(a)*rad, tx, ty,
        ox:(Math.random()-0.5)*orbR*2.2, oy:(Math.random()-0.5)*orbR*2.2,
        z:Math.random(), seed:Math.random()*6.2832, delay:Math.random()*400, amb}); };
    for(const [x,y] of sampleTargets()) mk(x,y,0);                       // puntos de las figuras
    for(let i=0;i<36;i++){ const a=Math.random()*6.2832, r=(0.12+Math.random()*0.44)*Math.min(W,H); mk(cx+Math.cos(a)*r, cy+Math.sin(a)*r*0.8, 1); }  // red de puntos (sutil)
  }

  function frame(){
    const t = Date.now()-SPLASH_T0;
    // Estela fluida: velo claro en vez de borrar → rastros suaves
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(247,249,252,0.30)'; ctx.fillRect(0,0,W,H);

    // Línea de tiempo: formar (0-1.2s) → MOSTRAR figuras (1.2-2.8s) → fluir al centro → núcleo verde → marca
    const formP=sstep((t-100)/1100);
    const convP=sstep((t-2800)/1050);
    const orbP =sstep((t-3450)/800);
    const greenP=sstep((t-3900)/650);
    const fade=1-seg(t,4400,4950);
    const figVis=Math.min(1,formP*1.15)*(1-convP)*fade;     // visibilidad de las figuras sólidas

    // SILUETAS 3D (para que SE VEAN las figuras: familia · casa · carrito · negocio)
    for(const d of iconDefs) drawBaseSil(d, 0.92*figVis);

    // Halo dorado al converger
    if(orbP>0){
      const r=orbR*(1.2+orbP*3.4);
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(232,198,128,'+(0.30*orbP*(1-greenP)*fade)+')');
      g.addColorStop(1,'rgba(232,198,128,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,6.2832); ctx.fill();
    }

    // PUNTOS dorados (brillo + red + flujo) sobre las figuras
    for(const p of P){
      const fp=sstep((t-p.delay)/1100);
      let bx=lerp(p.sx,p.tx,fp), by=lerp(p.sy,p.ty,fp);
      const j=(1-convP);
      bx+=Math.sin(t*0.0015+p.seed)*2.6*j; by+=Math.cos(t*0.0015+p.seed*1.3)*2.6*j;
      const x=lerp(bx,cx+p.ox,convP), y=lerp(by,cy+p.oy,convP);
      const a=fp*fade*(p.amb?0.22:(0.42+p.z*0.4));
      if(a<=0.012) continue;
      const sz=(3.4+p.z*5.6)*(1+convP*0.3);
      ctx.globalAlpha=a; ctx.drawImage(dot, x-sz/2, y-sz/2, sz, sz);
    }
    ctx.globalAlpha=1;

    // NÚCLEO VERDE: la decisión / aprobación
    if(greenP>0){
      const r=orbR*(1.0+greenP*1.9);
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(150,245,205,'+(0.95*greenP*fade)+')');
      g.addColorStop(0.45,'rgba(52,211,153,'+(0.55*greenP*fade)+')');
      g.addColorStop(1,'rgba(16,185,129,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,6.2832); ctx.fill();
    }

    if(t>=4450){ const rev=document.getElementById('sp-reveal'); if(rev && !rev.classList.contains('show')) rev.classList.add('show'); }
    if(t>=SPLASH_DUR){ splashAnimDone=true; maybeHideSplash(); return; }
    requestAnimationFrame(frame);
  }

  resize(); window.addEventListener('resize',resize);
  if(reduce){
    const rev=document.getElementById('sp-reveal'); if(rev) rev.classList.add('show');
    setTimeout(()=>{ splashAnimDone=true; maybeHideSplash(); }, 900);
  } else { requestAnimationFrame(frame); }
}

// ── SPLASH 3D · "JNUS Cinematic" (Three.js + GSAP) ──
// Esculturas blancas (familia·casa·negocio·finanzas·IA) unidas por una red
// dorada de partículas que converge en un núcleo de luz. Compacto (~7s) y
// optimizado para teléfonos: menos partículas, sin sombras, encuadre vertical.
function startSplash3D(){
  if(!(window.THREE && window.gsap)) return false;
  const canvas=document.getElementById('splash-gl');
  const splashEl=document.getElementById('splash');
  if(!canvas||!splashEl) return false;

  const MOBILE=Math.min(window.innerWidth,window.innerHeight)<560||window.innerWidth<768;
  let renderer;
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:!MOBILE,alpha:true,powerPreference:'high-performance'});
  }catch(e){ return false; }
  splashEl.classList.add('gl');

  const W=()=>splashEl.clientWidth, H=()=>splashEl.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, MOBILE?1.6:2));
  renderer.setSize(W(),H());
  renderer.shadowMap.enabled=!MOBILE;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputEncoding=THREE.sRGBEncoding;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.32;
  renderer.setClearColor(0xffffff,0);   // deja ver el degradado claro del #splash

  const scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0xf7f9fc,0.010);
  const camera=new THREE.PerspectiveCamera(55,W()/H(),0.05,200);
  const world=new THREE.Group(); scene.add(world);

  // Composición según orientación: en retrato los nodos se ordenan en
  // PROFUNDIDAD (corredor hacia el fondo) y la cámara recorre el pasillo.
  const PORTRAIT=H()>W()*1.05;
  const L=PORTRAIT?{
    nodes:[[-3.2,2],[3.4,-1.5],[-3.4,-5.5],[3.2,-9],[-0.2,-13]],
    fins:[[-2.6,-2],[2.6,-2],[-2.6,-6],[2.6,-6],[0,-9]],
    core:[0,1.4,-4], look:[0,1.3,-3.5],
    camStart:[0,2.6,12],
    sweep:[[0,2.6,12],[-3.2,2.3,4],[3.2,2.1,0],[0,3.2,7]],
    pull:[0,9.5,8], push:[0,2.7,3.2]
  }:{
    nodes:[[-9,-5],[9,-6],[-9,6],[9,5],[0,-11]],
    fins:[[-4.5,0],[4.5,0],[-4.5,3.5],[4.5,3.5],[0,-4.5]],
    core:[0,1.4,0], look:[0,1.2,0],
    camStart:[0,2.4,20],
    sweep:[[0,2.4,20],[-7,2.6,9],[6,2.2,5],[0,3.4,13]],
    pull:[0,11,19], push:[0,3.4,10.5]
  };
  camera.position.set(L.camStart[0],L.camStart[1],L.camStart[2]);

  // Hemisférica (cielo blanco / suelo cálido) modela el volumen sin sombras reales
  scene.add(new THREE.HemisphereLight(0xffffff,0xb9b0a0,0.85));
  const sun=new THREE.DirectionalLight(0xfff9f0,2.3);
  sun.position.set(8,14,10);
  if(!MOBILE){ sun.castShadow=true; sun.shadow.mapSize.set(1024,1024);
    sun.shadow.camera.left=-22; sun.shadow.camera.right=22;
    sun.shadow.camera.top=22; sun.shadow.camera.bottom=-22; sun.shadow.radius=4; }
  scene.add(sun);
  const fillL=new THREE.DirectionalLight(0xdde8ff,0.7); fillL.position.set(-10,4,6); scene.add(fillL);

  const MAT={
    scu:new THREE.MeshStandardMaterial({color:0xe7e1d6,roughness:0.72,metalness:0.05}),
    acc:new THREE.MeshStandardMaterial({color:0xd9d2c5,roughness:0.82,metalness:0.02}),
    gold:new THREE.MeshStandardMaterial({color:0xD4AF37,roughness:0.22,metalness:0.92,emissive:0xC9A227,emissiveIntensity:0.12}),
    glass:new THREE.MeshStandardMaterial({color:0xe4e0d8,roughness:0.65,metalness:0.03,transparent:true,opacity:0.92}),
    core:new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.05,metalness:0.3,emissive:0xD4AF37,emissiveIntensity:0,transparent:true,opacity:0})
  };
  function sh(m){ if(!MOBILE){m.castShadow=true;m.receiveShadow=true;} return m; }

  const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),
    new THREE.MeshStandardMaterial({color:0xf4f2ec,roughness:1,transparent:true,opacity:0}));
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.06;
  if(!MOBILE) ground.receiveShadow=true;
  world.add(ground);

  // Sombra "blob" bajo cada escultura (ancla visual barata; clave en móvil sin shadow-map)
  const blobCv=document.createElement('canvas'); blobCv.width=blobCv.height=128;
  const bctx=blobCv.getContext('2d');
  const bgr=bctx.createRadialGradient(64,64,0,64,64,64);
  bgr.addColorStop(0,'rgba(35,45,65,0.30)'); bgr.addColorStop(1,'rgba(35,45,65,0)');
  bctx.fillStyle=bgr; bctx.fillRect(0,0,128,128);
  const blobTex=new THREE.CanvasTexture(blobCv);
  function addBlob(parent,r){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(r*2,r*2),
      new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.position.y=0.02; parent.add(m);
  }

  // ── Esculturas ──
  function makeFigure(h,rH,rT){
    const g=new THREE.Group();
    const head=sh(new THREE.Mesh(new THREE.SphereGeometry(rH,16,16),MAT.scu)); head.position.y=h-rH; g.add(head);
    const torso=sh(new THREE.Mesh(new THREE.CylinderGeometry(rT*.9,rT*1.1,h*.44,12),MAT.scu)); torso.position.y=h*.4; g.add(torso);
    [-.28,.28].forEach(ox=>{
      const leg=sh(new THREE.Mesh(new THREE.CylinderGeometry(rT*.42,rT*.36,h*.38,8),MAT.scu));
      leg.position.set(ox*rT*4,h*.06,0); g.add(leg);
    });
    return g;
  }
  function buildFamily(){
    const g=new THREE.Group();
    [[2.0,.28,.21,-.5],[1.8,.25,.19,.45],[1.25,.18,.14,-1.1],[1.15,.17,.13,1.05]].forEach(([h,rh,rt,x])=>{
      const f=makeFigure(h,rh,rt); f.position.x=x; g.add(f);
    });
    return g;
  }
  function buildHouse(){
    const g=new THREE.Group();
    const base=sh(new THREE.Mesh(new THREE.BoxGeometry(2.8,1.8,2.0),MAT.scu)); base.position.y=.9; g.add(base);
    const roof=sh(new THREE.Mesh(new THREE.ConeGeometry(2.15,1.1,4),MAT.scu)); roof.position.y=2.35; roof.rotation.y=Math.PI/4; g.add(roof);
    const door=sh(new THREE.Mesh(new THREE.BoxGeometry(.4,.85,.06),MAT.acc)); door.position.set(0,.42,1.02); g.add(door);
    [[.6,1.1],[-.6,1.1]].forEach(([x,y])=>{
      const w=sh(new THREE.Mesh(new THREE.BoxGeometry(.6,.5,.06),MAT.glass)); w.position.set(x,y,1.02); g.add(w);
    });
    return g;
  }
  function buildMarket(){
    const g=new THREE.Group();
    const dome=sh(new THREE.Mesh(new THREE.SphereGeometry(1.4,22,12,0,Math.PI*2,0,Math.PI*.5),MAT.scu)); g.add(dome);
    const base2=sh(new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.45,.22,22),MAT.acc)); base2.position.y=-.1; g.add(base2);
    for(let i=0;i<6;i++){
      const a=i/6*Math.PI*2;
      const col=sh(new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,1.15,6),MAT.scu));
      col.position.set(Math.cos(a)*1.25,.45,Math.sin(a)*1.25); g.add(col);
    }
    return g;
  }
  function buildFinance(){
    const g=new THREE.Group();
    [.85,.65,.45].forEach((r,i)=>{
      const coin=sh(new THREE.Mesh(new THREE.CylinderGeometry(r,r,.17,24),MAT.scu)); coin.position.y=i*.21; g.add(coin);
    });
    [2.1,1.4,2.7,1.0].forEach((h,i)=>{
      const bar=sh(new THREE.Mesh(new THREE.BoxGeometry(.32,h,.32),MAT.scu)); bar.position.set(-1.1+i*.6,h*.5+.65,0); g.add(bar);
    });
    return g;
  }
  function buildTech(){
    const g=new THREE.Group();
    const body=sh(new THREE.Mesh(new THREE.BoxGeometry(2.1,2.8,.9),MAT.scu)); body.position.y=1.4; g.add(body);
    for(let i=0;i<5;i++){
      const rack=sh(new THREE.Mesh(new THREE.BoxGeometry(1.7,.24,.06),MAT.acc)); rack.position.set(0,.4+i*.44,.47); g.add(rack);
      const led=new THREE.Mesh(new THREE.SphereGeometry(.05,8,8),MAT.gold); led.position.set(-.75,.4+i*.44,.5); g.add(led);
    }
    return g;
  }

  // 5 nodos: familia · casa · negocio · finanzas · IA (tipos de crédito JNUS)
  const builders=[buildFamily,buildHouse,buildMarket,buildFinance,buildTech];
  const rots=[.4,-.3,.5,-.4,0];
  const NODES=builders.map((b,i)=>({build:b,rot:rots[i],
    pos:new THREE.Vector3(L.nodes[i][0],0,L.nodes[i][1]),
    fin:new THREE.Vector3(L.fins[i][0],0,L.fins[i][1])}));
  NODES.forEach(n=>{
    n.group=n.build();
    if(MOBILE) addBlob(n.group,2.3);
    n.group.position.copy(n.pos); n.group.rotation.y=n.rot; n.group.scale.setScalar(0);
    world.add(n.group);
  });

  // Uniones doradas + líneas curvas
  const junMat=new THREE.MeshStandardMaterial({color:0xD4AF37,roughness:.18,metalness:.95,emissive:0xC9A227,emissiveIntensity:.3});
  const junctions=NODES.map(n=>{
    const j=new THREE.Mesh(new THREE.SphereGeometry(.09,12,12),junMat.clone());
    j.position.copy(n.pos).add(new THREE.Vector3(0,1.4,0)); j.scale.setScalar(0);
    world.add(j); return j;
  });
  const pairs=[]; for(let a=0;a<5;a++) for(let b=a+1;b<5;b++) pairs.push([a,b]);
  const connections=pairs.map(([a,b])=>{
    const from=NODES[a].pos.clone().add(new THREE.Vector3(0,1.4,0));
    const to  =NODES[b].pos.clone().add(new THREE.Vector3(0,1.4,0));
    const pts=[];
    for(let i=0;i<=20;i++){
      const t=i/20, p=new THREE.Vector3().lerpVectors(from,to,t);
      p.y+=Math.sin(t*Math.PI)*0.7; pts.push(p);
    }
    const mat=new THREE.LineBasicMaterial({color:0xD4AF37,transparent:true,opacity:0});
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat);
    line.visible=false; world.add(line);
    return {line,mat,pts};
  });

  // Partículas doradas que recorren la red
  const NPART=MOBILE?520:1400;
  const pPos=new Float32Array(NPART*3), pData=[];
  const pcv=document.createElement('canvas'); pcv.width=pcv.height=32;
  const px=pcv.getContext('2d'), pg=px.createRadialGradient(16,16,0,16,16,16);
  pg.addColorStop(0,'rgba(255,230,120,1)'); pg.addColorStop(.5,'rgba(212,175,55,.7)'); pg.addColorStop(1,'rgba(212,175,55,0)');
  px.fillStyle=pg; px.beginPath(); px.arc(16,16,16,0,Math.PI*2); px.fill();
  const pGeo=new THREE.BufferGeometry();
  pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
  const pMat=new THREE.PointsMaterial({size:.14,map:new THREE.CanvasTexture(pcv),transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const ptSystem=new THREE.Points(pGeo,pMat); ptSystem.visible=false; world.add(ptSystem);
  for(let i=0;i<NPART;i++){
    pData.push({conn:(Math.random()*pairs.length)|0,t:Math.random(),speed:.005+Math.random()*.011});
    pPos[i*3+2]=-200;
  }

  // Núcleo IA central
  const coreGroup=new THREE.Group(); coreGroup.position.set(L.core[0],L.core[1],L.core[2]); world.add(coreGroup);
  coreGroup.add(new THREE.Mesh(new THREE.SphereGeometry(.75,MOBILE?32:48,MOBILE?32:48),MAT.core));
  const icoMat=new THREE.MeshBasicMaterial({color:0xD4AF37,wireframe:true,transparent:true,opacity:0});
  const icoWire=new THREE.Mesh(new THREE.IcosahedronGeometry(1.1,2),icoMat); coreGroup.add(icoWire);
  const ringMat=new THREE.MeshStandardMaterial({color:0xD4AF37,roughness:.2,metalness:.9,transparent:true,opacity:0,emissive:0xC9A227,emissiveIntensity:.2});
  const rings=[0,1,2].map(i=>{
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.3,.013,6,64),i?ringMat.clone():ringMat);
    if(i===0) r.rotation.x=Math.PI/2;
    if(i===1){ r.rotation.set(Math.PI/4,0,Math.PI/3); r.scale.setScalar(1.15); }
    if(i===2){ r.rotation.set(0,Math.PI/3,Math.PI/5); r.scale.setScalar(.85); }
    coreGroup.add(r); return r;
  });

  // Recorrido de cámara breve (barrido único, no tour completo)
  const camCurve=new THREE.CatmullRomCurve3(
    L.sweep.map(p=>new THREE.Vector3(p[0],p[1],p[2])),false,'catmullrom',.4);

  let camT=0,camFollow=false,assembling=false,coreActive=false;
  const clock=new THREE.Clock(); let elapsed=0;

  function tick(){
    if(!canvas.isConnected){ try{renderer.dispose();}catch(e){} return; }
    requestAnimationFrame(tick);
    const dt=clock.getDelta(); elapsed+=dt;

    if(camFollow){
      const pos=camCurve.getPoint(Math.min(camT,.999));
      camera.position.lerp(pos,.07);
    }
    camera.lookAt(L.look[0],L.look[1],L.look[2]);

    NODES.forEach((n,i)=>{
      if(!assembling){
        n.group.position.y=n.pos.y+Math.sin(elapsed*.5+i*1.1)*.1;
        n.group.rotation.y=n.rot+Math.sin(elapsed*.25+i*.7)*.04;
      }
    });

    if(ptSystem.visible){
      const arr=pGeo.attributes.position.array;
      const conv=assembling?.6:0;
      for(let i=0;i<NPART;i++){
        const d=pData[i];
        d.t+=d.speed;
        if(d.t>1){ d.t=0; d.conn=(Math.random()*pairs.length)|0; }
        const pts=connections[d.conn].pts;
        const idx=Math.min((d.t*(pts.length-1))|0,pts.length-2);
        const frac=d.t*(pts.length-1)-idx;
        let x=pts[idx].x+(pts[idx+1].x-pts[idx].x)*frac,
            y=pts[idx].y+(pts[idx+1].y-pts[idx].y)*frac,
            z=pts[idx].z+(pts[idx+1].z-pts[idx].z)*frac;
        if(conv>0){ const k=conv*(d.t*.5+.25); x+=(L.core[0]-x)*k; y+=(L.core[1]-y)*k; z+=(L.core[2]-z)*k; }
        arr[i*3]=x; arr[i*3+1]=y; arr[i*3+2]=z;
      }
      pGeo.attributes.position.needsUpdate=true;
    }

    if(coreActive){
      coreGroup.rotation.y=elapsed*.18;
      icoWire.rotation.y=-elapsed*.26;
      rings[0].rotation.y=elapsed*.4; rings[1].rotation.z=elapsed*.3; rings[2].rotation.x+=.006;
      const pulse=.05*Math.sin(elapsed*2.4);
      coreGroup.scale.setScalar(1+pulse);
      MAT.core.emissiveIntensity=.4+Math.abs(Math.sin(elapsed*2))*.25;
    }
    renderer.render(scene,camera);
  }

  function onResize(){
    camera.aspect=W()/H(); camera.updateProjectionMatrix();
    renderer.setSize(W(),H());
  }
  window.addEventListener('resize',onResize);
  window.__s3d={r:renderer,s:scene,c:camera,gl:canvas};   // handle de QA/depuración
  tick();

  // ── Línea de tiempo compacta (~7s, GSAP) ──
  gsap.to(ground.material,{opacity:.95,duration:.9,ease:'power2.out'});
  NODES.forEach((n,i)=>{
    gsap.to(n.group.scale,{x:1,y:1,z:1,duration:.85,delay:.12+i*.09,ease:'elastic.out(1,.75)'});
  });
  junctions.forEach((j,i)=>{
    gsap.to(j.scale,{x:1,y:1,z:1,duration:.4,delay:.3+i*.08,ease:'back.out(2.5)'});
  });
  gsap.delayedCall(.7,()=>{
    camFollow=true;
    gsap.to({t:0},{t:1,duration:2.8,ease:'power1.inOut',onUpdate:function(){camT=this.targets()[0].t;}});
    connections.forEach(({line,mat},i)=>{
      line.visible=true;
      gsap.to(mat,{opacity:.5,duration:.5,delay:i*.04,ease:'power1.out'});
    });
  });
  gsap.delayedCall(1.2,()=>{
    ptSystem.visible=true;
    gsap.to(pMat,{opacity:.9,duration:.9,ease:'power2.out'});
  });
  gsap.delayedCall(3.4,()=>{                              // ensamblaje: todo converge
    assembling=true; camFollow=false;
    gsap.to(camera.position,{x:L.pull[0],y:L.pull[1],z:L.pull[2],duration:1.7,ease:'power3.inOut'});
    NODES.forEach((n,i)=>{
      gsap.to(n.group.position,{x:n.fin.x,y:n.fin.y,z:n.fin.z,duration:1.3,delay:i*.05,ease:'power4.inOut'});
      gsap.to(n.group.rotation,{y:0,duration:1.1,delay:i*.05,ease:'power3.out'});
    });
    junctions.forEach((j,i)=>{
      const f=NODES[i].fin;
      gsap.to(j.position,{x:f.x,y:1.4,z:f.z,duration:1.2,delay:i*.04,ease:'power4.inOut'});
    });
    connections.forEach(({mat})=>gsap.to(mat,{opacity:.22,duration:1,ease:'power2.out'}));
  });
  gsap.delayedCall(4.5,()=>{                              // núcleo IA se enciende
    coreActive=true;
    gsap.to(MAT.core,{opacity:1,emissiveIntensity:.4,duration:1.3,ease:'power2.out'});
    gsap.to(icoMat,{opacity:.18,duration:1.5,ease:'power2.out'});
    rings.forEach((r,i)=>gsap.to(r.material,{opacity:.7-i*.15,duration:1.1,delay:i*.12,ease:'power2.out'}));
    gsap.to(camera.position,{x:L.push[0],y:L.push[1],z:L.push[2],duration:2.0,delay:.2,ease:'power3.inOut'});
    connections.forEach(({mat})=>gsap.to(mat,{opacity:.07,duration:1.6,delay:.8,ease:'power2.in'}));
    gsap.to(pMat,{opacity:.32,duration:1.6,delay:.8,ease:'power2.in'});
    junctions.forEach(j=>gsap.to(j.scale,{x:0,y:0,z:0,duration:.9,delay:.6,ease:'power2.in'}));
  });
  gsap.delayedCall(5.7,()=>{                              // marca JNUS
    const rev=document.getElementById('sp-reveal'); if(rev) rev.classList.add('show');
  });
  gsap.delayedCall(7.0,()=>{ splashAnimDone=true; maybeHideSplash(); });
  return true;
}

// Intro liviana (Trona-style): sin Three.js/GSAP. Rápida (~2s) y saltable al tocar.
(function startSplashLite(){
  const sp=document.getElementById('splash'), rev=document.getElementById('sp-reveal');
  if(rev) setTimeout(()=>rev.classList.add('show'), 260);
  let done=false;
  const finish=()=>{ if(done) return; done=true; splashAnimDone=true; maybeHideSplash(); };
  const t=setTimeout(finish, 5000);   // intro más larga (~5s); saltable al tocar
  if(sp) sp.addEventListener('pointerdown',()=>{ clearTimeout(t); finish(); }, {once:true});
})();

// Halo dorado del input de bienvenida sigue al puntero (sign-in animado)
(function(){
  const g=document.getElementById('wc-glow'); if(!g) return;
  g.addEventListener('pointermove',e=>{
    const r=g.getBoundingClientRect();
    g.style.setProperty('--mx',((e.clientX-r.left)/r.width*100)+'%');
    g.style.setProperty('--my',((e.clientY-r.top)/r.height*100)+'%');
  });
})();

function maybeHideSplash(){
  if(!(splashAnimDone && appInitDone)) return;
  const el=document.getElementById('splash'); if(!el){ gateThenWelcome(); return; }
  if(el.dataset.hiding) return; el.dataset.hiding='1';
  el.classList.add('hide'); gateThenWelcome(); setTimeout(()=>el.remove(),750);
}
function hideSplash(){ appInitDone=true; maybeHideSplash(); }

// ── init ──
async function init(){
  await loadOptions();
  try{const h=await (await fetch(API+'/api/health')).json();document.getElementById('status').textContent=h.ok?'IA lista':'Sin conexión';}
  catch{document.getElementById('status').textContent='Sin conexión';}
  loadAdminPanel();
  injectDoodles();
  hideSplash();
}
init();
// Failsafe: nunca dejar el splash bloqueado (3D dura ~7s)
setTimeout(()=>{ splashAnimDone=true; appInitDone=true; maybeHideSplash(); }, 9000);

// ═══ SERVICES CAROUSEL ═══
(function(){
  const track=document.getElementById('srvTrack');
  const dotsC=document.getElementById('srvDots');
  const bar=document.getElementById('srvBar');
  const counter=document.getElementById('srv-counter');
  if(!track||!dotsC) return;
  const slides=track.querySelectorAll('.srv-slide');
  const total=slides.length;
  let cur=0, autoTimer, progTimer, progW=0;
  const INTERVAL=4000; // 4s per slide
  // Build dots
  for(let i=0;i<total;i++){
    const d=document.createElement('i');
    d.addEventListener('click',()=>goSlide(i));
    dotsC.appendChild(d);
  }
  function goSlide(n){
    cur=((n%total)+total)%total;
    track.style.transform='translateX(-'+cur*100+'%)';
    dotsC.querySelectorAll('i').forEach((d,i)=>d.classList.toggle('on',i===cur));
    if(counter) counter.textContent=(cur+1)+' / '+total;
    resetProgress();
  }
  function next(){ goSlide(cur+1); }
  function resetProgress(){
    progW=0; if(bar) bar.style.width='0%';
    clearInterval(progTimer); clearTimeout(autoTimer);
    progTimer=setInterval(()=>{ progW+=2; if(bar) bar.style.width=Math.min(progW,100)+'%'; },INTERVAL/50);
    autoTimer=setTimeout(next,INTERVAL);
  }
  // Touch/swipe support
  let sx=0,sy=0,dx=0,swiping=false;
  track.addEventListener('touchstart',e=>{ sx=e.touches[0].clientX; sy=e.touches[0].clientY; swiping=true; clearTimeout(autoTimer); clearInterval(progTimer); },{passive:true});
  track.addEventListener('touchmove',e=>{ if(!swiping) return; dx=e.touches[0].clientX-sx; },{passive:true});
  track.addEventListener('touchend',()=>{
    if(!swiping) return; swiping=false;
    if(Math.abs(dx)>40){ dx<0? goSlide(cur+1) : goSlide(cur-1); } else { resetProgress(); }
    dx=0;
  });
  // Pause on hover (desktop)
  const carousel=document.getElementById('srvCarousel');
  carousel.addEventListener('mouseenter',()=>{ clearTimeout(autoTimer); clearInterval(progTimer); });
  carousel.addEventListener('mouseleave',resetProgress);
  goSlide(0);
})();
