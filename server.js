require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── BASE DE DATOS EN JSON ────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "microbot-data.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = { alumnos: [], interacciones: [], sesiones: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { alumnos: [], interacciones: [], sesiones: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nowISO() {
  return new Date().toISOString();
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres MicroBot, tutor experto en microbiología de salud, microbiología ambiental, histopatología y bacteriología. Tu método de enseñanza es SOCRÁTICO con retroalimentación inmediata.

== FLUJO OBLIGATORIO ==

PASO 1 — Cuando el alumno sube una imagen o describe lo que ve en una lámina:
- NUNCA reveles la respuesta de inmediato.
- Analiza internamente la imagen/descripción.
- Responde SOLO con el tag [ASK] y una pregunta directa: "¿Qué microorganismo (o tejido) crees que estás viendo? Describe lo que observas."

PASO 2 — Cuando el alumno da su hipótesis:
- Evalúa si es CORRECTA, PARCIALMENTE CORRECTA o INCORRECTA.

Si CORRECTA:
Responde con [OK] y sigue este formato exacto:
🎉 ¡Excelente! Eso es exactamente correcto.
🔬 ORGANISMO / TEJIDO: [nombre científico completo]
📋 CARACTERÍSTICAS CLAVE: [morfología, tinción, hallazgos microscópicos]
🏥 RELEVANCIA: [clínica o ambiental según el modo]
💡 TRUCO DE IDENTIFICACIÓN: [clave diagnóstica para recordar]

Si PARCIALMENTE CORRECTA:
Responde con [PARTIAL] y el mismo formato pero empezando con "¡Vas por buen camino!" y señala qué faltó.

Si INCORRECTA o si el alumno dice "no sé" / "no entiendo" / "ayuda":
Responde con [WRONG] y sigue este formato exacto:
😊 No te preocupes, es un error común. La respuesta correcta es: [nombre]
🔬 ORGANISMO / TEJIDO: [nombre]
📋 CARACTERÍSTICAS CLAVE: [descripción]
🏥 RELEVANCIA: [importancia]
💡 TRUCO DE IDENTIFICACIÓN: [clave]
Y SIEMPRE añade al final:
[VIDEO: Título del video relevante | URL: https://www.youtube.com/results?search_query=...]
[PAPER: Título del paper relevante | FUENTE: PubMed | URL: https://pubmed.ncbi.nlm.nih.gov/?term=...]

== ESPECIALIDADES ==
- BACTERIOLOGÍA: Gram +/-, morfología, esporas, cápsulas, flagelos, tinción Ziehl-Neelsen, BAAR
- HISTOPATOLOGÍA: tejidos, alteraciones celulares, patrones de necrosis, inflamación, neoplasias
- MICROBIOLOGÍA AMBIENTAL: coliformes, NMP, biopelículas, hongos del suelo, calidad del agua
- MICROBIOLOGÍA DE SALUD: patógenos, diagnóstico diferencial, relevancia clínica

== REGLAS ==
- Responde siempre en español.
- El tag [ASK], [OK], [PARTIAL] o [WRONG] SIEMPRE va al inicio de la respuesta.
- Para consultas generales sin imagen, responde directamente sin pedir hipótesis.
- Los [VIDEO:] y [PAPER:] solo se incluyen en respuestas [WRONG] o cuando el alumno pide recursos.
- Sé siempre alentador, nunca condescendiente.`;

// ─── REGISTRO DE ALUMNO ───────────────────────────────────────────────────────
app.post("/api/registro", (req, res) => {
  try {
    const { nombre, codigo, curso } = req.body;
    if (!nombre || !codigo)
      return res.status(400).json({ error: "Nombre y código son requeridos" });

    const db = loadDB();
    let alumno = db.alumnos.find(a => a.codigo === codigo.trim().toUpperCase());

    if (!alumno) {
      alumno = {
        id: Date.now(),
        nombre: nombre.trim(),
        codigo: codigo.trim().toUpperCase(),
        curso: curso || "",
        creado_en: nowISO()
      };
      db.alumnos.push(alumno);
    } else {
      alumno.nombre = nombre.trim();
      alumno.curso  = curso || alumno.curso;
    }

    const sesion = {
      id: Date.now() + 1,
      alumno_id: alumno.id,
      alumno_codigo: alumno.codigo,
      iniciada_en: nowISO(),
      finalizada_en: null,
      total_msgs: 0
    };
    db.sesiones.push(sesion);
    saveDB(db);

    res.json({ ok: true, alumno, sesionId: sesion.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar alumno" });
  }
});

app.post("/api/cerrar-sesion", (req, res) => {
  try {
    const { sesionId, totalMsgs } = req.body;
    if (sesionId) {
      const db = loadDB();
      const s  = db.sesiones.find(s => s.id === sesionId);
      if (s) { s.finalizada_en = nowISO(); s.total_msgs = totalMsgs || 0; }
      saveDB(db);
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
app.post("/api/chat", (req, res) => {
  const { messages, alumno, sesionId, modo, mensajeUsuario } = req.body;
  if (!messages) return res.status(400).json({ error: "Mensajes requeridos" });

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    }),
  })
    .then(r => r.json())
    .then(data => {
      const reply = data.content?.[0]?.text || "";

      let resultado = "general";
      if      (reply.startsWith("[OK]"))      resultado = "ok";
      else if (reply.startsWith("[WRONG]"))   resultado = "wrong";
      else if (reply.startsWith("[PARTIAL]")) resultado = "partial";
      else if (reply.startsWith("[ASK]"))     resultado = "ask";

      // Guardar interacción
      if (alumno?.id) {
        try {
          const db = loadDB();
          db.interacciones.push({
            id: Date.now(),
            alumno_id:       alumno.id,
            alumno_nombre:   alumno.nombre,
            alumno_codigo:   alumno.codigo,
            modo:            modo || "general",
            mensaje_usuario: (mensajeUsuario || "").substring(0, 300),
            respuesta_bot:   reply.substring(0, 500),
            resultado,
            timestamp: nowISO()
          });
          saveDB(db);
        } catch (e) { console.error("Error guardando interacción:", e); }
      }

      res.json({ content: reply, resultado });
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: "Error en API de Anthropic" });
    });
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";

app.post("/api/dashboard/auth", (req, res) => {
  if (req.body.password === DASH_PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

app.get("/api/dashboard/stats", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS)
    return res.status(401).json({ error: "No autorizado" });

  const db = loadDB();
  const hoy = new Date().toISOString().slice(0, 10);

  // Totales
  const totales = {
    alumnos:       db.alumnos.length,
    sesiones:      db.sesiones.length,
    interacciones: db.interacciones.length,
    hoy:           db.interacciones.filter(i => i.timestamp?.startsWith(hoy)).length
  };

  // Distribución de resultados
  const resMap = {};
  db.interacciones.forEach(i => {
    if (!["ok","wrong","partial"].includes(i.resultado)) return;
    resMap[i.resultado] = (resMap[i.resultado] || 0) + 1;
  });
  const resultados = Object.entries(resMap).map(([resultado, n]) => ({ resultado, n }));

  // Distribución de modos
  const modeMap = {};
  db.interacciones.forEach(i => {
    modeMap[i.modo] = (modeMap[i.modo] || 0) + 1;
  });
  const modos = Object.entries(modeMap)
    .map(([modo, n]) => ({ modo, n }))
    .sort((a, b) => b.n - a.n);

  // Actividad por día (últimos 30 días)
  const diaMap = {};
  const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  db.interacciones
    .filter(i => i.timestamp >= hace30)
    .forEach(i => {
      const dia = i.timestamp?.slice(0, 10);
      if (dia) diaMap[dia] = (diaMap[dia] || 0) + 1;
    });
  const actividadPorDia = Object.entries(diaMap)
    .map(([dia, n]) => ({ dia, n }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  // Ranking de alumnos
  const rankingAlumnos = db.alumnos.map(a => {
    const inters = db.interacciones.filter(i => i.alumno_id === a.id);
    const correctas  = inters.filter(i => i.resultado === "ok").length;
    const incorrectas = inters.filter(i => i.resultado === "wrong").length;
    const parciales  = inters.filter(i => i.resultado === "partial").length;
    const ultima = inters.length ? inters[inters.length - 1].timestamp : null;
    return {
      nombre: a.nombre, codigo: a.codigo, curso: a.curso, creado_en: a.creado_en,
      total_interacciones: inters.length,
      correctas, incorrectas, parciales,
      ultima_actividad: ultima
    };
  }).sort((a, b) => b.total_interacciones - a.total_interacciones);

  // Últimas 50 interacciones
  const ultimasInteracciones = db.interacciones.slice(-50).reverse().map(i => ({
    alumno_nombre: i.alumno_nombre,
    alumno_codigo: i.alumno_codigo,
    modo: i.modo,
    resultado: i.resultado,
    timestamp: i.timestamp
  }));

  res.json({ totales, resultados, modos, actividadPorDia, rankingAlumnos, ultimasInteracciones });
});

app.get("/api/dashboard/export", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS)
    return res.status(401).json({ error: "No autorizado" });

  const db = loadDB();
  const header = "Nombre,Código,Curso,Modo,Resultado,Mensaje,Fecha";
  const rows = db.interacciones.map(i => {
    const a = db.alumnos.find(a => a.id === i.alumno_id) || {};
    return [
      a.nombre || i.alumno_nombre || "",
      a.codigo  || i.alumno_codigo || "",
      a.curso   || "",
      i.modo    || "",
      i.resultado || "",
      `"${(i.mensaje_usuario || "").replace(/"/g, "'")}"`,
      i.timestamp || ""
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=microbot-datos.csv");
  res.send(csv);
});

// ─── RUTAS ────────────────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/health", (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() }));
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🔬 MicroBot corriendo en http://localhost:${PORT}`));
