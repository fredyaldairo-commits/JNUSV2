import re

with open(r'templates\janus_app.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace lock doodle
lock_doodle = r'<svg class=\"doodle\" viewBox=\"0 0 200 200\" role=\"img\" aria-label=\"Seguridad\" style=\"margin-bottom:18px;max-width:140px\">\s*<path [^>]*>\s*<path [^>]*>\s*<rect [^>]*>\s*<path [^>]*>\s*<circle [^>]*><path [^>]*>\s*<path [^>]*>\s*<circle [^>]*><path [^>]*>\s*</svg>'
content = re.sub(lock_doodle, '<img src=\"/static/seguridad.png\" alt=\"Seguridad\" style=\"margin-bottom:18px;max-width:140px\">', content)

# 2. Add an-logo-container in analysis view
analysis_h2 = r'<h2>Analizando tu perfil…</h2>'
logo_html = '<div id=\"an-logo-container\" style=\"display:none; flex-direction:column; align-items:center; margin-bottom:20px;\"></div>\n  <h2>Analizando tu perfil…</h2>'
content = content.replace(analysis_h2, logo_html)

# 3. Add CSS for coop-logo-lg
css_block = '''@keyframes pulseGlow {
  0%, 100% { filter: drop-shadow(0 0 4px var(--coop-color)); transform: scale(1); }
  50% { filter: drop-shadow(0 0 16px var(--coop-color)); transform: scale(1.05); }
}
.coop-logo-lg { width: 80px; height: 80px; border-radius: 16px; background: white; padding: 10px; animation: pulseGlow 1.5s infinite; display: flex; align-items: center; justify-content: center; }
.coop-logo-lg img { width: 100%; height: 100%; object-fit: contain; }
.coop-logo-lg .coop-mono-fb { font-family: var(--fd); font-weight: 800; font-size: 24px; color: var(--coop-color); }
'''
content = content.replace('.analysis{', css_block + '.analysis{')

# 4. Modify runAnalysis to inject the logo
run_analysis_start = r'async function runAnalysis\(\)\{\s*closeWizard\(\);'
run_analysis_replacement = '''async function runAnalysis(){
  closeWizard();
  const logoCont = document.getElementById('an-logo-container');
  if (answers._coop) {
    logoCont.style.display = 'flex';
    logoCont.innerHTML = coopLogoHTML(answers._coop, 'coop-logo-lg');
    logoCont.style.setProperty('--coop-color', answers._coop.color || 'var(--acc-terra)');
  } else {
    logoCont.style.display = 'none';
  }'''
content = re.sub(run_analysis_start, run_analysis_replacement, content)

# 5. Modify empty history DOODLE_HERO
empty_history = r'\<div class=\"empty\"\>\$\{DOODLE_HERO\}'
empty_replacement = r'<div class="empty"><img src="/static/sin_historial.png" alt="Sin historial" style="max-width:180px; margin-bottom:12px; mix-blend-mode: multiply;">'
content = re.sub(empty_history, empty_replacement, content)

with open(r'templates\janus_app.html', 'w', encoding='utf-8') as f:
    f.write(content)
print('Replacements done.')
