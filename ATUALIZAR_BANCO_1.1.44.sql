-- Na Régua 1.1.44
-- Adiciona valor de custo aos produtos.

alter table public.products
  add column if not exists cost_cents integer not null default 0 check (cost_cents >= 0);

comment on column public.products.cost_cents is 'Valor de custo do produto em centavos';
