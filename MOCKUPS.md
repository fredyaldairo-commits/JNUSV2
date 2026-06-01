# 📐 JANUS AI · Mockups de pantallas (storyboard)

Wireframes de referencia de cada pantalla del producto consumidor. La implementación
real está en `templates/janus_app.html` (servida en `/app`).

Paleta: Navy `#0F172A` · Slate `#1E293B` · Fondo `#F8FAFC` · Oro `#D4AF37` · Azul `#2563EB`
· Éxito `#22C55E` · Peligro `#EF4444`. Tipografías: Sora (display) + Plus Jakarta Sans (texto).

---

## 1 · Bienvenida (Tab Inicio)
```
┌─────────────────────────────┐
│ [logo] JANUS AI      ●IA lista│  ← top bar (blanco, blur)
├─────────────────────────────┤
│ ╭─────── HERO navy ───────╮ │
│ │ [ JANUS LOGO HERE ]      │ │  ← <JanusLogoPlaceholder/>
│ │ Descubre tu APROBACIÓN   │ │
│ │ crediticia con IA        │ │
│ │ (ilustración growth SVG) │ │
│ │ [ 🚀 Comenzar evaluación]│ │  ← CTA oro
│ ╰──────────────────────────╯ │
│ ¿Cómo funciona?              │
│ [📝 1 · Cuéntanos sobre ti ] │
│ [🧠 2 · La IA analiza      ] │
│ [📊 3 · Recibe tu resultado] │
│ [🔒 aviso de privacidad    ] │
├──🏠──📊──🧠──📜──⚙️──────────┤  ← bottom nav
└─────────────────────────────┘
```

## 2 · Tipo de crédito (Wizard 1/4)
```
┌─────────────────────────────┐
│ ←  ▓▓▓▓▓░░░░░░░░░░░░    1/4  │  ← progreso
│ ¿Qué crédito deseas          │
│ solicitar?                   │
│ ┌────────┐ ┌────────┐        │
│ │🏠 Hipo │ │🚗 Vehíc│        │  ← cards animadas
│ ├────────┤ ├────────┤        │     (tap → check oro)
│ │💳 Perso│ │🏪 Micro│        │
│ ├────────┤ ├────────┤        │
│ │💼 Produ│ │📈 Empre│        │
│ └────────┘ └────────┘        │
│ [        Continuar        ]  │
└─────────────────────────────┘
```

## 3 · Situación laboral (Wizard 2/4)
```
┌─────────────────────────────┐
│ ←  ▓▓▓▓▓▓▓▓▓▓░░░░░░    2/4   │
│ ¿Cuál es tu situación        │
│ laboral?                     │
│ 👔 Emp. Público  🏢 Privado  │  ← grid de cards
│ 🛒 Emprendedor   🏪 Negocio  │
│ 🧰 Informal      ❌ Desempleo│
│ [        Continuar        ]  │
└─────────────────────────────┘
```

## 4 · Información financiera (Wizard 3/4)
```
┌─────────────────────────────┐
│ ←  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░    3/4   │
│ Tu información financiera     │
│ 🎂 Edad            40 años   │
│   ●━━━━━━━━━━━━━━━━━━○        │  ← slider
│ 💵 Ingresos        $800      │
│   ●━━━━━━━○━━━━━━━━━━         │
│ 👨‍👩‍👧 Cargas          1         │
│ 💳 Créditos activos 1        │
│ 👤 Sexo [Masculino|Femenino] │  ← segmented
│ 🎓 Educación (chips)         │
│ 📅 Historial pagos (chips)   │
│ 🏦 Institución (chips)       │
│ [   🚀 Analizar mi perfil ]  │
└─────────────────────────────┘
```
(Wizard 4/4 = pantalla de revisión/confirmación de datos.)

## 5 · Análisis de IA (full-screen)
```
┌─────────────────────────────┐
│         (fondo navy)         │
│           ◉ orbe             │  ← ondas + núcleo oro 🧠
│      Analizando tu perfil…   │
│   Inteligencia Artificial    │
│  ┌─────────────────────────┐ │
│  │📈 Regresión Logística  ✓│ │  ← se encienden
│  │🌲 Random Forest        ⟳│ │     secuencialmente
│  │🚀 XGBoost              ░│ │
│  │🤖 Red Neuronal         ░│ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

## 6 · Resultado (Tab Resultado)
```
┌─────────────────────────────┐
│ ╭──── gauge navy ────────╮  │
│ │        ◜ 82% ◝          │  │  ← arco color según riesgo
│ │      Probabilidad       │  │
│ │     🟢 Excelente        │  │
│ │  "¡Felicidades!..."     │  │
│ ╰─────────────────────────╯  │
│ 📈 Factores a tu favor       │
│   ▲ Tus ingresos    ▓▓▓▓▓░  │
│   ▲ Historial: Excelente ▓▓ │
│ 📉 Factores a mejorar        │
│   ▼ Créditos activos ▓▓▓    │
│ 💡 Recomendaciones           │
│   [💳 Reduce créditos +12%] │
│   [📅 Paga al día     +8% ] │
│ 🤖 Análisis por modelo       │
│   [Logística 84%][RF 95%]   │
│   [XGBoost 99%][Neural 89%] │
│ [    🔄 Nueva evaluación   ] │
└─────────────────────────────┘
```

## 7 · Aprende / 8 · Historial / 9 · Perfil
- **Aprende**: tarjetas educativas (qué es la probabilidad, los 4 modelos, 5 claves, XAI).
- **Historial**: lista con anillo de % por evaluación (localStorage, hasta 20).
- **Perfil**: avatar, instalar app, borrar historial, "Modo analista" (→ `/lab`).

---

### Logo oficial
El componente `<JanusLogoPlaceholder/>` está en el top bar y en el hero (`#JanusLogoPlaceholder`).
Para insertar el logo definitivo: reemplazar el `<svg>` dentro de `.janus-logo .mark` por
`<img src="/static/logo.png">` — sin tocar el resto del layout.
