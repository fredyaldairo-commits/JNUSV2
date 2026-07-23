import re
with open('templates/janus_app.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace win_doodle conditional rendering
old_line = r'if\(wd\) wd\.innerHTML = \(d\.percent>=55\) \? \'<img src=\"/static/win_doodle.png\" alt=\"Aprobado\" style=\"max-width:180px; margin-bottom:12px\">\': \'\';'
new_line = r'if(wd) wd.innerHTML = (d.percent>=55) ? \'<img src="/static/win_doodle.png" alt="Aprobado" style="max-width:180px; margin-bottom:12px">\' : \'<img src="/static/lose_doodle.png" alt="Rechazado" style="max-width:180px; margin-bottom:12px">\';'

content = re.sub(old_line, new_line, content)

with open('templates/janus_app.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('UI modified for lose_doodle')
