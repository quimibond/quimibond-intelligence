-- Quién atiende a cada empresa según el correo (180 días) y quién atiende cada
-- tipo de pendiente por empresa (365 días). Lo consume Odoo (qb_memoria) cada
-- noche para proponer dueños de obligaciones; la persona detrás de cada buzón
-- compartido se resuelve en Odoo (qb.memoria.mailbox).
-- Aplicada en producción el 2026-09-17 (MCP apply_migration memoria_encargados_view).
create or replace view public.memoria_encargados as
with tipo_area as (
  select * from (values
    ('promesa_pago', 'finanzas'), ('compromiso_entrega', 'comercial'), ('cotizacion', 'comercial'),
    ('solicitud_documento', 'comercial'), ('rfq', 'compras')) as t(tipo, area)
), internos as (
  select e.company_id,
         lower(split_part(regexp_replace(e.sender, '^.*<([^>]+)>.*$', '\1'), ' ', 1)) as mailbox,
         e.email_date
  from public.emails e
  where e.sender_type = 'internal' and e.company_id is not null
    and e.email_date > now() - interval '180 days'
), por_empresa as (
  select company_id, null::text as area, mailbox, count(*)::int as n, max(email_date) as last_at
  from internos
  where mailbox <> 'info@quimibond.com' and mailbox not like 'noreply%' and mailbox not like 'no-reply%'
  group by 1, 2, 3
), por_area as (
  select p.company_id, ta.area, lower(p.account) as mailbox, count(*)::int as n, max(p.detected_at) as last_at
  from public.email_pending_actions p
  join tipo_area ta on ta.tipo = p.tipo
  where p.company_id is not null and p.account is not null
    and p.detected_at > now() - interval '365 days'
  group by 1, 2, 3
), todo as (
  select * from por_empresa union all select * from por_area
)
select c.odoo_partner_id, t.company_id, t.area, t.mailbox, t.n, t.last_at,
       round(100.0 * t.n / sum(t.n) over (partition by t.company_id, t.area))::int as share,
       row_number() over (partition by t.company_id, t.area order by t.n desc, t.last_at desc)::int as rank
from todo t
join public.companies c on c.id = t.company_id
where c.odoo_partner_id is not null;

comment on view public.memoria_encargados is
  'Buzón interno que más atiende a cada empresa (area null, correo 180 d) y por tipo de pendiente (area, 365 d). rank 1 = principal; share = % del total.';
