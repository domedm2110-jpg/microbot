# 🔬 MicroBot v2 — Laboratorio Virtual con Analítica

Chatbot educativo socrático para microbiología, histopatología y bacteriología.
Incluye sistema de registro de alumnos y dashboard de analítica para docentes.

---

## 📁 Estructura del proyecto

```
microbot/
├── server.js              ← Backend Node.js (API + base de datos)
├── package.json
├── .env.example           ← Plantilla de variables de entorno
├── .gitignore
├── public/
│   ├── index.html         ← Chat con login de alumno
│   └── dashboard.html     ← Panel de analítica del docente
└── README.md
```

---

## 🚀 Deploy en Railway (recomendado — gratis)

### Paso 1 — Subir a GitHub
1. Crea un repositorio en [github.com](https://github.com)
2. Sube todos los archivos (**sin** el `.env`)
3. El `.gitignore` ya excluye `.env` y la base de datos

### Paso 2 — Crear proyecto en Railway
1. Ve a [railway.app](https://railway.app) → "New Project"
2. "Deploy from GitHub repo" → elige tu repositorio
3. Railway detecta automáticamente que es Node.js

### Paso 3 — Variables de entorno en Railway
En tu proyecto → pestaña **Variables** → agregar:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-tu-key-aquí` |
| `DASHBOARD_PASSWORD` | `una-contraseña-segura` |
| `DB_PATH` | `/data/microbot.db` |

### Paso 4 — Agregar volumen para la base de datos
Para que los datos persistan entre deploys:
1. En Railway → pestaña **Settings** → **Volumes**
2. Agregar volumen → Mount Path: `/data`
3. Esto asegura que `microbot.db` no se pierda

### Paso 5 — Obtener la URL pública
1. Settings → Networking → "Generate Domain"
2. URL ejemplo: `microbot-production.up.railway.app`
3. Comparte esta URL con tus alumnos

---

## 🌐 Deploy en Render (alternativa gratuita)

1. [render.com](https://render.com) → "New Web Service"
2. Conecta tu repo de GitHub
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Agrega las variables de entorno igual que Railway
6. Para persistencia de BD: crear un "Disk" en Render con mount path `/data`

---

## 💻 Ejecutar local (para probar)

```bash
# 1. Instalar dependencias
npm install

# 2. Crear .env
cp .env.example .env
# Edita .env con tu API key

# 3. Iniciar
npm start
# → http://localhost:3000        (chat de alumnos)
# → http://localhost:3000/dashboard  (panel docente)
```

---

## 📊 Acceder al Dashboard

URL: `tu-dominio.com/dashboard`

**Contraseña:** la que pusiste en `DASHBOARD_PASSWORD` (por defecto: `profesor123`)

### ¿Qué muestra el dashboard?

| Métrica | Descripción |
|---|---|
| Alumnos registrados | Total de alumnos que iniciaron sesión |
| Interacciones totales | Todas las preguntas y respuestas |
| Tasa de acierto global | % de respuestas correctas vs evaluadas |
| Actividad hoy | Interacciones del día actual |
| Gráfico de resultados | Distribución correcto/incorrecto/parcial |
| Uso por área | Qué temas consultan más (Gram, Histo, etc.) |
| Actividad 30 días | Tendencia de uso |
| Tabla por alumno | Stats individuales con barra de progreso |
| Actividad reciente | Feed en tiempo real de las últimas 50 acciones |
| Exportar CSV | Descarga todos los datos para análisis en Excel |

### ¿Cómo usar los datos para evaluar impacto?
1. **Exporta el CSV** después de cada práctica
2. Compara tasa de acierto del primer día vs último
3. Alumnos con < 40% acierto → intervención personalizada
4. Temas con más errores → reforzar en clase

---

## 🔑 Obtener API Key de Anthropic

1. [console.anthropic.com](https://console.anthropic.com) → crear cuenta
2. API Keys → "Create Key"
3. Copia la key (solo se muestra una vez)

### 💰 Costo estimado
- Claude Sonnet: ~$3/1M tokens entrada, $15/1M tokens salida
- Sesión típica alumno: ~2,000 tokens ≈ $0.006 USD
- 50 alumnos × 20 sesiones/mes = ~$6 USD/mes

---

## ⚙️ Personalizar los cursos

Edita en `public/index.html` el `<select id="l-curso">` para agregar tus secciones reales.

Para cambiar el comportamiento del bot, edita `SYSTEM_PROMPT` en `server.js`.
