import os
import base64
import json
import re
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

from database import get_db, init_db, Arbitro, Partido, AsignacionPartido  # noqa: E402

load_dotenv()
init_db()

app = FastAPI(title="Gestor de Árbitros")
app.mount("/static", StaticFiles(directory="static"), name="static")

MATCH_DURATION_HOURS = 2  # Duración estimada de un partido


# ─── Schemas ────────────────────────────────────────────────────────────────

class ArbitroCreate(BaseModel):
    nombre: str
    categoria: str


class PartidoManual(BaseModel):
    numero: str
    equipo_local: str
    equipo_visitante: str
    competicion: str
    fecha_jornada: str
    estadio: str
    fecha_hora: str  # "DD.MM.YYYY HH:MM"
    numero_partido: str
    departamento: str
    ciudad: str
    asignaciones: List[dict]  # [{"rol": "Árbitro", "nombre": "..."}]


# ─── Helpers ────────────────────────────────────────────────────────────────

def parse_fecha(fecha_str: str) -> Optional[datetime]:
    """Parse DD.MM.YYYY HH:MM or DD.MM.YYYY"""
    for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(fecha_str.strip(), fmt)
        except ValueError:
            continue
    return None


def detectar_conflictos(partido_id: int, db: Session):
    """Detecta conflictos de horario para todos los árbitros de un partido."""
    partido = db.query(Partido).filter(Partido.id == partido_id).first()
    if not partido or not partido.fecha_hora:
        return []

    conflictos = []
    fin_partido = partido.fecha_hora + timedelta(hours=MATCH_DURATION_HOURS)

    for asig in partido.asignaciones:
        # Buscar otros partidos del mismo árbitro
        otras = (
            db.query(AsignacionPartido)
            .filter(
                AsignacionPartido.arbitro_id == asig.arbitro_id,
                AsignacionPartido.partido_id != partido_id,
            )
            .all()
        )

        for otra in otras:
            otro_partido = otra.partido
            if not otro_partido.fecha_hora:
                continue

            otro_fin = otro_partido.fecha_hora + timedelta(hours=MATCH_DURATION_HOURS)

            # Conflicto si horarios se solapan O mismo día
            mismo_dia = partido.fecha_hora.date() == otro_partido.fecha_hora.date()
            solapan = (
                partido.fecha_hora < otro_fin and fin_partido > otro_partido.fecha_hora
            )

            if mismo_dia or solapan:
                conflictos.append(
                    {
                        "arbitro_id": asig.arbitro_id,
                        "arbitro_nombre": asig.arbitro.nombre,
                        "rol_en_este": asig.rol,
                        "partido_conflicto_id": otro_partido.id,
                        "partido_conflicto_num": otro_partido.numero,
                        "equipos_conflicto": f"{otro_partido.equipo_local} vs {otro_partido.equipo_visitante}",
                        "fecha_conflicto": otro_partido.fecha_hora.strftime("%d.%m.%Y %H:%M") if otro_partido.fecha_hora else "",
                        "rol_en_conflicto": otra.rol,
                        "tipo": "solapamiento" if solapan else "mismo_dia",
                    }
                )

    return conflictos


def sugerir_reemplazos(arbitro_id: int, partido_id: int, db: Session):
    """Sugiere árbitros disponibles de la misma categoría."""
    arbitro = db.query(Arbitro).filter(Arbitro.id == arbitro_id).first()
    partido = db.query(Partido).filter(Partido.id == partido_id).first()
    if not arbitro or not partido or not partido.fecha_hora:
        return []

    fin_partido = partido.fecha_hora + timedelta(hours=MATCH_DURATION_HOURS)

    # Árbitros de la misma categoría y activos
    candidatos = (
        db.query(Arbitro)
        .filter(Arbitro.categoria == arbitro.categoria, Arbitro.activo == True, Arbitro.id != arbitro_id)
        .all()
    )

    disponibles = []
    for candidato in candidatos:
        ocupado = False
        for asig in candidato.asignaciones:
            p = asig.partido
            if not p.fecha_hora:
                continue
            p_fin = p.fecha_hora + timedelta(hours=MATCH_DURATION_HOURS)
            mismo_dia = partido.fecha_hora.date() == p.fecha_hora.date()
            solapan = partido.fecha_hora < p_fin and fin_partido > p.fecha_hora
            if mismo_dia or solapan:
                ocupado = True
                break
        if not ocupado:
            disponibles.append({"id": candidato.id, "nombre": candidato.nombre, "categoria": candidato.categoria})

    return disponibles


def extraer_datos_imagen(imagen_b64: str, media_type: str) -> dict:
    """Usa Gemini Vision para extraer datos del partido desde la imagen."""
    prompt = """Analiza esta imagen de un sistema de gestión de partidos de fútbol y extrae los datos indicados.

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta (sin texto adicional):
{
  "equipo_local": "nombre del equipo de la izquierda",
  "equipo_visitante": "nombre del equipo de la derecha",
  "competicion": "texto del campo Competición",
  "estadio": "texto del campo Estadio",
  "fecha_hora": "fecha y hora en formato DD.MM.YYYY HH:MM",
  "ciudad": "texto del campo Ciudad / Municipio",
  "asignaciones": [
    {"rol": "Árbitro", "nombre": "APELLIDO NOMBRE (CATEGORIA)"},
    {"rol": "1° árbitro asistente", "nombre": "APELLIDO NOMBRE (CATEGORIA)"},
    {"rol": "2° árbitro asistente", "nombre": "APELLIDO NOMBRE (CATEGORIA)"},
    {"rol": "Cuarto árbitro", "nombre": "APELLIDO NOMBRE (CATEGORIA)"}
  ]
}

IMPORTANTE:
- En asignaciones incluye SOLO los roles que tengan nombre asignado (no vacíos)
- Copia los nombres EXACTAMENTE como aparecen en la imagen incluyendo la categoría entre paréntesis
- Si un campo no aparece, usa cadena vacía ""
- El JSON debe ser válido y completo"""

    api_key = os.getenv("OPENROUTER_API_KEY", "")
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8000",
                "X-Title": "Gestor de Arbitros",
            },
            json={
                "model": "nvidia/nemotron-nano-12b-v2-vl:free",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{imagen_b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            },
        )
    data = resp.json()
    if "error" in data:
        raise Exception(str(data["error"]))
    text = data["choices"][0]["message"]["content"].strip()
    # Extraer JSON si viene con markdown
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    return json.loads(text)


# ─── Rutas principales ───────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse("templates/index.html")


# ─── API Árbitros ────────────────────────────────────────────────────────────

@app.get("/api/debug-key")
def debug_key():
    key = os.getenv("OPENROUTER_API_KEY", "")
    return {"tiene_clave": bool(key), "primeros_chars": key[:12] if key else "VACÍA"}


@app.get("/api/modelos")
def listar_modelos():
    modelos = [m.name for m in gemini.models.list()]
    return {"modelos": modelos}


@app.get("/api/arbitros")
def listar_arbitros(db: Session = Depends(get_db)):
    return db.query(Arbitro).filter(Arbitro.activo == True).order_by(Arbitro.nombre).all()


@app.post("/api/arbitros")
def crear_arbitro(data: ArbitroCreate, db: Session = Depends(get_db)):
    arbitro = Arbitro(nombre=data.nombre.upper().strip(), categoria=data.categoria.upper().strip())
    db.add(arbitro)
    db.commit()
    db.refresh(arbitro)
    return arbitro


@app.delete("/api/arbitros/{arbitro_id}")
def eliminar_arbitro(arbitro_id: int, db: Session = Depends(get_db)):
    arbitro = db.query(Arbitro).filter(Arbitro.id == arbitro_id).first()
    if not arbitro:
        raise HTTPException(status_code=404, detail="Árbitro no encontrado")
    arbitro.activo = False
    db.commit()
    return {"ok": True}


# ─── API Partidos ─────────────────────────────────────────────────────────────

@app.get("/api/partidos")
def listar_partidos(db: Session = Depends(get_db)):
    partidos = db.query(Partido).order_by(Partido.fecha_hora).all()
    result = []
    for p in partidos:
        conflictos = detectar_conflictos(p.id, db)
        result.append(
            {
                "id": p.id,
                "numero": p.numero,
                "equipo_local": p.equipo_local,
                "equipo_visitante": p.equipo_visitante,
                "competicion": p.competicion,
                "estadio": p.estadio,
                "fecha_hora": p.fecha_hora.strftime("%d.%m.%Y %H:%M") if p.fecha_hora else "",
                "ciudad": p.ciudad,
                "asignaciones": [
                    {"rol": a.rol, "nombre": a.arbitro.nombre, "categoria": a.arbitro.categoria, "arbitro_id": a.arbitro_id}
                    for a in p.asignaciones
                ],
                "conflictos": conflictos,
                "tiene_conflicto": len(conflictos) > 0,
            }
        )
    return result


@app.get("/api/partidos/{partido_id}")
def obtener_partido(partido_id: int, db: Session = Depends(get_db)):
    p = db.query(Partido).filter(Partido.id == partido_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    conflictos = detectar_conflictos(p.id, db)
    return {
        "id": p.id,
        "numero": p.numero,
        "equipo_local": p.equipo_local,
        "equipo_visitante": p.equipo_visitante,
        "competicion": p.competicion,
        "fecha_jornada": p.fecha_jornada,
        "estadio": p.estadio,
        "fecha_hora": p.fecha_hora.strftime("%d.%m.%Y %H:%M") if p.fecha_hora else "",
        "numero_partido": p.numero_partido,
        "departamento": p.departamento,
        "ciudad": p.ciudad,
        "asignaciones": [
            {"rol": a.rol, "nombre": a.arbitro.nombre, "categoria": a.arbitro.categoria, "arbitro_id": a.arbitro_id}
            for a in p.asignaciones
        ],
        "conflictos": conflictos,
        "tiene_conflicto": len(conflictos) > 0,
    }


@app.post("/api/partidos")
def guardar_partido(data: PartidoManual, db: Session = Depends(get_db)):
    # Verificar si ya existe
    existente = db.query(Partido).filter(Partido.numero == data.numero).first()
    if existente:
        # Actualizar asignaciones
        db.query(AsignacionPartido).filter(AsignacionPartido.partido_id == existente.id).delete()
        existente.equipo_local = data.equipo_local
        existente.equipo_visitante = data.equipo_visitante
        existente.competicion = data.competicion
        existente.fecha_jornada = data.fecha_jornada
        existente.estadio = data.estadio
        existente.fecha_hora = parse_fecha(data.fecha_hora)
        existente.numero_partido = data.numero_partido
        existente.departamento = data.departamento
        existente.ciudad = data.ciudad
        partido = existente
    else:
        partido = Partido(
            numero=data.numero,
            equipo_local=data.equipo_local,
            equipo_visitante=data.equipo_visitante,
            competicion=data.competicion,
            fecha_jornada=data.fecha_jornada,
            estadio=data.estadio,
            fecha_hora=parse_fecha(data.fecha_hora),
            numero_partido=data.numero_partido,
            departamento=data.departamento,
            ciudad=data.ciudad,
        )
        db.add(partido)
        db.flush()

    # Crear asignaciones: buscar árbitro por nombre
    for asig in data.asignaciones:
        if not asig.get("nombre"):
            continue
        nombre_limpio = asig["nombre"].split("(")[0].strip().upper()
        arbitro = db.query(Arbitro).filter(Arbitro.nombre == nombre_limpio).first()
        if not arbitro:
            # Extraer categoría del paréntesis si existe
            cat_match = re.search(r"\(([^)]+)\)", asig["nombre"])
            categoria = cat_match.group(1).strip() if cat_match else "SIN CATEGORÍA"
            arbitro = Arbitro(nombre=nombre_limpio, categoria=categoria)
            db.add(arbitro)
            db.flush()

        a = AsignacionPartido(partido_id=partido.id, arbitro_id=arbitro.id, rol=asig["rol"])
        db.add(a)

    db.commit()
    conflictos = detectar_conflictos(partido.id, db)
    return {"id": partido.id, "conflictos": conflictos, "tiene_conflicto": len(conflictos) > 0}


@app.delete("/api/partidos/{partido_id}")
def eliminar_partido(partido_id: int, db: Session = Depends(get_db)):
    partido = db.query(Partido).filter(Partido.id == partido_id).first()
    if not partido:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    db.delete(partido)
    db.commit()
    return {"ok": True}


# ─── API Imagen OCR ───────────────────────────────────────────────────────────

@app.post("/api/procesar-imagen")
async def procesar_imagen(file: UploadFile = File(...)):
    contenido = await file.read()
    imagen_b64 = base64.b64encode(contenido).decode()
    media_type = file.content_type or "image/jpeg"

    try:
        datos = extraer_datos_imagen(imagen_b64, media_type)
        return {"ok": True, "datos": datos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error procesando imagen: {str(e)}")


# ─── API Conflictos y Sugerencias ────────────────────────────────────────────

@app.get("/api/conflictos")
def todos_los_conflictos(db: Session = Depends(get_db)):
    partidos = db.query(Partido).all()
    todos = []
    vistos = set()
    for p in partidos:
        for c in detectar_conflictos(p.id, db):
            clave = tuple(sorted([p.id, c["partido_conflicto_id"], c["arbitro_id"]]))
            if clave not in vistos:
                vistos.add(clave)
                c["partido_origen_id"] = p.id
                c["partido_origen_num"] = p.numero
                c["equipos_origen"] = f"{p.equipo_local} vs {p.equipo_visitante}"
                c["fecha_origen"] = p.fecha_hora.strftime("%d.%m.%Y %H:%M") if p.fecha_hora else ""
                todos.append(c)
    return todos


@app.get("/api/sugerencias/{arbitro_id}/{partido_id}")
def sugerencias(arbitro_id: int, partido_id: int, db: Session = Depends(get_db)):
    return sugerir_reemplazos(arbitro_id, partido_id, db)
