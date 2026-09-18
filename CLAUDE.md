# CLAUDE.md — cómo trabajar en este repo (TM2 Sur / GALCA)

> Este archivo lo lee Claude Code automáticamente al abrir el proyecto. Resume **cómo quiere trabajar
> el dueño** y dónde está el conocimiento. El detalle del sistema vive en `/docs`.

## Empieza por aquí
- **Lee primero `docs/PROJECT_CONTEXT.md`** (resumen de todo el sistema) y sigue `docs/PROJECT_INSTRUCTIONS.md`.
- Decisiones cerradas → `docs/02_REGISTRO_DECISIONES.md`. Alcance → `docs/03_BACKLOG.md`. Operación/despliegue → `docs/OPERACIONES.md`.
- Idioma de trabajo: **español**.

## Cómo quiere trabajar el dueño (César)
- **Claude hace TODO por él: git, GitHub, commits, ramas, PRs y despliegues.** El dueño NO quiere teclear
  comandos. Cuando algo requiera un comando, **córrelo tú** (no se lo dejes de tarea) y explícale en pasos
  simples y cortos qué está pasando. Evita jerga; él no es experto en git/terminal.
- **GitHub es el centro.** Clonar, crear rama, commitear, push y abrir PR desde Claude. Cada tarea:
  desarrollar en una rama, commit claro, push, y (si lo pide) abrir PR hacia `main`.
- Confirma antes de acciones destructivas o hacia afuera (merge/borrado/mandar datos), salvo que ya lo haya autorizado.

## Dos entornos (MUY importante)
1. **PC personal** de César: tiene acceso total (admin). Ahí se puede instalar lo que sea.
2. **PC de la empresa (donde trabaja CASI SIEMPRE): NO tiene permisos de administrador.**
   Tiene **Node.js PORTABLE** y Claude instalado.
   - **No propongas nada que requiera admin** (instaladores del sistema, `winget` que pida elevación,
     servicios). Usa lo portable y el espacio de usuario.
   - Ejecuta herramientas con **`npx`** sobre el Node portable (p. ej. `npx wrangler …`) en vez de
     instalaciones globales.
   - Si falta **git**, usar **Git portable / PortableGit** (no requiere admin), no un instalador con elevación.
   - Preferir siempre lo que se pueda hacer desde la **web** (GitHub para merge/PR, Supabase SQL Editor y
     Table Editor, pantallas de la app) para no depender de la terminal cuando se pueda evitar.

## Despliegue del proyecto (backend vivo = Worker + Supabase, D180)
No hay CI/CD: los despliegues son manuales y los hace Claude. Cuando haya cambios que publicar, hay hasta
**tres superficies** (detalle en `docs/OPERACIONES.md`):
1. **Frontend** (HTML/JS/CSS) → GitHub **Pages** en `tm2.galca.app` (repo con `CNAME`): se publica al
   llevar el código a `main` (merge del PR). Sin comandos.
2. **Worker** (`worker/`) → **`npx wrangler deploy`** (necesita `npx wrangler login` una vez; los secretos
   ya están en Cloudflare desde el corte D180, no se re-cargan). Es lo único que sí necesita terminal.
3. **Base de datos** (Supabase/Postgres) → migraciones `worker/sql/00N_*.sql` en el **SQL Editor** de
   Supabase (o `psql`). Aplicar la migración **ANTES** de desplegar el Worker que la usa.
Los `backend/*.gs` están **congelados** (referencia/rollback); no se tocan para funcionalidad nueva.

## Reglas del proyecto (resumen; ver PROJECT_INSTRUCTIONS)
- No reinventar funcionalidades fuera del backlog; una idea nueva se propone como ítem V2/V3.
- No replantear decisiones cerradas (D01…); si se cambia una, actualizar `02_REGISTRO_DECISIONES.md`.
- El dueño valida con datos reales antes de dar algo por cerrado.
- Al cerrar un cambio: actualizar los `/docs` afectados (decisión → 02, regla → PROJECT_CONTEXT, ítem → 03)
  y listar los archivos modificados.
