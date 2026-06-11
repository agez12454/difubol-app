from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, ForeignKey, Boolean, Text, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os

_db_path = os.getenv("DB_PATH", "./arbitros.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Arbitro(Base):
    __tablename__ = "arbitros"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    categoria = Column(String, nullable=False)  # Ej: ANTIOQUIA AAA
    telefono = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    asignaciones = relationship("AsignacionPartido", back_populates="arbitro")


class Jornada(Base):
    __tablename__ = "jornadas"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)  # "Jornada 11"
    creado_en = Column(DateTime, default=datetime.utcnow)

    partidos = relationship("Partido", back_populates="jornada", cascade="all, delete-orphan")


class Partido(Base):
    __tablename__ = "partidos"

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(String, unique=True, index=True)
    jornada_id = Column(Integer, ForeignKey("jornadas.id"), nullable=True)
    equipo_local = Column(String)
    equipo_visitante = Column(String)
    competicion = Column(String)
    fecha_jornada = Column(String)
    estadio = Column(String)
    fecha_hora = Column(DateTime)
    numero_partido = Column(String)
    departamento = Column(String)
    ciudad = Column(String)
    imagen_url = Column(String, nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow)

    jornada = relationship("Jornada", back_populates="partidos")
    asignaciones = relationship("AsignacionPartido", back_populates="partido", cascade="all, delete-orphan")


class AsignacionPartido(Base):
    __tablename__ = "asignaciones"

    id = Column(Integer, primary_key=True, index=True)
    partido_id = Column(Integer, ForeignKey("partidos.id"))
    arbitro_id = Column(Integer, ForeignKey("arbitros.id"))
    rol = Column(String)  # Árbitro, 1° árbitro asistente, 2° árbitro asistente, Cuarto árbitro, etc.
    confirmado = Column(Boolean, default=False)

    partido = relationship("Partido", back_populates="asignaciones")
    arbitro = relationship("Arbitro", back_populates="asignaciones")


class Reemplazo(Base):
    __tablename__ = "reemplazos"

    id = Column(Integer, primary_key=True, index=True)
    partido_id = Column(Integer, ForeignKey("partidos.id"))
    arbitro_original_id = Column(Integer, ForeignKey("arbitros.id"))
    arbitro_reemplazo_id = Column(Integer, ForeignKey("arbitros.id"))
    rol = Column(String)
    creado_en = Column(DateTime, default=datetime.utcnow)

    partido = relationship("Partido")
    arbitro_original = relationship("Arbitro", foreign_keys=[arbitro_original_id])
    arbitro_reemplazo = relationship("Arbitro", foreign_keys=[arbitro_reemplazo_id])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    # Migraciones automáticas para columnas nuevas en DBs antiguas
    migraciones = [
        "ALTER TABLE partidos ADD COLUMN jornada_id INTEGER REFERENCES jornadas(id)",
        "ALTER TABLE arbitros ADD COLUMN telefono VARCHAR",
        "ALTER TABLE asignaciones ADD COLUMN confirmado BOOLEAN DEFAULT 0",
        "ALTER TABLE partidos ADD COLUMN imagen_url VARCHAR",
    ]
    with engine.connect() as conn:
        for sql in migraciones:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # La columna ya existe, ignorar
