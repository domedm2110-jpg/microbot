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
    const empty = { alumnos: [], interacciones: [], sesiones: [], examenes: [], resultados_examen: [], encuestas: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    const d = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!d.examenes)          d.examenes = [];
    if (!d.resultados_examen) d.resultados_examen = [];
    if (!d.encuestas)         d.encuestas = [];
    return d;
  } catch { return { alumnos: [], interacciones: [], sesiones: [], examenes: [], resultados_examen: [], encuestas: [] }; }
}

function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
function nowISO()      { return new Date().toISOString(); }
function makeCode()    { return Math.random().toString(36).substring(2,8).toUpperCase(); }

// ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────
const SYSTEM_NORMAL = `Eres MicroBot / HistoLab, tutor experto en microbiología de salud, microbiología ambiental, histopatología y bacteriología. Tu método de enseñanza es SOCRÁTICO con retroalimentación inmediata.

== REGLA FUNDAMENTAL — CONTEXTO DEL DOCENTE ==
Cuando el alumno indica el origen del tejido u órgano (ej: "es tejido hepático", "es un corte de riñón"), DEBES aceptarlo como dato confirmado. NUNCA lo contradigas. Tu rol es ayudar a identificar las ESTRUCTURAS INTERNAS de ese tejido.

== FLUJO PARA HISTOPATOLOGÍA (modo histo) ==
PASO 1 — Cuando el alumno sube imagen o describe lámina histopatológica:
- NUNCA asumas la tinción. Responde con [ASK]: "¿Qué tinción se utilizó? (H&E, PAS, ZN, Masson, etc.) ¿Y a qué aumento?"
- Si ya indicó la tinción, pasa al Paso 2.

PASO 2 — Con tinción conocida:
- Si indicó el tejido: "¿Qué estructuras identificas en esta lámina de [tejido]?"
- Si no indicó tejido: pregunta qué cree que está viendo.

PASO 3 — Evalúa la hipótesis: [OK], [PARTIAL] o [WRONG]

== FLUJO GENERAL (otros modos) ==
PASO 1 — Imagen/descripción → [ASK]: "¿Qué microorganismo o tejido crees que estás viendo?"
PASO 2 — Evalúa: [OK], [PARTIAL] o [WRONG]

== FORMATOS ==
[OK]: 🎉 ¡Excelente! Eso es exactamente correcto.\n🔬 ESTRUCTURA/ORGANISMO: [nombre]\n📋 CARACTERÍSTICAS CLAVE: [descripción]\n🏥 RELEVANCIA: [importancia]\n💡 TRUCO: [clave diagnóstica]
[PARTIAL]: 🌟 ¡Vas por buen camino! [qué acertó y qué faltó]\n🔬 ESTRUCTURA/ORGANISMO: [nombre]\n📋 CARACTERÍSTICAS: [descripción]\n💡 TRUCO: [clave]
[WRONG]: 😊 No te preocupes. La respuesta correcta es: [nombre]\n🔬 ESTRUCTURA/ORGANISMO: [nombre]\n📋 CARACTERÍSTICAS: [descripción]\n🏥 RELEVANCIA: [importancia]\n💡 TRUCO: [clave]\n[VIDEO: título | URL: https://www.youtube.com/results?search_query=...]\n[PAPER: título | FUENTE: PubMed | URL: https://pubmed.ncbi.nlm.nih.gov/?term=...]

== REGLAS ==
- Responde siempre en español.
- Tag [ASK]/[OK]/[PARTIAL]/[WRONG] SIEMPRE al inicio.
- Consultas generales sin imagen → responde directamente.
- NUNCA contradigas el tejido u órgano indicado.
- Sé alentador, nunca condescendiente.`;

const SYSTEM_EXAMEN = `Eres MicroBot en MODO EXAMEN. Tu comportamiento cambia completamente:

== REGLAS DE EXAMEN ==
1. El alumno debe identificar lo que se le pregunta. NO des pistas, NO sugieras, NO des retroalimentación elaborada.
2. Solo evalúa la respuesta del alumno como CORRECTA, PARCIALMENTE CORRECTA o INCORRECTA.
3. NO incluyas [VIDEO:] ni [PAPER:] — esto es un examen, no una clase.
4. Sé breve y objetivo.

== FORMATO EXAMEN ==
Si CORRECTA → [OK]\n✅ Correcto.
Si PARCIALMENTE CORRECTA → [PARTIAL]\n⚠️ Parcialmente correcto. [máximo 1 línea indicando qué faltó]
Si INCORRECTA → [WRONG]\n❌ Incorrecto.

No des la respuesta correcta cuando sea incorrecta — el alumno debe seguir intentando o el examen termina.

== CONTEXTO HISTOPATOLOGÍA EN EXAMEN ==
- Acepta el tejido indicado como dato confirmado.
- Si no se indicó tinción y es lámina histológica, pregunta solo la tinción (tag [ASK]) antes de evaluar.
- El objetivo es evaluar si el alumno identifica correctamente la estructura o microorganismo.

Responde siempre en español. Sé justo y objetivo.`;

// ─── REGISTRO ────────────────────────────────────────────────────────────────
app.post("/api/registro", (req, res) => {
  try {
    const { nombre, codigo, curso } = req.body;
    if (!nombre || !codigo) return res.status(400).json({ error: "Nombre y código requeridos" });
    const db = loadDB();
    let alumno = db.alumnos.find(a => a.codigo === codigo.trim().toUpperCase());
    if (!alumno) {
      alumno = { id: Date.now(), nombre: nombre.trim(), codigo: codigo.trim().toUpperCase(), curso: curso || "", creado_en: nowISO() };
      db.alumnos.push(alumno);
    } else { alumno.nombre = nombre.trim(); alumno.curso = curso || alumno.curso; }
    const sesion = { id: Date.now()+1, alumno_id: alumno.id, alumno_codigo: alumno.codigo, iniciada_en: nowISO(), finalizada_en: null, total_msgs: 0 };
    db.sesiones.push(sesion);
    saveDB(db);
    res.json({ ok: true, alumno, sesionId: sesion.id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error al registrar" }); }
});

app.post("/api/cerrar-sesion", (req, res) => {
  try {
    const { sesionId, totalMsgs } = req.body;
    if (sesionId) {
      const db = loadDB();
      const s = db.sesiones.find(s => s.id === sesionId);
      if (s) { s.finalizada_en = nowISO(); s.total_msgs = totalMsgs || 0; }
      saveDB(db);
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ─── CHAT NORMAL ──────────────────────────────────────────────────────────────
app.post("/api/chat", (req, res) => {
  const { messages, alumno, sesionId, modo, mensajeUsuario } = req.body;
  if (!messages) return res.status(400).json({ error: "Mensajes requeridos" });

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1024, system: SYSTEM_NORMAL, messages }),
  })
    .then(r => r.json())
    .then(data => {
      const reply = data.content?.[0]?.text || "";
      let resultado = "general";
      if      (reply.startsWith("[OK]"))      resultado = "ok";
      else if (reply.startsWith("[WRONG]"))   resultado = "wrong";
      else if (reply.startsWith("[PARTIAL]")) resultado = "partial";
      else if (reply.startsWith("[ASK]"))     resultado = "ask";
      if (alumno?.id) {
        try {
          const db = loadDB();
          db.interacciones.push({ id: Date.now(), alumno_id: alumno.id, alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo, modo: modo || "general", mensaje_usuario: (mensajeUsuario || "").substring(0,300), respuesta_bot: reply.substring(0,500), resultado, timestamp: nowISO() });
          saveDB(db);
        } catch (e) { console.error(e); }
      }
      res.json({ content: reply, resultado });
    })
    .catch(err => { console.error(err); res.status(500).json({ error: "Error API" }); });
});

// ─── MODO EXAMEN ──────────────────────────────────────────────────────────────

// Crear examen (profesor)
app.post("/api/examen/crear", (req, res) => {
  const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  try {
    const { nombre, descripcion, total_preguntas, modo, curso } = req.body;
    const db = loadDB();
    const examen = {
      id:               Date.now(),
      nombre:           nombre || "Examen",
      descripcion:      descripcion || "",
      codigo:           makeCode(),
      total_preguntas:  total_preguntas || 5,
      modo:             modo || "histo",
      curso:            curso || "",
      activo:           true,
      creado_en:        nowISO()
    };
    db.examenes.push(examen);
    saveDB(db);
    res.json({ ok: true, examen });
  } catch (err) { res.status(500).json({ error: "Error creando examen" }); }
});

// Verificar código de examen (alumno)
app.post("/api/examen/verificar", (req, res) => {
  try {
    const { codigo } = req.body;
    const db = loadDB();
    const examen = db.examenes.find(e => e.codigo === codigo.trim().toUpperCase() && e.activo);
    if (!examen) return res.status(404).json({ error: "Código de examen inválido o examen inactivo" });
    res.json({ ok: true, examen: { id: examen.id, nombre: examen.nombre, descripcion: examen.descripcion, total_preguntas: examen.total_preguntas, modo: examen.modo } });
  } catch { res.status(500).json({ error: "Error" }); }
});

// Chat en modo examen
app.post("/api/examen/chat", (req, res) => {
  const { messages, alumno, examenId, preguntaNum, mensajeUsuario } = req.body;
  if (!messages) return res.status(400).json({ error: "Mensajes requeridos" });

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 512, system: SYSTEM_EXAMEN, messages }),
  })
    .then(r => r.json())
    .then(data => {
      const reply = data.content?.[0]?.text || "";
      let resultado = "ask";
      if      (reply.startsWith("[OK]"))      resultado = "ok";
      else if (reply.startsWith("[WRONG]"))   resultado = "wrong";
      else if (reply.startsWith("[PARTIAL]")) resultado = "partial";

      // Guardar respuesta de examen
      if (alumno?.id && examenId && resultado !== "ask") {
        try {
          const db = loadDB();
          db.resultados_examen.push({
            id: Date.now(), examen_id: examenId, alumno_id: alumno.id,
            alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo,
            pregunta_num: preguntaNum || 1, mensaje_usuario: (mensajeUsuario||"").substring(0,300),
            resultado, timestamp: nowISO()
          });
          saveDB(db);
        } catch (e) { console.error(e); }
      }
      res.json({ content: reply, resultado });
    })
    .catch(err => { res.status(500).json({ error: "Error API" }); });
});

// Guardar resultado final del examen
app.post("/api/examen/finalizar", (req, res) => {
  try {
    const { examenId, alumno, correctas, parciales, incorrectas, total } = req.body;
    const db = loadDB();
    const examen = db.examenes.find(e => e.id === examenId);
    const puntaje = total > 0 ? Math.round(((correctas + parciales * 0.5) / total) * 20 * 10) / 10 : 0;

    db.resultados_examen.push({
      id: Date.now(), examen_id: examenId, examen_nombre: examen?.nombre || "",
      alumno_id: alumno.id, alumno_nombre: alumno.nombre, alumno_codigo: alumno.codigo,
      alumno_curso: alumno.curso, correctas, parciales, incorrectas, total,
      puntaje, tipo: "resumen", timestamp: nowISO()
    });
    saveDB(db);
    res.json({ ok: true, puntaje });
  } catch { res.status(500).json({ error: "Error" }); }
});

// Cerrar/abrir examen (profesor)
app.post("/api/examen/estado", (req, res) => {
  const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  try {
    const { examenId, activo } = req.body;
    const db = loadDB();
    const ex = db.examenes.find(e => e.id === examenId);
    if (ex) ex.activo = activo;
    saveDB(db);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error" }); }
});

// ─── ENCUESTA ────────────────────────────────────────────────────────────────
app.post("/api/encuesta", (req, res) => {
  try {
    const { alumno, p1, p2, p3, p4, comentario, sesionId } = req.body;
    const db = loadDB();
    db.encuestas.push({
      id: Date.now(), alumno_id: alumno?.id, alumno_nombre: alumno?.nombre,
      alumno_codigo: alumno?.codigo, alumno_curso: alumno?.curso,
      p1_utilidad: p1, p2_facilidad: p2, p3_recomendaria: p3, p4_aprendizaje: p4,
      comentario: (comentario || "").substring(0, 500),
      sesion_id: sesionId, timestamp: nowISO()
    });
    saveDB(db);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Error guardando encuesta" }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const DASH_PASS = process.env.DASHBOARD_PASSWORD || "profesor123";

app.post("/api/dashboard/auth", (req, res) => {
  if (req.body.password === DASH_PASS) res.json({ ok: true });
  else res.status(401).json({ error: "Contraseña incorrecta" });
});

app.get("/api/dashboard/stats", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db  = loadDB();
  const hoy = new Date().toISOString().slice(0,10);

  const totales = {
    alumnos: db.alumnos.length, sesiones: db.sesiones.length,
    interacciones: db.interacciones.length, hoy: db.interacciones.filter(i => i.timestamp?.startsWith(hoy)).length
  };

  const resMap = {};
  db.interacciones.forEach(i => { if (!["ok","wrong","partial"].includes(i.resultado)) return; resMap[i.resultado] = (resMap[i.resultado]||0)+1; });
  const resultados = Object.entries(resMap).map(([resultado,n]) => ({resultado,n}));

  const modeMap = {};
  db.interacciones.forEach(i => { modeMap[i.modo] = (modeMap[i.modo]||0)+1; });
  const modos = Object.entries(modeMap).map(([modo,n]) => ({modo,n})).sort((a,b)=>b.n-a.n);

  const diaMap = {};
  const hace30 = new Date(Date.now()-30*24*3600*1000).toISOString().slice(0,10);
  db.interacciones.filter(i=>i.timestamp>=hace30).forEach(i => { const d=i.timestamp?.slice(0,10); if(d) diaMap[d]=(diaMap[d]||0)+1; });
  const actividadPorDia = Object.entries(diaMap).map(([dia,n])=>({dia,n})).sort((a,b)=>a.dia.localeCompare(b.dia));

  const rankingAlumnos = db.alumnos.map(a => {
    const inters = db.interacciones.filter(i=>i.alumno_id===a.id);
    return { nombre:a.nombre, codigo:a.codigo, curso:a.curso, creado_en:a.creado_en,
             total_interacciones:inters.length,
             correctas:inters.filter(i=>i.resultado==="ok").length,
             incorrectas:inters.filter(i=>i.resultado==="wrong").length,
             parciales:inters.filter(i=>i.resultado==="partial").length,
             ultima_actividad:inters.length?inters[inters.length-1].timestamp:null };
  }).sort((a,b)=>b.total_interacciones-a.total_interacciones);

  const ultimasInteracciones = db.interacciones.slice(-50).reverse().map(i=>({
    alumno_nombre:i.alumno_nombre, alumno_codigo:i.alumno_codigo, modo:i.modo, resultado:i.resultado, timestamp:i.timestamp
  }));

  // Examenes con resultados
  const examenes = db.examenes.map(ex => {
    const resultados_ex = db.resultados_examen.filter(r => r.examen_id === ex.id && r.tipo === "resumen");
    const prom = resultados_ex.length ? Math.round(resultados_ex.reduce((s,r)=>s+r.puntaje,0)/resultados_ex.length*10)/10 : null;
    return { ...ex, total_rendidos: resultados_ex.length, promedio_puntaje: prom, resultados: resultados_ex };
  }).sort((a,b)=>b.id-a.id);

  // Encuestas resumen
  const enc = db.encuestas;
  const encuesta_resumen = enc.length ? {
    total: enc.length,
    p1_utilidad:    Math.round(enc.reduce((s,e)=>s+(e.p1_utilidad||0),0)/enc.length*10)/10,
    p2_facilidad:   Math.round(enc.reduce((s,e)=>s+(e.p2_facilidad||0),0)/enc.length*10)/10,
    p3_recomendaria:Math.round(enc.reduce((s,e)=>s+(e.p3_recomendaria||0),0)/enc.length*10)/10,
    p4_aprendizaje: Math.round(enc.reduce((s,e)=>s+(e.p4_aprendizaje||0),0)/enc.length*10)/10,
    comentarios: enc.filter(e=>e.comentario).slice(-10).map(e=>({nombre:e.alumno_nombre,texto:e.comentario,fecha:e.timestamp?.slice(0,10)}))
  } : null;

  res.json({ totales, resultados, modos, actividadPorDia, rankingAlumnos, ultimasInteracciones, examenes, encuesta_resumen });
});

app.get("/api/dashboard/export", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db = loadDB();
  const header = "Nombre,Código,Curso,Modo,Resultado,Mensaje,Fecha";
  const rows = db.interacciones.map(i => {
    const a = db.alumnos.find(a=>a.id===i.alumno_id)||{};
    return [a.nombre||i.alumno_nombre||"",a.codigo||i.alumno_codigo||"",a.curso||"",i.modo||"",i.resultado||"",`"${(i.mensaje_usuario||"").replace(/"/g,"'")}"`,i.timestamp||""].join(",");
  });
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=microbot-datos.csv");
  res.send([header,...rows].join("\n"));
});

app.get("/api/dashboard/export-examenes", (req, res) => {
  if (req.headers["x-dash-key"] !== DASH_PASS) return res.status(401).json({ error: "No autorizado" });
  const db = loadDB();
  const header = "Examen,Alumno,Código,Curso,Correctas,Parciales,Incorrectas,Total,Puntaje,Fecha";
  const rows = db.resultados_examen.filter(r=>r.tipo==="resumen").map(r =>
    [r.examen_nombre||"",r.alumno_nombre||"",r.alumno_codigo||"",r.alumno_curso||"",r.correctas||0,r.parciales||0,r.incorrectas||0,r.total||0,r.puntaje||0,r.timestamp?.slice(0,10)||""].join(",")
  );
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=examenes.csv");
  res.send([header,...rows].join("\n"));
});

app.get("/dashboard",(req,res)=>res.sendFile(path.join(__dirname,"public","dashboard.html")));
app.get("/health",   (req,res)=>res.json({ok:true,ts:new Date().toISOString()}));
app.get("*",         (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🔬 MicroBot / HistoLab corriendo en http://localhost:${PORT}`));
