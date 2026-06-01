# 🚀 Desplegar SIAC · JANUS AI en la web (24/7)

El proyecto está listo para producción. Ya no depende de tu terminal ni de tu PC.

## Opción A — Render.com (Recomendado, gratis)

1. **Crea cuenta** en https://render.com (entra con GitHub).
2. Sube el proyecto a un repo de GitHub:
   ```bash
   cd C:\Users\USER\Downloads\JNUS
   git init
   git add .
   git commit -m "JANUS AI initial"
   gh repo create siac-janus-ai --public --source=. --push
   ```
3. En Render → **New +** → **Blueprint** → selecciona tu repo. Render detectará `render.yaml` automáticamente.
4. En ~3 minutos tendrás una URL pública estilo `https://janus-siac.onrender.com`.

**Configurar dominio `janus.siac.ai`:**
- Compra `siac.ai` (Namecheap, GoDaddy, Cloudflare…).
- En Render → tu servicio → **Settings → Custom Domain** → añade `janus.siac.ai`.
- En tu DNS añade un registro `CNAME`:  
  `janus  CNAME  janus-siac.onrender.com`
- HTTPS se emite automáticamente (Let's Encrypt).

## Opción B — Railway.app

1. https://railway.app → **New project** → **Deploy from GitHub repo**.
2. Railway lee `railway.toml`. Listo.
3. **Settings → Networking → Custom Domain** → `janus.siac.ai` + CNAME.

## Opción C — Fly.io

```bash
iwr https://fly.io/install.ps1 -useb | iex
fly auth signup
fly launch          # detecta Dockerfile
fly deploy
fly certs add janus.siac.ai
```

## Opción D — Docker (cualquier VPS, Coolify, Dokploy…)

```bash
docker build -t janus-siac .
docker run -d -p 80:8000 --name janus --restart unless-stopped janus-siac
```

## Opción E — Hugging Face Spaces (gratis, sin tarjeta)

1. https://huggingface.co/new-space → **SDK: Docker**.
2. Sube los archivos del proyecto (drag&drop o git).
3. URL pública: `https://huggingface.co/spaces/TU_USER/janus-siac`.
4. Para dominio propio necesitas plan Pro de HF Spaces.

---

## Verificar el deploy

Una vez online, abre:
- `https://TU_DOMINIO/` → la UI completa
- `https://TU_DOMINIO/api/health` → debe responder `{"ok": true, ...}`

## Variables de entorno (opcionales)

| Variable | Default | Uso |
|---|---|---|
| `PORT` | 5000 | Puerto donde corre Flask (lo set Render/Railway/Fly automáticamente) |
| `FLASK_ENV` | `development` | Pon `production` para desactivar debug |
| `HOST` | `0.0.0.0` | Bind address |

## Nota sobre persistencia

El backend usa `STATE` global en memoria (single-user). En la nube cada despliegue arranca con estado vacío y, si reciben varios usuarios a la vez, comparten estado. Para producción multi-usuario:
- Usar `Flask-Session` con Redis (`pip install flask-session redis`), o
- Persistir el modelo entrenado a disco con `joblib.dump(model, 'model.pkl')` y cargar por sesión.

Para uso personal/demo está perfecto tal cual.

---

## 🆕 v3 · App consumidor + APK Android

### Qué cambió
- **`/app`** ahora es el **producto FinTech para el usuario final** (flujo guiado, sin subir datos ni entrenar). El antiguo dashboard de ciencia de datos quedó en **`/lab`**.
- Los **modelos se entrenan y persisten solos** al arrancar (`engine.py` → `models/janus_bundle.pkl`). En la nube, el primer arranque los genera en segundos; el usuario **solo hace inferencia**. No hay que subir CSV ni entrenar nada.
- Endpoints nuevos: `GET /api/options`, `POST /api/score` (devuelve probabilidad, riesgo, factores +/− y recomendaciones en español).

### Deploy (idéntico, un clic en Render)
El `render.yaml` no cambia. Tras desplegar:
- Usuario final → `https://janus.siac.ai/app`
- Analista → `https://janus.siac.ai/lab`
- Health → `https://janus.siac.ai/api/health`

### 📦 Empaquetar como APK / iOS (Capacitor)
La PWA ya es instalable ("Añadir a pantalla de inicio"). Para una app nativa en tiendas:

```bash
cd C:\Users\USER\Downloads\JNUS
npm install
npx cap init        # ya hay capacitor.config.json (apunta a https://janus.siac.ai/app)
npm run cap:add:android
npm run cap:sync
npm run cap:open:android   # abre Android Studio → Build > Generate Signed APK
```

`capacitor.config.json` carga la web en vivo (`server.url`), así la app móvil siempre
refleja el backend desplegado y se mantiene sincronizada con la web sin recompilar.
Requisitos: Node.js + Android Studio (para el APK) / Xcode (para iOS).


---

## 🏛️ v4 · Arquitectura de producción Admin + App (un solo backend)

Una sola app Flask sirve dos frontends desde el mismo dominio:

| Ruta | Acceso | Para qué |
|------|--------|----------|
| `/app` | **Público** | App consumidor: evaluación crediticia (solo inferencia) |
| `/admin` | **Privado (login)** | Subir datasets · entrenar · comparar métricas · publicar modelo |
| `/` | — | Redirige a `/app` |

### Flujo de datos (sin redeploy, sin código)
```
Admin sube CSV/Excel/SAV  →  /api/admin/retrain
   → entrena 4 modelos (train/test 80/20)
   → elige el mejor por AUC
   → guarda models/janus_bundle.pkl
   → ENGINE recarga el modelo en memoria (hot-reload)
   → /app ya usa el nuevo modelo automáticamente
```

### Credenciales admin (configurar en producción)
Por defecto (solo dev): usuario `admin` / contraseña `jnus2026`.
**En Render**, configura en el panel (Environment) estas variables:
- `JNUS_ADMIN_USER` — usuario admin
- `JNUS_ADMIN_PASSWORD` — contraseña admin
- `JNUS_SECRET_KEY` — secreto aleatorio para firmar sesiones (ej. `openssl rand -hex 32`)

### Acceso en producción
- App pública: `https://tu-dominio.com/app`
- Admin: `https://tu-dominio.com/admin` (pide login)

### Notas de producción
- **1 worker gunicorn** (ver `render.yaml`): el hot-reload del modelo en memoria queda
  consistente. El bundle en disco (`janus_bundle.pkl`) es la fuente de verdad; si escalas a
  N workers, cada uno recarga el bundle del disco en su próximo arranque/health.
- El bundle **no se commitea** (`.gitignore` → `models/*.pkl`): se genera en el primer
  arranque y se actualiza cuando el admin reentrena.
- Columnas requeridas en el dataset del admin: `edad, ingresos_mensuales, cargas_familiares,
  creditos_activos, sexo, educacion, historial_pagos, institucion, tipo_credito,
  situacion_laboral, aprobado`. Si faltan, el reentreno se rechaza con mensaje claro.
- Formatos soportados: CSV, Excel (.xlsx/.xls), SPSS (.sav vía `pyreadstat`).
