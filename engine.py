"""
JNUS AI · Consumer Inference Engine  v2.0
==========================================
Motor de IA de PRODUCCIÓN: entrena, persiste y sirve los 4 modelos de
clasificación crediticia.

Mejoras v2:
  - Función latente mejorada: ratio endeudamiento, interacciones no lineales.
  - GeluMLP: LR scheduling (warm-up + cosine), gradient clipping, dropout,
    inicialización informada por Odds Ratios del Logit.
  - Ensemble ponderado por AUC (no promedio simple).
  - Stratified k-fold (k=5) para métricas más robustas.
  - Métricas expandidas: F1, precision, recall, confusion matrix.
  - Sistema de checkpoints para salvar/restaurar redes.
"""
from __future__ import annotations

import copy
import datetime as _dt
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
CHECKPOINTS_DIR = os.path.join(MODELS_DIR, "checkpoints")
os.makedirs(CHECKPOINTS_DIR, exist_ok=True)

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
    "monto_solicitado": "El monto solicitado",
    "antiguedad_laboral": "Tu antigüedad laboral",
    "tasa_interes": "La tasa de interés",
    "plazo_meses": "El plazo del crédito",
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
# 1) DATASET SEMILLA SINTÉTICO (realista — mejorado con ratios financieros)
# ──────────────────────────────────────────────────────────────────────────────
def generate_seed(n: int = 3000, seed: int = 42) -> pd.DataFrame:
    """Genera dataset sintético con función latente mejorada que incorpora
    ratios de endeudamiento, interacciones no lineales y variables compuestas."""
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        edad = int(rng.integers(20, 70))
        sexo = rng.choice(SEX)
        educacion = rng.choice(EDUCATION, p=[0.18, 0.38, 0.34, 0.10])
        cargas = int(rng.integers(0, 6))
        situacion = rng.choice(EMPLOYMENT, p=[0.15, 0.30, 0.15, 0.15, 0.18, 0.07])

        # Ingresos correlacionados con situación y educación
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

        antiguedad = 0 if situacion == "Desempleado" else int(
            min(max(0, rng.normal((edad - 20) * 0.45, 4)), max(0, edad - 16)))

        tipo_mult = {"Hipotecario": 22, "Vehicular": 10, "Productivo": 8,
                     "Emprendimiento": 6, "Personal": 4, "Microcrédito": 3}.get(tipo, 5)
        monto = round(float(max(300, rng.normal(ingresos * tipo_mult, ingresos * 3))), 2)

        # Tasa de interés (%) y plazo (meses): dependen del tipo de crédito (producto)
        tasa_base = {"Hipotecario": 11.5, "Vehicular": 13.0, "Productivo": 16.0,
                     "Emprendimiento": 17.0, "Personal": 15.0, "Microcrédito": 20.0}.get(tipo, 15.0)
        tasa_interes = round(float(np.clip(rng.normal(tasa_base, 1.8), 8.0, 28.0)), 2)
        plazo_base = {"Hipotecario": 120, "Vehicular": 48, "Productivo": 36,
                      "Emprendimiento": 24, "Personal": 24, "Microcrédito": 12}.get(tipo, 24)
        plazo_meses = int(np.clip(round(rng.normal(plazo_base, plazo_base * 0.25)), 3, 180))

        # ── Función latente MEJORADA con ratios financieros ──
        ingreso_anual = ingresos * 12 + 1  # +1 para evitar div por 0
        ratio_endeudamiento = min(5.0, monto / ingreso_anual)
        ratio_carga = cargas / max(ingresos / 500, 1)  # cargas vs ingreso normalizado

        # Score compuesto (historial + antigüedad + educación)
        hist_score = {"Malo": 0.0, "Regular": 0.33, "Bueno": 0.67, "Excelente": 1.0}[historial]
        edu_score = {"Primaria": 0.0, "Secundaria": 0.33, "Universitaria": 0.67, "Posgrado": 1.0}[educacion]
        score_compuesto = (hist_score * 0.5 + min(antiguedad / 15, 1.0) * 0.3 + edu_score * 0.2)

        z = -1.5  # intercept (ligeramente negativo = conservador)

        # Ingresos: efecto logarítmico (rendimientos decrecientes)
        z += np.log1p(ingresos / 500.0) * 1.4

        # Historial de pagos (factor más importante)
        z += {"Malo": -2.0, "Regular": -0.5, "Bueno": 0.8, "Excelente": 1.9}[historial]

        # Educación
        z += {"Primaria": -0.4, "Secundaria": 0.0, "Universitaria": 0.6, "Posgrado": 1.0}[educacion]

        # Créditos activos (penalización creciente)
        z += -0.35 * creditos - 0.05 * (creditos ** 2)

        # Cargas familiares (penalización moderada, interacción con ingresos)
        z += -0.12 * ratio_carga

        # Situación laboral
        z += {"Empleado Público": 0.9, "Empleado Privado": 0.7, "Emprendedor": 0.15,
              "Negocio Propio": 0.5, "Trabajo Informal": -0.7, "Desempleado": -2.0}[situacion]

        # Tipo de crédito
        z += {"Microcrédito": 0.5, "Personal": 0.2, "Emprendimiento": 0.0,
              "Productivo": -0.1, "Vehicular": -0.3, "Hipotecario": -0.6}[tipo]

        # Edad: óptimo entre 28-50, penalización suave fuera
        z += -0.015 * max(0, abs(edad - 39) - 11)

        # Antigüedad laboral (efecto logarítmico)
        z += 0.3 * np.log1p(antiguedad)

        # Ratio de endeudamiento (factor clave negativo)
        z += -0.8 * ratio_endeudamiento

        # Score compuesto (bonus por perfil integral)
        z += 0.6 * score_compuesto

        # Interacción: historial bueno + ingresos altos = sinergia
        if hist_score >= 0.67 and ingresos > 1000:
            z += 0.3

        # Tasa de interés: efecto leve POSITIVo (productos de mayor tasa = crédito
        # de riesgo, se aprueban más). Plazo: efecto leve NEGATIVO (más exposición).
        z += 0.03 * (tasa_interes - 15.0)
        z += -0.004 * (plazo_meses - 24)

        # Ruido (menor que antes para señal más fuerte)
        z += float(rng.normal(0, 0.5))

        prob = 1.0 / (1.0 + np.exp(-z))
        aprobado = int(rng.random() < prob)
        rows.append({
            "edad": edad, "sexo": sexo, "educacion": educacion,
            "cargas_familiares": cargas, "ingresos_mensuales": round(ingresos, 2),
            "creditos_activos": creditos, "monto_solicitado": monto,
            "antiguedad_laboral": antiguedad,
            "tasa_interes": tasa_interes, "plazo_meses": plazo_meses,
            "historial_pagos": historial,
            "institucion": institucion, "tipo_credito": tipo,
            "situacion_laboral": situacion, "aprobado": aprobado,
        })
    return pd.DataFrame(rows)


# ──────────────────────────────────────────────────────────────────────────────
# 2) ENTRENAMIENTO + PERSISTENCIA
# ──────────────────────────────────────────────────────────────────────────────
RAW_NUM = ["edad", "ingresos_mensuales", "cargas_familiares", "creditos_activos",
           "monto_solicitado", "antiguedad_laboral", "tasa_interes", "plazo_meses"]
RAW_CAT = ["sexo", "educacion", "historial_pagos", "institucion",
           "tipo_credito", "situacion_laboral"]
TARGET = "aprobado"


def _encode(df: pd.DataFrame, columns=None) -> pd.DataFrame:
    X = pd.get_dummies(df[RAW_NUM + RAW_CAT], columns=RAW_CAT, drop_first=False, dtype=float)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0.0)
    return X


class GeluMLP:
    """Red neuronal feed-forward PROPIA de JNUS (NumPy puro, sin TensorFlow).

    Estructura probabilística:
      - Capas OCULTAS con activación GELU  →  g(z) = 0.5·z·(1+tanh(√(2/π)(z+0.044715 z³)))
      - Dropout entre capas ocultas para regularización
      - Capa de SALIDA con SIGMOIDE  →  σ(z) = 1/(1+e^{-z})
      - Pérdida = entropía cruzada binaria (BCE), optimizada con Adam
      - LR scheduling: warm-up lineal + cosine decay
      - Gradient clipping para estabilidad
      - Inicialización informada por Odds Ratios del Logit (opcional)
    """

    _C = 0.7978845608028654  # √(2/π)

    def __init__(self, hidden=(64, 32), epochs=300, lr=0.008, l2=5e-4,
                 batch=64, patience=20, seed=42, dropout=0.15,
                 grad_clip=5.0, warmup_epochs=10):
        self.hidden = tuple(hidden)
        self.epochs = int(epochs)
        self.lr = float(lr)
        self.l2 = float(l2)
        self.batch = int(batch)
        self.patience = int(patience)
        self.seed = int(seed)
        self.dropout = float(dropout)
        self.grad_clip = float(grad_clip)
        self.warmup_epochs = int(warmup_epochs)
        self.classes_ = np.array([0, 1])
        self._or_weights = None  # Odds ratio weights from logit

    # ── activaciones ──
    @classmethod
    def _gelu(cls, x):
        return 0.5 * x * (1.0 + np.tanh(cls._C * (x + 0.044715 * np.power(x, 3))))

    @classmethod
    def _gelu_grad(cls, x):
        u = cls._C * (x + 0.044715 * np.power(x, 3))
        t = np.tanh(u)
        du = cls._C * (1.0 + 3 * 0.044715 * np.square(x))
        return 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * du

    @staticmethod
    def _sigmoid(z):
        return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))

    def set_logit_or(self, or_weights: np.ndarray):
        """Recibe los Odds Ratios del logit para inicialización informada."""
        self._or_weights = or_weights

    def _init_params(self, n_in):
        rng = np.random.default_rng(self.seed)
        sizes = [n_in] + list(self.hidden) + [1]
        self.W, self.b = [], []
        for i in range(len(sizes) - 1):
            scale = np.sqrt(2.0 / sizes[i])  # He init
            W = rng.normal(0.0, scale, size=(sizes[i], sizes[i + 1]))

            # Inicialización informada por OR del logit (primera capa)
            if i == 0 and self._or_weights is not None:
                or_scale = np.log(np.clip(self._or_weights, 0.1, 10.0))
                or_scale = or_scale / (np.std(or_scale) + 1e-8) * scale
                # Mezclar: 70% He init + 30% OR-informed
                for j in range(min(len(or_scale), W.shape[0])):
                    W[j, :] = W[j, :] * 0.7 + or_scale[j] * 0.3

            self.W.append(W)
            self.b.append(np.zeros(sizes[i + 1]))

    def _get_lr(self, epoch):
        """Learning rate scheduling: warm-up lineal + cosine decay."""
        if epoch < self.warmup_epochs:
            return self.lr * (epoch + 1) / self.warmup_epochs
        progress = (epoch - self.warmup_epochs) / max(1, self.epochs - self.warmup_epochs)
        return self.lr * 0.5 * (1.0 + np.cos(np.pi * progress))

    def _clip_grads(self, gW, gb):
        """Gradient clipping por norma global."""
        total_norm = 0.0
        for g in gW:
            total_norm += np.sum(g ** 2)
        for g in gb:
            total_norm += np.sum(g ** 2)
        total_norm = np.sqrt(total_norm)
        if total_norm > self.grad_clip:
            scale = self.grad_clip / (total_norm + 1e-8)
            gW = [g * scale for g in gW]
            gb = [g * scale for g in gb]
        return gW, gb

    def _forward(self, X, cache=False, training=False):
        a = X
        zs, acts, masks = [], [], []
        L = len(self.W)
        for i in range(L):
            z = a @ self.W[i] + self.b[i]
            zs.append(z)
            if i < L - 1:
                a = self._gelu(z)
                # Dropout (solo en training)
                if training and self.dropout > 0:
                    mask = (np.random.random(a.shape) > self.dropout).astype(float)
                    a = a * mask / (1.0 - self.dropout)
                    masks.append(mask)
                else:
                    masks.append(None)
            else:
                a = self._sigmoid(z)
            acts.append(a)
        return (a, zs, acts, masks) if cache else a

    @staticmethod
    def _bce(p, y):
        p = np.clip(p, 1e-7, 1 - 1e-7)
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).reshape(-1)
        n, n_in = X.shape
        self._init_params(n_in)
        L = len(self.W)

        # Adam optimizer state
        mW = [np.zeros_like(w) for w in self.W]
        vW = [np.zeros_like(w) for w in self.W]
        mb = [np.zeros_like(bb) for bb in self.b]
        vb = [np.zeros_like(bb) for bb in self.b]
        b1, b2, eps = 0.9, 0.999, 1e-8
        rng = np.random.default_rng(self.seed + 1)

        # Train/val split for early stopping
        perm = rng.permutation(n)
        n_val = max(1, int(0.15 * n))
        vi, ti = perm[:n_val], perm[n_val:]
        Xtr, ytr, Xval, yval = X[ti], y[ti], X[vi], y[vi]

        self.loss_curve_, self.val_loss_curve_ = [], []
        self.epoch_metrics_ = []
        best_val, best, bad, t = np.inf, None, 0, 0

        for _ep in range(self.epochs):
            current_lr = self._get_lr(_ep)
            order = rng.permutation(len(ti))

            for s in range(0, len(ti), self.batch):
                bi = order[s:s + self.batch]
                xb, yb = Xtr[bi], ytr[bi]
                p, zs, acts, masks = self._forward(xb, cache=True, training=True)
                m = len(bi)
                dz = (p.reshape(-1) - yb).reshape(-1, 1) / m
                t += 1

                gW_list, gb_list = [], []
                for i in reversed(range(L)):
                    a_in = xb if i == 0 else acts[i - 1]
                    gW = a_in.T @ dz + self.l2 * self.W[i]
                    gb = dz.sum(0)
                    gW_list.insert(0, gW)
                    gb_list.insert(0, gb)
                    if i > 0:
                        dz = (dz @ self.W[i].T) * self._gelu_grad(zs[i - 1])
                        # Apply dropout mask
                        if masks[i - 1] is not None:
                            dz = dz * masks[i - 1] / (1.0 - self.dropout)

                # Gradient clipping
                gW_list, gb_list = self._clip_grads(gW_list, gb_list)

                # Adam update with scheduled LR
                for i in range(L):
                    mW[i] = b1 * mW[i] + (1 - b1) * gW_list[i]
                    vW[i] = b2 * vW[i] + (1 - b2) * (gW_list[i] ** 2)
                    self.W[i] -= current_lr * (mW[i] / (1 - b1 ** t)) / (np.sqrt(vW[i] / (1 - b2 ** t)) + eps)
                    mb[i] = b1 * mb[i] + (1 - b1) * gb_list[i]
                    vb[i] = b2 * vb[i] + (1 - b2) * (gb_list[i] ** 2)
                    self.b[i] -= current_lr * (mb[i] / (1 - b1 ** t)) / (np.sqrt(vb[i] / (1 - b2 ** t)) + eps)

            # Epoch metrics
            tr_pred = self._forward(Xtr).reshape(-1)
            val_pred = self._forward(Xval).reshape(-1)
            tr_loss = self._bce(tr_pred, ytr)
            val_loss = self._bce(val_pred, yval)
            tr_acc = float(np.mean((tr_pred >= 0.5).astype(int) == ytr))
            val_acc = float(np.mean((val_pred >= 0.5).astype(int) == yval))

            self.loss_curve_.append(tr_loss)
            self.val_loss_curve_.append(val_loss)
            self.epoch_metrics_.append({
                "epoch": _ep + 1, "lr": round(current_lr, 6),
                "train_loss": round(tr_loss, 4), "val_loss": round(val_loss, 4),
                "train_acc": round(tr_acc, 4), "val_acc": round(val_acc, 4),
            })

            if val_loss < best_val - 1e-4:
                best_val = val_loss
                best = ([w.copy() for w in self.W], [bb.copy() for bb in self.b])
                bad = 0
            else:
                bad += 1
                if bad >= self.patience:
                    break

        if best is not None:
            self.W, self.b = best

        # sklearn-compatible attributes
        self.coefs_ = self.W
        self.intercepts_ = self.b
        self.n_iter_ = len(self.loss_curve_)
        self.best_val_loss_ = round(float(best_val), 4)
        return self

    def predict_proba(self, X):
        p = self._forward(np.asarray(X, dtype=float)).reshape(-1)
        return np.column_stack([1.0 - p, p])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

    # ── Neuronas muertas ──
    def hidden_activations(self, X):
        a = np.asarray(X, dtype=float)
        outs = []
        for i in range(len(self.W) - 1):
            a = self._gelu(a @ self.W[i] + self.b[i])
            outs.append(a)
        return outs

    def dead_neuron_report(self, X, tol=1e-3):
        """Reporte de neuronas muertas: varianza ≈ 0 → no aporta."""
        layers = []
        for li, A in enumerate(self.hidden_activations(X)):
            std = A.std(axis=0)
            mean_act = np.abs(A).mean(axis=0)
            dead = int(np.sum(std < tol))
            layers.append({
                "layer": li + 1, "units": int(A.shape[1]), "dead": dead,
                "pct_dead": round(100.0 * dead / A.shape[1], 1),
                "mean_activation": round(float(np.abs(A).mean()), 4),
                "min_std": round(float(std.min()), 5),
                "neuron_stds": [round(float(s), 5) for s in std],
                "neuron_means": [round(float(m), 4) for m in mean_act],
            })
        total = sum(l["units"] for l in layers)
        deadt = sum(l["dead"] for l in layers)
        pct = round(100.0 * deadt / total, 1) if total else 0.0
        return {
            "layers": layers, "total_units": total, "total_dead": deadt,
            "pct_dead": pct,
            "healthy": pct <= 5.0,
            "tol": tol,
            "note": ("GELU es suave y no anula neuronas a 0 como ReLU; verificamos "
                     "que ninguna quede inactiva (varianza ≈ 0 en todas las muestras)."),
        }

    def revive_dead_neurons(self, X, tol=1e-3):
        """Reinicializa los pesos de neuronas muertas con perturbación."""
        rng = np.random.default_rng(self.seed + 99)
        revived = 0
        for li, A in enumerate(self.hidden_activations(X)):
            std = A.std(axis=0)
            for j in range(A.shape[1]):
                if std[j] < tol:
                    scale = np.sqrt(2.0 / self.W[li].shape[0])
                    self.W[li][:, j] = rng.normal(0.0, scale, size=self.W[li].shape[0])
                    self.b[li][j] = rng.normal(0.0, 0.01)
                    revived += 1
        self.coefs_ = self.W
        self.intercepts_ = self.b
        return revived

    def get_weights_info(self):
        """Retorna pesos y sesgos para visualización del diagrama."""
        info = {"layers": []}
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            info["layers"].append({
                "weights": W.tolist(),
                "biases": b.tolist(),
                "shape": list(W.shape),
                "weight_stats": {
                    "mean": round(float(W.mean()), 4),
                    "std": round(float(W.std()), 4),
                    "min": round(float(W.min()), 4),
                    "max": round(float(W.max()), 4),
                }
            })
        return info

    # ── Checkpoints ──
    def save_checkpoint(self, path):
        """Guarda estado completo de la red."""
        state = {
            "W": [w.copy() for w in self.W],
            "b": [bb.copy() for bb in self.b],
            "hidden": self.hidden, "epochs": self.epochs,
            "lr": self.lr, "l2": self.l2, "seed": self.seed,
            "loss_curve": getattr(self, "loss_curve_", []),
            "val_loss_curve": getattr(self, "val_loss_curve_", []),
            "best_val_loss": getattr(self, "best_val_loss_", None),
            "n_iter": getattr(self, "n_iter_", 0),
            "saved_at": _dt.datetime.now().isoformat(timespec="seconds"),
        }
        if HAS_JOBLIB:
            joblib.dump(state, path)
        return state["saved_at"]

    def load_checkpoint(self, path):
        """Restaura estado de la red desde checkpoint."""
        if not HAS_JOBLIB or not os.path.exists(path):
            return False
        state = joblib.load(path)
        self.W = state["W"]
        self.b = state["b"]
        self.coefs_ = self.W
        self.intercepts_ = self.b
        self.loss_curve_ = state.get("loss_curve", [])
        self.val_loss_curve_ = state.get("val_loss_curve", [])
        self.best_val_loss_ = state.get("best_val_loss")
        self.n_iter_ = state.get("n_iter", 0)
        return True


def _build_models():
    models = {"logit": LogisticRegression(max_iter=1000, solver="lbfgs")}
    if HAS_XGB:
        models["xgboost"] = XGBClassifier(
            n_estimators=250, max_depth=6, learning_rate=0.08,
            eval_metric="logloss", random_state=42, n_jobs=-1, verbosity=0,
            subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=1.0)
    models["random_forest"] = RandomForestClassifier(
        n_estimators=250, max_depth=12, min_samples_leaf=5,
        random_state=42, n_jobs=-1)
    models["neural_net"] = GeluMLP(
        hidden=(64, 32), epochs=300, lr=0.008, seed=42,
        dropout=0.15, patience=20, warmup_epochs=10)
    return models


PIPELINE_STEPS = [
    {"id": "ingest",   "label": "Ingesta de datos",        "icon": "i-upload"},
    {"id": "clean",    "label": "Limpieza de datos",        "icon": "i-refresh"},
    {"id": "engineer", "label": "Feature engineering",      "icon": "i-network"},
    {"id": "split",    "label": "K-Fold Stratified (k=5)",  "icon": "i-external"},
    {"id": "scale",    "label": "Escalado (StandardScaler)","icon": "i-shield"},
    {"id": "train_lr", "label": "Regresion Logistica",      "icon": "i-cpu"},
    {"id": "train_xgb","label": "XGBoost (gradiente+hessiano)", "icon": "i-cpu"},
    {"id": "train_rf", "label": "Random Forest",            "icon": "i-cpu"},
    {"id": "train_nn", "label": "Red Neuronal GELU+Sigmoide",   "icon": "i-cpu"},
    {"id": "evaluate", "label": "Evaluacion y metricas",    "icon": "i-shield"},
    {"id": "persist",  "label": "Persistir modelo (.pkl)",  "icon": "i-lock"},
]


def _extract_learning(models: dict, columns: list) -> dict:
    """Extrae artefactos interpretables tras entrenar."""
    out = {}
    nn = models.get("neural_net")
    if nn is not None and hasattr(nn, "loss_curve_"):
        lc = [round(float(v), 4) for v in nn.loss_curve_]
        out["nn_loss_curve"] = lc
        out["nn_final_loss"] = (lc[-1] if lc else None)
        out["nn_iters"] = len(lc)
        if hasattr(nn, "val_loss_curve_"):
            out["nn_val_loss_curve"] = [round(float(v), 4) for v in nn.val_loss_curve_]
        if hasattr(nn, "epoch_metrics_"):
            out["nn_epoch_metrics"] = nn.epoch_metrics_
        out["nn_activation"] = "GELU (ocultas) + Sigmoide (salida)"
        out["nn_config"] = {
            "hidden": nn.hidden, "lr": nn.lr, "l2": nn.l2,
            "dropout": nn.dropout, "grad_clip": nn.grad_clip,
            "warmup_epochs": nn.warmup_epochs, "patience": nn.patience,
        }

    if nn is not None and hasattr(nn, "coefs_"):
        layers = [int(nn.coefs_[0].shape[0])] + [int(c.shape[1]) for c in nn.coefs_]
        n_params = int(sum(c.size for c in nn.coefs_) + sum(b.size for b in nn.intercepts_))
        out["nn_arch"] = {"layers": layers, "n_params": n_params}
        out["nn_weights_info"] = nn.get_weights_info()

    logit = models.get("logit")
    if logit is not None and hasattr(logit, "coef_"):
        pairs = [{"feature": c, "label": _friendly(c), "coef": round(float(w), 3),
                  "odds_ratio": round(float(np.exp(w)), 3)}
                 for c, w in zip(columns, logit.coef_[0])]
        pairs.sort(key=lambda d: abs(d["coef"]), reverse=True)
        out["logit_coef"] = pairs[:20]  # top 20
        out["logit_intercept"] = round(float(logit.intercept_[0]), 3)
        out["logit_intercept_or"] = round(float(np.exp(logit.intercept_[0])), 3)
        out["logit_all_coef"] = pairs  # todos los coeficientes

    rf = models.get("random_forest")
    if rf is not None and hasattr(rf, "feature_importances_"):
        agg = {}
        for col, imp in zip(columns, rf.feature_importances_):
            base = col
            for b in (RAW_NUM + RAW_CAT):
                if col == b or col.startswith(b + "_"):
                    base = b
                    break
            agg[base] = agg.get(base, 0.0) + float(imp)
        imp_list = [{"feature": k, "label": FRIENDLY.get(k, k), "importance": round(v, 4)}
                    for k, v in agg.items()]
        imp_list.sort(key=lambda d: d["importance"], reverse=True)
        out["importance"] = imp_list
    return out


def train_and_persist(seed: int = 42, df: "pd.DataFrame" = None,
                      source: str = "seed",
                      on_progress=None) -> dict:
    """Entrena los 4 modelos con k-fold stratified y ensemble ponderado por AUC."""
    from sklearn.model_selection import StratifiedKFold, train_test_split
    from sklearn.metrics import (roc_auc_score, accuracy_score, f1_score,
                                 precision_score, recall_score, confusion_matrix)

    total = len(PIPELINE_STEPS)
    def _p(step_id, detail=""):
        if on_progress:
            idx = next((i for i, s in enumerate(PIPELINE_STEPS) if s["id"] == step_id), 0)
            on_progress(step_id, idx, total, detail)

    _p("ingest", f"Cargando dataset ({source})")
    if df is None:
        df = generate_seed(seed=seed)
    df = df.copy()

    _p("clean", f"{len(df)} filas, {len(df.columns)} columnas")
    y = df[TARGET].astype(int).values
    n_pos = int(y.sum())
    n_neg = int(len(y) - n_pos)

    _p("engineer", f"One-hot encoding de {len(RAW_CAT)} variables categoricas")
    X = _encode(df)
    columns = list(X.columns)

    # ── K-Fold Stratified (k=5) para métricas robustas ──
    _p("split", "Stratified 5-Fold cross-validation")
    kfold = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    fold_metrics = {name: {"auc": [], "accuracy": [], "f1": [], "precision": [], "recall": []}
                    for name in ["logit", "xgboost", "random_forest", "neural_net"]}

    _p("scale", f"StandardScaler sobre {X.shape[1]} features")

    models = _build_models()
    model_keys = list(models.keys())
    # Predicciones out-of-fold → matriz de confusión HONESTA (cada fila predicha por un modelo que NO la vio)
    oof_pred = {name: np.full(len(y), -1, dtype=int) for name in model_keys}

    # Cross-validation para métricas
    for fold_idx, (train_idx, test_idx) in enumerate(kfold.split(X.values, y)):
        Xtr_f, Xte_f = X.values[train_idx], X.values[test_idx]
        ytr_f, yte_f = y[train_idx], y[test_idx]
        scaler_f = StandardScaler().fit(Xtr_f)
        Xtr_fs, Xte_fs = scaler_f.transform(Xtr_f), scaler_f.transform(Xte_f)

        for name in model_keys:
            m_copy = _build_models()[name]  # fresh model per fold
            # Si es NN y tenemos logit, informar con OR
            if name == "neural_net" and "logit" in models and hasattr(models["logit"], "coef_"):
                try:
                    m_copy.set_logit_or(np.exp(models["logit"].coef_[0]))
                except Exception:
                    pass
            try:
                m_copy.fit(Xtr_fs, ytr_f)
                proba = m_copy.predict_proba(Xte_fs)[:, 1]
                preds = (proba >= 0.5).astype(int)
                oof_pred[name][test_idx] = preds
                fold_metrics[name]["auc"].append(float(roc_auc_score(yte_f, proba)))
                fold_metrics[name]["accuracy"].append(float(accuracy_score(yte_f, preds)))
                fold_metrics[name]["f1"].append(float(f1_score(yte_f, preds, zero_division=0)))
                fold_metrics[name]["precision"].append(float(precision_score(yte_f, preds, zero_division=0)))
                fold_metrics[name]["recall"].append(float(recall_score(yte_f, preds, zero_division=0)))
            except Exception:
                for mk in fold_metrics[name]:
                    fold_metrics[name][mk].append(0.5 if mk == "auc" else 0.0)

    # Average metrics from k-fold
    metrics = {}
    for name in model_keys:
        metrics[name] = {
            k: round(float(np.mean(v)), 3)
            for k, v in fold_metrics[name].items()
        }
        metrics[name]["auc_std"] = round(float(np.std(fold_metrics[name]["auc"])), 3)

    # ── Entrenamiento final en TODO el dataset ──
    step_map = {"logit": "train_lr", "random_forest": "train_rf",
                "xgboost": "train_xgb", "neural_net": "train_nn"}
    friendly_names = {"logit": "Regresion Logistica", "random_forest": "Random Forest",
                      "xgboost": "XGBoost", "neural_net": "Red Neuronal"}

    scaler_full = StandardScaler().fit(X.values)
    X_scaled = scaler_full.transform(X.values)

    # Entrenar logit primero para extraer OR
    _p(step_map["logit"], f"Entrenando {friendly_names['logit']}...")
    models["logit"].fit(X_scaled, y)

    # Extraer OR para informar la NN
    or_weights = np.exp(models["logit"].coef_[0])

    for name in model_keys:
        if name == "logit":
            continue  # ya entrenado
        _p(step_map.get(name, "train_lr"), f"Entrenando {friendly_names.get(name, name)}...")
        if name == "neural_net":
            models[name].set_logit_or(or_weights)
        models[name].fit(X_scaled, y)

    scaler = scaler_full

    # ── Matriz de confusión HONESTA: predicciones out-of-fold (datos que el modelo NO vio) ──
    for name in model_keys:
        try:
            mask = oof_pred[name] >= 0            # solo filas realmente predichas en su fold de test
            metrics[name]["confusion_matrix"] = confusion_matrix(y[mask], oof_pred[name][mask]).tolist()
        except Exception:
            pass

    # ── Pesos del ensemble por PERICIA sobre el azar (AUC−0.5) ──
    # Un modelo ~aleatorio (AUC≈0.5) pesa ~0; el mejor domina → mejor precisión del ensemble.
    skill = {name: max(metrics[name]["auc"] - 0.5, 0.0) for name in model_keys}
    total_skill = sum(skill.values())
    if total_skill <= 1e-8:
        ensemble_weights = {name: round(1.0 / len(model_keys), 3) for name in model_keys}
    else:
        ensemble_weights = {name: round(s / total_skill, 3) for name, s in skill.items()}

    # Artefactos de aprendizaje
    learning = _extract_learning(models, columns)
    nn = models.get("neural_net")
    if nn is not None and hasattr(nn, "dead_neuron_report"):
        try:
            learning["dead_neurons"] = nn.dead_neuron_report(scaler.transform(X.values))
        except Exception:
            pass

    _p("evaluate", "Calculando metricas finales y rangos")
    ranges = {c: {"min": float(X[c].min()), "max": float(X[c].max()),
                  "mean": float(X[c].mean()), "median": float(X[c].median())}
              for c in columns}

    _p("persist", "Guardando jnus_bundle.pkl")
    bundle = {
        "models": models, "scaler": scaler, "columns": columns,
        "ranges": ranges, "metrics": metrics,
        "raw_num": RAW_NUM, "raw_cat": RAW_CAT,
        "approval_rate": float(y.mean()),
        "class_distribution": {"aprobado": n_pos, "rechazado": n_neg},
        "n_features": int(X.shape[1]),
        "version": _dt.datetime.now().strftime("v%Y.%m.%d-%H%M"),
        "dataset_size": int(len(df)),
        "trained_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "source": source,
        "learning": learning,
        "ensemble_weights": ensemble_weights,
    }
    if HAS_JOBLIB:
        joblib.dump(bundle, BUNDLE_PATH)
    return bundle


_TARGET_MAP = {
    "1": 1, "0": 0, "si": 1, "sí": 1, "no": 0, "yes": 1, "true": 1, "false": 0,
    "aprobado": 1, "aprobada": 1, "rechazado": 0, "rechazada": 0, "negado": 0,
    "approved": 1, "denied": 0, "default": 0, "pago": 1, "impago": 0, "y": 1, "n": 0,
}


def _normalize_target(s: "pd.Series") -> "pd.Series":
    def conv(v):
        if pd.isna(v):
            return np.nan
        sv = str(v).strip().lower()
        if sv in _TARGET_MAP:
            return _TARGET_MAP[sv]
        try:
            return 1 if float(sv) >= 0.5 else 0
        except Exception:
            return np.nan
    return s.map(conv)


def retrain_from_dataframe(df: "pd.DataFrame", source: str = "upload") -> dict:
    """Reentrena el motor de PRODUCCIÓN desde un dataset del admin."""
    required = set(RAW_NUM + RAW_CAT + [TARGET])
    missing = required - set(df.columns)
    if missing:
        raise ValueError("Faltan columnas requeridas: " + ", ".join(sorted(missing)))

    df = df.copy()
    df[TARGET] = _normalize_target(df[TARGET])
    df = df.dropna(subset=[TARGET])
    if df.empty:
        raise ValueError("No se pudo interpretar la columna 'aprobado'.")
    df[TARGET] = df[TARGET].astype(int)
    if df[TARGET].nunique() < 2:
        raise ValueError("El dataset debe incluir casos aprobados Y rechazados.")
    for c in RAW_NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[RAW_NUM] = df[RAW_NUM].fillna(df[RAW_NUM].median(numeric_only=True))
    for c in RAW_CAT:
        df[c] = df[c].astype(str).replace({"nan": "NA", "None": "NA", "": "NA"}).fillna("NA")

    bundle = train_and_persist(df=df, source=source)
    ENGINE.bundle = bundle
    return bundle


REQUIRED_COLUMNS = RAW_NUM + RAW_CAT + [TARGET]


# ──────────────────────────────────────────────────────────────────────────────
# 3) MOTOR DE INFERENCIA (singleton)
# ──────────────────────────────────────────────────────────────────────────────
class JanusEngine:
    def __init__(self):
        self._bundle = None
        self.loaded_at = None

    @property
    def bundle(self):
        return self._bundle

    @bundle.setter
    def bundle(self, value):
        self._bundle = value
        try:
            if os.path.exists(BUNDLE_PATH):
                self.loaded_at = os.path.getmtime(BUNDLE_PATH)
            else:
                self.loaded_at = None
        except Exception:
            self.loaded_at = None

    def ready(self) -> bool:
        return self._bundle is not None

    def bootstrap(self):
        """Carga modelos persistidos o los entrena si no existen."""
        if HAS_JOBLIB and os.path.exists(BUNDLE_PATH):
            try:
                self._bundle = joblib.load(BUNDLE_PATH)
                self.loaded_at = os.path.getmtime(BUNDLE_PATH)
                return self._bundle
            except Exception:
                pass
        self.bundle = train_and_persist()
        return self._bundle

    def _row(self, payload: dict) -> pd.DataFrame:
        d = {
            "edad": float(payload.get("edad", 35)),
            "ingresos_mensuales": float(payload.get("ingresos_mensuales", 800)),
            "cargas_familiares": float(payload.get("cargas_familiares", 0)),
            "creditos_activos": float(payload.get("creditos_activos", 0)),
            "monto_solicitado": float(payload.get("monto_solicitado", 5000)),
            "antiguedad_laboral": float(payload.get("antiguedad_laboral", 3)),
            "tasa_interes": float(payload.get("tasa_interes", 15.0)),
            "plazo_meses": float(payload.get("plazo_meses", 24)),
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

    def _weighted_prob(self, per_model: dict) -> float:
        """Ensemble ponderado por AUC."""
        weights = self.bundle.get("ensemble_weights", {})
        if not weights:
            return float(np.mean(list(per_model.values())))
        total_w = 0.0
        weighted_sum = 0.0
        for name, prob in per_model.items():
            w = weights.get(name, 1.0 / len(per_model))
            weighted_sum += prob * w
            total_w += w
        return weighted_sum / max(total_w, 1e-8)

    def score(self, payload: dict) -> dict:
        if not self.ready():
            self.bootstrap()
        else:
            if HAS_JOBLIB and os.path.exists(BUNDLE_PATH):
                try:
                    mtime = os.path.getmtime(BUNDLE_PATH)
                    if self.loaded_at is None or mtime > self.loaded_at:
                        self._bundle = joblib.load(BUNDLE_PATH)
                        self.loaded_at = mtime
                except Exception:
                    pass
        b = self.bundle
        df = self._row(payload)
        X = _encode(df, columns=b["columns"])
        Xs = b["scaler"].transform(X.values)

        per_model = self._prob_all(Xs)
        prob = self._weighted_prob(per_model)  # Ensemble ponderado por AUC

        # XAI: contribuciones del modelo logístico
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

        recs = self._recommendations(payload, prob)

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
            "ensemble_weights": b.get("ensemble_weights", {}),
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
            per_model = self._prob_all(Xs)
            return self._weighted_prob(per_model)

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

        # 3) incrementar ingresos
        ing = float(payload.get("ingresos_mensuales", 800))
        alt = dict(payload); alt["ingresos_mensuales"] = ing * 1.25
        d = prob_of(alt) - base_prob
        if d > 0.01:
            recs.append({
                "icon": "💵",
                "text": f"Demostrar ingresos un 25% mayores elevaría tu aprobación ~{d*100:.0f}%.",
                "gain": round(d * 100, 1)})

        # 4) reducir monto solicitado
        monto = float(payload.get("monto_solicitado", 5000))
        if monto > 1000:
            alt = dict(payload); alt["monto_solicitado"] = monto * 0.7
            d = prob_of(alt) - base_prob
            if d > 0.01:
                recs.append({
                    "icon": "📉",
                    "text": f"Solicitar un 30% menos (${monto*0.7:,.0f}) mejoraría tu aprobación ~{d*100:.0f}%.",
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
