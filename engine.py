"""
JNUS AI · Consumer Inference Engine
=====================================
Capa de PRODUCTO (no toca el pipeline de ciencia de datos existente).

Responsabilidades:
  1. Generar un dataset semilla realista de crédito (contexto Ecuador) cuyas
     columnas SON exactamente los campos del formulario del usuario final.
  2. Entrenar UNA sola vez los 4 modelos (Logistic Regression, Random Forest,
     XGBoost, Neural Network) y persistirlos a disco (models/*.pkl).
  3. En arranque: si los .pkl existen → cargar; si no → entrenar y guardar.
  4. score(): inferencia instantánea (el usuario NUNCA entrena) + XAI en
     español plano (factores positivos / negativos / recomendaciones).

Los modelos y sus hiperparámetros son los MISMOS que usa el backend original.
"""
from __future__ import annotations

import json
import os
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

try:
    import joblib
    HAS_JOBLIB = True
except Exception:
    HAS_JOBLIB = False

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except Exception:
    HAS_XGB = False

APP_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(APP_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
BUNDLE_PATH = os.path.join(MODELS_DIR, "janus_bundle.pkl")

# ──────────────────────────────────────────────────────────────────────────────
# ESQUEMA DEL FORMULARIO  (= columnas del dataset semilla)
# ──────────────────────────────────────────────────────────────────────────────
CREDIT_TYPES = [
    "Hipotecario", "Vehicular", "Personal", "Microcrédito",
    "Productivo", "Emprendimiento",
]
EMPLOYMENT = [
    "Empleado Público", "Empleado Privado", "Emprendedor",
    "Negocio Propio", "Trabajo Informal", "Desempleado",
]
EDUCATION = ["Primaria", "Secundaria", "Universitaria", "Posgrado"]
PAYMENT_HISTORY = ["Malo", "Regular", "Bueno", "Excelente"]
INSTITUTIONS = [
    "Banco Pichincha", "Banco Guayaquil", "Produbanco",
    "Banco del Pacífico", "Cooperativa JEP",
]
SEX = ["Masculino", "Femenino"]

# Etiquetas amigables para mostrar en el XAI
FRIENDLY = {
    "edad": "Tu edad",
    "ingresos_mensuales": "Tus ingresos mensuales",
    "cargas_familiares": "Tus cargas familiares",
    "creditos_activos": "Tus créditos activos",
    "sexo": "Sexo",
    "educacion": "Tu nivel educativo",
    "historial_pagos": "Tu historial de pagos",
    "institucion": "La institución financiera",
    "tipo_credito": "El tipo de crédito",
    "situacion_laboral": "Tu situación laboral",
}


def _friendly(feature: str) -> str:
    """Convierte 'historial_pagos_Excelente' → 'Historial de pagos: Excelente'."""
    for base, label in FRIENDLY.items():
        if feature == base:
            return label
        if feature.startswith(base + "_"):
            val = feature[len(base) + 1:].replace("_", " ")
            return f"{label.replace('Tu ', '').replace('Tus ', '').capitalize()}: {val}"
    return feature.replace("_", " ").capitalize()


# ──────────────────────────────────────────────────────────────────────────────
# 1) DATASET SEMILLA SINTÉTICO (realista)
# ──────────────────────────────────────────────────────────────────────────────
def generate_seed(n: int = 2500, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        edad = int(rng.integers(20, 70))
        sexo = rng.choice(SEX)
        educacion = rng.choice(EDUCATION, p=[0.2, 0.4, 0.32, 0.08])
        cargas = int(rng.integers(0, 6))
        situacion = rng.choice(EMPLOYMENT, p=[0.15, 0.30, 0.15, 0.15, 0.18, 0.07])
        # ingresos correlacionados con situación y educación
        base_income = {
            "Empleado Público": 1100, "Empleado Privado": 1000, "Emprendedor": 900,
            "Negocio Propio": 1200, "Trabajo Informal": 550, "Desempleado": 250,
        }[situacion]
        edu_mult = {"Primaria": 0.8, "Secundaria": 1.0, "Universitaria": 1.45, "Posgrado": 2.0}[educacion]
        ingresos = max(0, float(rng.normal(base_income * edu_mult, 350)))
        creditos = int(rng.integers(0, 6))
        historial = rng.choice(PAYMENT_HISTORY, p=[0.15, 0.25, 0.35, 0.25])
        institucion = rng.choice(INSTITUTIONS)
        tipo = rng.choice(CREDIT_TYPES)

        # ── función latente de aprobación ──
        z = -1.2
        z += (ingresos / 1500.0) * 1.6
        z += {"Malo": -1.6, "Regular": -0.4, "Bueno": 0.7, "Excelente": 1.7}[historial]
        z += {"Primaria": -0.3, "Secundaria": 0.0, "Universitaria": 0.5, "Posgrado": 0.9}[educacion]
        z += -0.45 * creditos
        z += -0.15 * cargas
        z += {"Empleado Público": 0.8, "Empleado Privado": 0.6, "Emprendedor": 0.1,
              "Negocio Propio": 0.4, "Trabajo Informal": -0.6, "Desempleado": -1.8}[situacion]
        z += {"Microcrédito": 0.5, "Personal": 0.2, "Emprendimiento": 0.0,
              "Productivo": -0.1, "Vehicular": -0.2, "Hipotecario": -0.5}[tipo]
        z += -0.012 * abs(edad - 40)  # edad media favorece
        z += float(rng.normal(0, 0.6))  # ruido

        prob = 1.0 / (1.0 + np.exp(-z))
        aprobado = int(rng.random() < prob)
        rows.append({
            "edad": edad, "sexo": sexo, "educacion": educacion,
            "cargas_familiares": cargas, "ingresos_mensuales": round(ingresos, 2),
            "creditos_activos": creditos, "historial_pagos": historial,
            "institucion": institucion, "tipo_credito": tipo,
            "situacion_laboral": situacion, "aprobado": aprobado,
        })
    return pd.DataFrame(rows)


# ──────────────────────────────────────────────────────────────────────────────
# 2) ENTRENAMIENTO + PERSISTENCIA
# ──────────────────────────────────────────────────────────────────────────────
RAW_NUM = ["edad", "ingresos_mensuales", "cargas_familiares", "creditos_activos"]
RAW_CAT = ["sexo", "educacion", "historial_pagos", "institucion",
           "tipo_credito", "situacion_laboral"]
TARGET = "aprobado"


def _encode(df: pd.DataFrame, columns=None) -> pd.DataFrame:
    X = pd.get_dummies(df[RAW_NUM + RAW_CAT], columns=RAW_CAT, drop_first=False, dtype=float)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0.0)
    return X


def _build_models():
    models = {
        "logit": LogisticRegression(max_iter=1000, solver="lbfgs"),
        "random_forest": RandomForestClassifier(
            n_estimators=200, max_depth=10, random_state=42, n_jobs=-1),
        "neural_net": MLPClassifier(
            hidden_layer_sizes=(64, 32), max_iter=400, random_state=42, early_stopping=True),
    }
    if HAS_XGB:
        models["xgboost"] = XGBClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.1,
            eval_metric="logloss", random_state=42, n_jobs=-1, verbosity=0)
    return models


def train_and_persist(seed: int = 42, df: "pd.DataFrame" = None,
                      source: str = "seed") -> dict:
    """Entrena los 4 modelos y persiste el bundle a disco.

    - Sin argumentos → usa el dataset semilla sintético (comportamiento original).
    - df != None     → el admin subió un dataset real (mismo esquema de columnas).
    Train/test split 80/20 para métricas honestas (accuracy + AUC sobre test).
    """
    if df is None:
        df = generate_seed(seed=seed)
    df = df.copy()

    y = df[TARGET].astype(int).values
    X = _encode(df)
    columns = list(X.columns)

    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score, accuracy_score

    strat = y if len(np.unique(y)) == 2 and np.bincount(y).min() >= 2 else None
    Xtr, Xte, ytr, yte = train_test_split(
        X.values, y, test_size=0.2, random_state=42, stratify=strat)

    scaler = StandardScaler()
    Xtr_s = scaler.fit_transform(Xtr)
    Xte_s = scaler.transform(Xte)
    # re-fit scaler sobre TODO para que la inferencia use toda la información
    scaler_full = StandardScaler().fit(X.values)

    models = _build_models()
    metrics = {}
    for name, m in models.items():
        m.fit(Xtr_s, ytr)
        try:
            proba = m.predict_proba(Xte_s)[:, 1]
            auc = float(roc_auc_score(yte, proba))
        except Exception:
            auc = 0.5
        try:
            acc = float(accuracy_score(yte, m.predict(Xte_s)))
        except Exception:
            acc = 0.0
        # re-entrenar con TODO el dataset para producción (mejor uso de datos)
        m.fit(scaler_full.transform(X.values), y)
        metrics[name] = {"auc": round(auc, 3), "accuracy": round(acc, 3)}

    scaler = scaler_full  # el bundle guarda el scaler ajustado a todo X

    ranges = {c: {"min": float(X[c].min()), "max": float(X[c].max()),
                  "mean": float(X[c].mean()), "median": float(X[c].median())}
              for c in columns}

    import datetime as _dt
    bundle = {
        "models": models, "scaler": scaler, "columns": columns,
        "ranges": ranges, "metrics": metrics,
        "raw_num": RAW_NUM, "raw_cat": RAW_CAT,
        "approval_rate": float(y.mean()),
        # metadata para el panel admin (no afecta inferencia)
        "version": _dt.datetime.now().strftime("v%Y.%m.%d-%H%M"),
        "dataset_size": int(len(df)),
        "trained_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "source": source,
    }
    if HAS_JOBLIB:
        joblib.dump(bundle, BUNDLE_PATH)
    return bundle


def retrain_from_dataframe(df: "pd.DataFrame", source: str = "upload") -> dict:
    """Reentrena el motor de PRODUCCIÓN desde un dataset del admin y recarga
    el singleton para que /app use el nuevo modelo inmediatamente."""
    # Validar columnas mínimas requeridas
    required = set(RAW_NUM + RAW_CAT + [TARGET])
    missing = required - set(df.columns)
    if missing:
        raise ValueError("Faltan columnas requeridas: " + ", ".join(sorted(missing)))
    bundle = train_and_persist(df=df, source=source)
    ENGINE.bundle = bundle  # hot-reload del modelo en memoria
    return bundle


# columnas que un CSV/Excel/SAV del admin debe contener
REQUIRED_COLUMNS = RAW_NUM + RAW_CAT + [TARGET]


# ──────────────────────────────────────────────────────────────────────────────
# 3) MOTOR DE INFERENCIA (singleton)
# ──────────────────────────────────────────────────────────────────────────────
class JanusEngine:
    def __init__(self):
        self.bundle = None

    def ready(self) -> bool:
        return self.bundle is not None

    def bootstrap(self):
        """Carga modelos persistidos o los entrena si no existen."""
        if HAS_JOBLIB and os.path.exists(BUNDLE_PATH):
            try:
                self.bundle = joblib.load(BUNDLE_PATH)
                return self.bundle
            except Exception:
                pass
        self.bundle = train_and_persist()
        return self.bundle

    # ── construir vector de features desde el formulario amigable ──
    def _row(self, payload: dict) -> pd.DataFrame:
        d = {
            "edad": float(payload.get("edad", 35)),
            "ingresos_mensuales": float(payload.get("ingresos_mensuales", 800)),
            "cargas_familiares": float(payload.get("cargas_familiares", 0)),
            "creditos_activos": float(payload.get("creditos_activos", 0)),
            "sexo": payload.get("sexo", "Masculino"),
            "educacion": payload.get("educacion", "Secundaria"),
            "historial_pagos": payload.get("historial_pagos", "Bueno"),
            "institucion": payload.get("institucion", "Banco Pichincha"),
            "tipo_credito": payload.get("tipo_credito", "Personal"),
            "situacion_laboral": payload.get("situacion_laboral", "Empleado Privado"),
        }
        return pd.DataFrame([d])

    def _prob_all(self, Xs) -> dict:
        out = {}
        for name, m in self.bundle["models"].items():
            try:
                out[name] = float(m.predict_proba(Xs)[0, 1])
            except Exception:
                out[name] = 0.5
        return out

    def score(self, payload: dict) -> dict:
        if not self.ready():
            self.bootstrap()
        b = self.bundle
        df = self._row(payload)
        X = _encode(df, columns=b["columns"])
        Xs = b["scaler"].transform(X.values)

        per_model = self._prob_all(Xs)
        prob = float(np.mean(list(per_model.values())))  # ensemble

        # ── XAI: contribuciones del modelo logístico (interpretable) ──
        logit = b["models"]["logit"]
        coefs = logit.coef_[0]
        contribs = []
        for col, coef, val in zip(b["columns"], coefs, Xs[0]):
            c = float(coef * val)
            if abs(c) < 1e-6:
                continue
            contribs.append({"feature": col, "label": _friendly(col),
                             "impact": c})
        contribs.sort(key=lambda d: abs(d["impact"]), reverse=True)
        positives = [c for c in contribs if c["impact"] > 0][:5]
        negatives = [c for c in contribs if c["impact"] < 0][:5]

        # ── Recomendaciones what-if (sobre el ensemble) ──
        recs = self._recommendations(payload, prob)

        # ── Clasificación de riesgo ──
        if prob >= 0.66:
            risk, risk_label, risk_color = "alta", "Excelente", "#22C55E"
        elif prob >= 0.40:
            risk, risk_label, risk_color = "media", "Moderada", "#D4AF37"
        else:
            risk, risk_label, risk_color = "baja", "Riesgosa", "#EF4444"

        verdict = ("¡Felicidades! Tu perfil tiene una alta probabilidad de aprobación."
                   if prob >= 0.66 else
                   "Tu perfil es viable, pero puedes mejorarlo para asegurar la aprobación."
                   if prob >= 0.40 else
                   "Tu perfil presenta riesgo. Sigue las recomendaciones para mejorar.")

        return {
            "ok": True,
            "probability": round(prob, 4),
            "percent": round(prob * 100, 1),
            "risk": risk, "risk_label": risk_label, "risk_color": risk_color,
            "verdict": verdict,
            "per_model": {k: round(v * 100, 1) for k, v in per_model.items()},
            "positive_factors": [
                {"label": c["label"], "weight": round(min(1.0, abs(c["impact"]) / 3), 2)}
                for c in positives
            ],
            "negative_factors": [
                {"label": c["label"], "weight": round(min(1.0, abs(c["impact"]) / 3), 2)}
                for c in negatives
            ],
            "recommendations": recs,
            "model_metrics": b["metrics"],
        }

    def _recommendations(self, payload: dict, base_prob: float) -> list:
        """Análisis what-if real: prueba mejoras y mide el cambio de probabilidad."""
        recs = []
        b = self.bundle

        def prob_of(mod_payload):
            X = _encode(self._row(mod_payload), columns=b["columns"])
            Xs = b["scaler"].transform(X.values)
            return float(np.mean(list(self._prob_all(Xs).values())))

        # 1) reducir créditos activos
        ca = int(float(payload.get("creditos_activos", 0)))
        if ca >= 1:
            alt = dict(payload); alt["creditos_activos"] = max(0, ca - 1)
            d = prob_of(alt) - base_prob
            if d > 0.01:
                recs.append({
                    "icon": "💳",
                    "text": f"Si reduces tus créditos activos de {ca} a {ca-1}, tu aprobación sube ~{d*100:.0f}%.",
                    "gain": round(d * 100, 1)})

        # 2) mejorar historial de pagos
        hp = payload.get("historial_pagos", "Bueno")
        if hp in PAYMENT_HISTORY and PAYMENT_HISTORY.index(hp) < 3:
            nxt = PAYMENT_HISTORY[PAYMENT_HISTORY.index(hp) + 1]
            alt = dict(payload); alt["historial_pagos"] = nxt
            d = prob_of(alt) - base_prob
            if d > 0.01:
                recs.append({
                    "icon": "📅",
                    "text": f"Mantener tus pagos al día (historial «{nxt}») aumentaría tu aprobación ~{d*100:.0f}%.",
                    "gain": round(d * 100, 1)})

        # 3) incrementar ingresos (informativo)
        ing = float(payload.get("ingresos_mensuales", 800))
        alt = dict(payload); alt["ingresos_mensuales"] = ing * 1.25
        d = prob_of(alt) - base_prob
        if d > 0.01:
            recs.append({
                "icon": "💵",
                "text": f"Demostrar ingresos un 25% mayores elevaría tu aprobación ~{d*100:.0f}%.",
                "gain": round(d * 100, 1)})

        recs.sort(key=lambda r: r["gain"], reverse=True)
        if not recs:
            recs.append({"icon": "✅",
                         "text": "Tu perfil ya está bien optimizado. ¡Mantén tus buenos hábitos financieros!",
                         "gain": 0})
        return recs[:4]

    def options(self) -> dict:
        return {
            "credit_types": CREDIT_TYPES,
            "employment": EMPLOYMENT,
            "education": EDUCATION,
            "payment_history": PAYMENT_HISTORY,
            "institutions": INSTITUTIONS,
            "sex": SEX,
        }


# singleton global
ENGINE = JanusEngine()
