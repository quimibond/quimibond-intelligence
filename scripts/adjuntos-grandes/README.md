# Adjuntos grandes (GitHub Actions)

La Edge Function `attachments-extract` tiene 2 s de CPU por invocación y por
eso salta a propósito los archivos grandes. Este extractor corre en GitHub
Actions (`.github/workflows/adjuntos-grandes.yml`, a los :17 y :47 de cada
hora, 25 min por corrida) y lee lo que ella saltó:

| `skip_reason` | Qué era | De dónde se baja |
|---|---|---|
| `too_large` | más de 3 MB, nunca se bajó | Gmail |
| `cpu_limit` (`failed`) | reventó la CPU tres veces | Gmail |
| `pdf_too_large`, `sheet_too_large` | PDF o Excel de más de 2 MB | Storage (`email-attachments`) |

Resultado en la misma fila de `email_attachments`, como si la Edge Function lo
hubiera leído: `done` con `extracted_text` (hasta 600k caracteres; en Excel
las hojas chicas primero), o `skipped` con `pdf_sin_texto` (PDF escaneado) o
`no_extractor` (zip, pptx, video…), o `failed` con `grande_error` y el motivo
en `last_error`. Nada vuelve a la cola solo. El archivo no se sube a Storage.
Solo correos de 2026. Cada corrida deja una fila en `pipeline_logs` con
`phase = 'attachments_extract_grandes'` y `details.runtime = 'github'`.

**Secreto del repo:** `SUPABASE_SERVICE_ROLE_KEY`. La cuenta de servicio de
Google se lee de Vault (`edge_secret('google_service_account_json')`).

**A mano:** Actions → «Adjuntos grandes» → Run workflow; con
`gmail_message_ids` lee solo esos correos y con `dry_run = 1` solo lista.

**Reintentar algo que falló:**
`update email_attachments set extract_status = 'skipped', skip_reason = 'too_large' where id = …;`

**Pruebas:** `pip install -r requirements.txt && python -m pytest -q` (corren en CI).
