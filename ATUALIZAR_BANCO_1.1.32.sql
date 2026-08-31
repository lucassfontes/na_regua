-- Na Régua 1.1.32
-- Liga cada comanda ao agendamento/cliente correspondente.

alter table public.commands
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

create index if not exists commands_appointment_idx
  on public.commands (tenant_id, appointment_id);

-- Um agendamento pode ter somente uma comanda dentro da mesma barbearia.
create unique index if not exists commands_one_per_appointment_idx
  on public.commands (tenant_id, appointment_id)
  where appointment_id is not null;
