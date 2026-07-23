import re
with open('templates/janus_app.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace DOODLE_NEGOCIO with crecimiento.png
situacion_old = r'body.innerHTML=`<div style=\"margin-bottom:12px\">\$\{DOODLE_NEGOCIO\}</div>'
situacion_new = r'body.innerHTML=`<div style=\"margin-bottom:12px\"><img src=\"/static/crecimiento.png\" style=\"max-height:140px; margin:0 auto; display:block\"></div>'
content = re.sub(situacion_old, situacion_new, content)

# 2. Add WhatsApp redirect logic in renderResult
wa_logic = '''const pct=d.percent;
  document.getElementById('r-pct').textContent=pct+'%';
  
  const waCont = document.getElementById('wa-container');
  if (waCont) waCont.remove();
  if (d.percent >= 55 && answers._coop) {
    const waBtn = document.createElement('div');
    waBtn.id = 'wa-container';
    waBtn.style.marginTop = '24px';
    waBtn.innerHTML = `
      <div style="padding:16px; background:rgba(37,211,102,0.1); border-radius:12px; border:1px solid #25D366; text-align:center;">
        <h4 style="margin:0 0 8px; color:#128C7E; font-size:16px;">¡Estás precalificado!</h4>
        <p style="margin:0 0 12px; font-size:14px; color:var(--text-light)">Contacta con un asistente de <b>${answers._coop.name}</b> para continuar con tu crédito.</p>
        <a href="https://wa.me/?text=Hola,%20tengo%20una%20buena%20probabilidad%20para%20un%20crédito%20y%20tengo%20mi%20informe%20en%20PDF." target="_blank" style="display:inline-flex; align-items:center; justify-content:center; gap:8px; background:#25D366; color:white; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:600; width:100%;">
          <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
          Contactar por WhatsApp
        </a>
      </div>
    `;
    const fRow = rc.querySelector('.f-row');
    if(fRow) {
      rc.insertBefore(waBtn, fRow);
    } else {
      rc.appendChild(waBtn);
    }
  }'''
content = content.replace("const pct=d.percent;\n  document.getElementById('r-pct').textContent=pct+'%';", wa_logic)

with open('templates/janus_app.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('UI modified for crecimiento and WhatsApp')
