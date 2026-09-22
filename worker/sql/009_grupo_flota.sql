-- =====================================================================================================
-- TM2 Sur · 009_grupo_flota.sql — columna `grupo` en la flota (tierras | drenajes) · D190, sep-2026
-- Separa la flota por DISCIPLINA/dueño de la máquina (tierras vs drenajes), una dimensión ORTOGONAL a
-- `frente` (que es la UF: UF1-UF2 / UF3). Motivo: hoy una máquina de drenajes (p. ej. el turbo del
-- ingeniero de drenajes) puesta en UF1-UF2 se pide a diario en el parte como si fuera de tierras; con
-- `grupo` el Parte agrupa «Equipos sin parte» por disciplina y la pantalla de Flota filtra/etiqueta.
-- UF3 queda fuera de esta separación a propósito (decisión del dueño): sigue viviendo en `frente`.
--
-- Se aplica DESPUÉS de 001_esquema.sql y 002_fases_3_4.sql. Idempotente (ADD COLUMN IF NOT EXISTS +
-- ON CONFLICT): correrlo dos veces no cambia nada ni falla. En producción la tabla `maquinas` YA existe
-- (la edita la pantalla de Flota / el Table Editor), así que este ALTER es la ÚNICA vía para que reciba
-- la columna. **Aplícalo ANTES de desplegar el Worker nuevo** (la lectura de flota tolera que falte —
-- flotaFilas_ cae a un SELECT sin `grupo`—, pero el alta con grupo necesita la columna).
-- Probado para Postgres 16 (Supabase) y PGlite (worker/pruebas). Sin CHECK a propósito, como `frente`:
-- el valor se normaliza en el código (normGrupo_) y un valor desconocido se conserva y se avisa.
-- =====================================================================================================

BEGIN;

ALTER TABLE maquinas ADD COLUMN IF NOT EXISTS grupo text NOT NULL DEFAULT 'tierras';
COMMENT ON COLUMN maquinas.grupo IS 'tierras | drenajes (D190): disciplina/dueño de la máquina; ORTOGONAL a frente (UF). El Parte agrupa «Equipos sin parte» por este valor; las estancias viejas quedan en tierras (DEFAULT). Marca las de drenajes en la pantalla de Flota o en el Table Editor.';

INSERT INTO esquema_version (version, nota)
  VALUES (9, '009_grupo_flota.sql · columna grupo en maquinas (tierras/drenajes), D190')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
