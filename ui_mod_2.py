import re

with open(r'templates\janus_app.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace re-doodle with sin_historial.png
re_doodle = r'<div id="re-doodle" style="margin-bottom:6px"></div>'
replacement_re = r'<img src="/static/sin_historial.png" alt="Sin resultados" style="max-width:180px; margin-bottom:12px; mix-blend-mode: multiply;">'
content = content.replace(re_doodle, replacement_re)

# 2. Add mix-blend-mode to seguridad.png
seg_img = r'<img src="/static/seguridad.png" alt="Seguridad" style="margin-bottom:18px;max-width:140px">'
seg_replacement = r'<img src="/static/seguridad.png" alt="Seguridad" style="margin-bottom:18px;max-width:140px; mix-blend-mode: multiply;">'
content = content.replace(seg_img, seg_replacement)

with open(r'templates\janus_app.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('Replacements for mix-blend-mode and empty state done.')
