import re

with open(r'templates\janus_app.html', 'r', encoding='utf-8') as f:
    content = f.read()

def replace_doodle(label, filename):
    global content
    pattern = r'<div class=\"srv-img\"><svg class=\"doodle\"[^>]*aria-label=\"' + label + r'\"[^>]*>.*?</svg></div>'
    replacement = f'<div class=\"srv-img\"><img src=\"/static/{filename}.png\" alt=\"{label}\"></div>'
    content, count = re.subn(pattern, replacement, content, flags=re.DOTALL)
    print(f'Replaced {label}: {count} times')

replace_doodle('Crédito de consumo', 'consumo')
replace_doodle('Crédito inmobiliario', 'inmobiliario')
replace_doodle('Microcrédito', 'microcredito')
replace_doodle('Crédito vehicular', 'vehicular')
replace_doodle('Crédito para negocio', 'negocio')
replace_doodle('Crédito educativo', 'educativo')

with open(r'templates\janus_app.html', 'w', encoding='utf-8') as f:
    f.write(content)
