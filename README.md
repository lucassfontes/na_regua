# Barber SaaS — versão HTML + CSS + JavaScript

Esta é a conversão do projeto Next.js para um front-end estático. Não existe build, React ou Node.js no front-end.

## O que continua existindo

- Supabase Auth
- PostgreSQL + RLS
- Multi-tenant por `tenant_id`
- Super Admin
- Dono
- Barbeiro
- Agendamento público
- Expiração e suspensão de tenants
- Prevenção de overbooking no PostgreSQL
- PWA (`manifest.json` + `service-worker.js`)
- Layout responsivo para celular e desktop

## Estrutura

- `login.html` — autenticação
- `super-admin.html` — administração geral
- `admin.html` — painel do dono
- `barber.html` — painel do profissional
- `agendar.html?slug=barbearia-x` — agendamento público
- `assinatura-vencida.html` — bloqueio de dono/barbeiro
- `agendamentos-indisponiveis.html` — tenant público bloqueado
- `css/` — estilos
- `js/` — JavaScript do navegador
- `supabase/migrations/001_schema.sql` — banco principal
- `supabase/migrations/002_html_rpc.sql` — RPCs para o front-end HTML
- `supabase/migrations/003_public_booking_barber_selection.sql` — seleção pública de barbeiro
- `supabase/migrations/004_products_commands.sql` — produtos e comandas
- `supabase/functions/admin-actions/` — operações que precisam da Admin API do Supabase Auth

## 1. Criar/configurar Supabase

No SQL Editor execute, nessa ordem:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_html_rpc.sql`
3. `supabase/migrations/003_public_booking_barber_selection.sql`
4. `supabase/migrations/004_products_commands.sql`
5. Opcional: `supabase/cron.sql`

Depois crie seu usuário no Supabase Auth e use `supabase/bootstrap_super_admin.sql` para torná-lo Super Admin. Em **Authentication > URL Configuration**, adicione a URL pública do seu site e `login.html` nas URLs de redirecionamento permitidas, para que os convites de Barbeiros retornem ao sistema corretamente. O Dono criado pelo Super Admin recebe uma senha definida no próprio cadastro e pode entrar imediatamente.

## 2. Configurar o HTML

Edite `js/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'SUA_CHAVE_PUBLICAVEL_OU_ANON',
  APP_NAME: 'Barber SaaS'
}
```

Use somente a **Publishable Key / anon key**. Nunca coloque `service_role` ou Secret Key em `config.js`.

## 3. Publicar a Edge Function

A criação de Donos e Barbeiros precisa da Supabase Auth Admin API. Por segurança isso não pode ficar no HTML. O Super Admin define a senha inicial do Dono; ela é enviada à Edge Function e usada diretamente no Supabase Auth, sem ser salva nas tabelas.

Com Supabase CLI:

```bash
supabase functions deploy admin-actions
```

A função usa os secrets padrão do ambiente do Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`).

## 4. Rodar localmente sem Node

Você não deve abrir os arquivos apenas com `file://`, porque PWA/service worker exigem HTTP/HTTPS.

Se possui Python:

```bash
cd barber-saas-html
python3 -m http.server 8080
```

Abra:

```text
http://localhost:8080/login.html
```

Também pode colocar a pasta diretamente em Apache/Nginx/XAMPP ou hospedar em Netlify, Cloudflare Pages, GitHub Pages etc.

## 5. Link público

Exemplo universal:

```text
https://seu-dominio.com/agendar.html?slug=barbearia-x
```

Em Apache, o `.htaccess` incluído também permite o endereço mais bonito:

```text
https://seu-dominio.com/barbearia-x
```

A página chama RPCs públicas controladas no PostgreSQL. O cliente não recebe acesso direto às tabelas de agendamento.

## Segurança

- A chave publicável do Supabase pode ficar no navegador desde que RLS e grants estejam corretos.
- `service_role` nunca vai para o HTML.
- Criação de acesso de Donos e convites de Barbeiros são executados pela Edge Function `admin-actions`.
- Renovação, suspensão e alteração de vencimento usam RPCs que verificam `is_super_admin()`.
- Agendamento anônimo passa por RPC `SECURITY DEFINER`, com validação de tenant, serviço, barbeiro, horário e conflito.
- A constraint `appointments_no_overlap` continua sendo a defesa final contra duas reservas simultâneas.

## Observação sobre HTML puro

O **front-end é HTML/CSS/JS puro**, mas um SaaS seguro não pode ter todo o backend em HTML. Supabase continua responsável por autenticação, banco, RLS, funções e convites de usuários.

## Atualização: senha definida pelo Super Admin para o Dono

No cadastro de uma nova barbearia, o Super Admin agora informa:
- Nome do Dono
- E-mail do Dono
- Senha do Dono
- Confirmação da senha

A senha precisa ter pelo menos 6 caracteres e não é gravada na tabela `public.users`. Ela é enviada à Edge Function `admin-actions`, que cria o usuário diretamente no Supabase Auth com `email_confirm: true`. Assim, o Dono já pode entrar em `login.html` usando o e-mail e a senha definidos pelo Super Admin.

### IMPORTANTE para quem publica a Edge Function manualmente no Dashboard

Depois de atualizar os arquivos do site, abra **Supabase > Edge Functions > admin-actions > Code**, substitua o código pelo conteúdo atualizado de:

`supabase/functions/admin-actions/index.ts`

Depois clique em **Deploy updates**. Se a função antiga continuar publicada, o novo campo de senha não funcionará.


## Versão 1.1.5

- Novo barbeiro agora é criado com e-mail e senha definidos pelo dono.
- Acesso do barbeiro é criado diretamente no Supabase Auth e confirmado imediatamente.
- A lista da equipe ganhou o botão **Editar**.
- O dono pode editar nome, e-mail, comissão, status ativo/inativo e definir uma nova senha para o barbeiro.
- A nova senha é opcional durante a edição e nunca é armazenada em tabelas públicas.
- É necessário republicar a Edge Function `admin-actions` após atualizar os arquivos.


### Correção 1.1.5
- Corrigido o envio do formulário Novo barbeiro quando o botão Criar barbeiro não era localizado pelo JavaScript.
- Botão agora usa `type="submit"` e `id="createBarberBtn"`.
- JavaScript usa `e.submitter` com fallback seguro, evitando `Cannot set properties of null`.


## Versão 1.1.8

- O card **Link público** do painel do dono agora usa automaticamente o slug da barbearia atualmente logada.
- Botão **Acessar** abre diretamente o agendamento público dessa barbearia.
- Botão **Copiar** copia o link público para a área de transferência.
- Cache do PWA atualizado para 1.1.8.


## Versão 1.1.10

- Super Admin agora possui botão **Excluir** em cada barbearia.
- A exclusão pede confirmação digitando **EXCLUIR**.
- Ao confirmar, remove o painel do dono e toda a hierarquia do tenant: dono, barbeiros, serviços, vínculos, folgas, agendamentos, notificações e eventos de assinatura.
- Os usuários da hierarquia também são removidos do Supabase Auth para liberar os e-mails.
- O link público deixa de funcionar assim que a barbearia é excluída.
- O novo ícone enviado foi aplicado aos ícones PWA/favicon.
- Cache PWA atualizado para 1.1.10.

### IMPORTANTE

Para o botão **Excluir** funcionar, é obrigatório republicar a Edge Function:

```bash
supabase functions deploy admin-actions
```

Se publicar pelo Dashboard, substitua o código de `supabase/functions/admin-actions/index.ts` na função `admin-actions` e clique em **Deploy updates**.


## Versão 1.1.11

- Botões de ação das barbearias organizados um abaixo do outro.
- Novo modal **Editar** no ADM Geral.
- Permite alterar nome da barbearia, senha do dono, data de vencimento e valor da mensalidade.
- A nova senha é opcional; em branco mantém a senha atual.
- Atualização de senha é feita com segurança pela Edge Function `admin-actions`.
- Cache PWA atualizado para 1.1.11.


## Versão 1.1.12

- O modal **Editar** do ADM Geral agora permite editar todos os dados principais da barbearia e do dono.
- Campos editáveis: nome da barbearia, slug, nome do dono, e-mail do dono, nova senha, data de vencimento, mensalidade e timezone.
- Alterar o slug atualiza o endereço público da barbearia.
- Alterar nome/e-mail/senha do dono atualiza também o Supabase Auth.
- A senha continua opcional: em branco mantém a senha atual.
- Validação impede slug ou e-mail duplicados.
- Cache PWA atualizado para 1.1.12.

### IMPORTANTE

Para os novos campos de edição funcionarem, republique a Edge Function `admin-actions` desta versão.

## Versão 1.1.14

- O slug agora é gerado automaticamente a partir do nome da barbearia.
- Espaços e acentos são convertidos para um formato válido de URL.
- Exemplo: `Na Régua Barbearia` gera `na-regua-barbearia`.
- No modal Editar, ao alterar o nome da barbearia, o slug acompanha automaticamente.
- A mesma regra foi aplicada ao cadastro de nova barbearia para evitar divergências.
- Cache PWA atualizado para 1.1.14.


## Versão 1.1.14

- O termo técnico “Slug” foi trocado na interface por **Nome do link**, deixando o cadastro e a edição mais fáceis de entender.
- O campo continua automático e é usado no endereço público de agendamento.
- Na lista de barbearias, o valor agora aparece identificado como **Link**.
- Cache PWA atualizado para 1.1.14.


## Versão 1.1.21

- Campo de link automático removido dos formulários de criar e editar barbearia.
- O slug continua sendo gerado internamente pelo nome da barbearia, sem exigir nenhuma ação do usuário.
- Cache PWA atualizado para 1.1.21.


## Versão 1.1.21
- Link público automático baseado no nome da barbearia, sem espaços.
- Exemplo: `Berbe Shop` → `berbeshop`.
- Links antigos são sincronizados automaticamente ao abrir o ADM Geral.


## Versão 1.1.21
- Corrige a sincronização automática dos links públicos pelo nome da barbearia usando a Edge Function administrativa.
- O slug passa a ser derivado no servidor; o usuário não precisa preencher nem editar esse campo.

## Versão 1.1.22

- No painel do dono, o plano/vencimento foi movido para a barra de navegação superior.
- Removido o botão “Editar barbearia” da área de visão geral.
- A área “Link público” não exibe mais a URL; mantém somente os botões “Abrir agendamento” e “Copiar link”.
- Cache PWA atualizado para 1.1.22.

## Versão 1.1.25
- Menu de usuário criado no painel do dono.
- Configurações, instalação do app, link público e saída reunidos no menu de usuário.
- Ações rápidas simplificadas para tarefas operacionais.
- Cache PWA atualizado para 1.1.25.


## Versão 1.1.25
- Informações do plano adicionadas ao menu de usuário do painel do dono.
- Exibe mensalidade e data de vencimento dentro do menu.
- O plano permanece também na barra superior.
- Cache PWA atualizado para 1.1.25.


## Versão 1.1.27
- Versão do sistema exibida abaixo do botão “Sair da conta” no menu do dono.
- Separador visual adicionado para manter o rodapé do menu organizado.
- Cache PWA atualizado para 1.1.27.

## Versão 1.1.27
- Menu do usuário do painel do dono agora se ajusta ao tamanho do conteúdo e da tela.
- Textos longos quebram corretamente sem sair do menu.
- Em telas pequenas, o menu ocupa somente o espaço disponível e ganha rolagem interna quando necessário.
- Cache PWA atualizado para 1.1.27.


## Versão 1.1.28

- A área **Vincular serviço** voltou a ficar diretamente no painel do dono, como nas versões anteriores.
- Novo cadastro de **Produtos**, com nome, preço, status e edição.
- O painel do barbeiro ganhou **Comandas**.
- Cada comanda recebe um número automático, pode ter nome do cliente e permite adicionar/remover produtos e quantidades.
- A comanda mostra o total em tempo real e pode ser finalizada.
- Adicionada a migration `supabase/migrations/004_products_commands.sql`.
- Cache PWA atualizado para 1.1.28.

### IMPORTANTE — ativar Produtos e Comandas

Em um projeto Supabase já existente, execute somente:

```sql
-- conteúdo de supabase/migrations/004_products_commands.sql
```

Você pode abrir o arquivo, copiar todo o conteúdo e executar em **Supabase > SQL Editor**. Não é necessário republicar a Edge Function para esta versão.


## Versão 1.1.29

- Adicionado **Editar** na lista de serviços.
- O modal de serviço agora permite alterar nome, preço, duração e status.
- **Vincular serviço** voltou a funcionar em modal, removendo o formulário fixo do painel.
- No agendamento público, somente barbeiros realmente vinculados ao serviço aparecem para o cliente.
- Não exige alteração no banco nem republicação da Edge Function.

## Versão 1.1.32

- A vinculação de serviços foi integrada ao cadastro e à edição do barbeiro.
- Agora é possível marcar vários serviços de uma só vez.
- Ao editar, marcar adiciona um vínculo e desmarcar remove o vínculo do barbeiro.
- O botão/modal separado **Vincular serviço** foi removido para simplificar o painel.
- A lista da equipe mostra os serviços de cada barbeiro.
- Barbeiros só aparecem no agendamento público dos serviços aos quais estão vinculados.
- Não exige alteração no banco nem republicação da Edge Function.

## Versão 1.1.32
- Padronizado o menu de usuário entre os painéis do Dono, Barbeiro e ADM Geral.
- Painel do Barbeiro agora usa avatar, nome, menu responsivo, atualizar agenda, instalar aplicativo e sair da conta.
- ADM Geral agora usa o mesmo padrão visual, com avatar, nome, atualizar painel, instalar aplicativo e sair da conta.
- A versão do sistema passou a aparecer no rodapé dos menus dos três painéis.


## Versão 1.1.32

A agenda do barbeiro agora é centrada no cliente. Cada agendamento abre sua própria comanda automaticamente, sem cadastro manual do nome. A comanda mostra o serviço, permite adicionar produtos e soma serviço + produtos no total. Execute `ATUALIZAR_BANCO_1.1.32.sql` no Supabase antes de usar a nova integração.


## Versão 1.1.33

Correção do carregamento de produtos na comanda do barbeiro. Os produtos ativos cadastrados pelo dono passam a ser carregados de forma independente das comandas e são atualizados novamente ao abrir cada comanda. Também foi adicionada uma política/função segura no Supabase para garantir que o barbeiro veja somente os produtos ativos da própria barbearia.

Execute `ATUALIZAR_BANCO_1.1.33.sql` no Supabase para aplicar a correção de permissão dos produtos.

## Versão 1.1.34

- A comanda do cliente agora permite **adicionar serviços adicionais** durante o atendimento.
- O barbeiro só pode escolher serviços ativos que estejam **vinculados ao próprio perfil** pelo dono.
- O serviço principal do agendamento permanece separado e não é duplicado na lista de serviços extras.
- Serviços adicionais podem ser adicionados novamente (a quantidade é acumulada) ou removidos enquanto a comanda estiver aberta.
- O total da comanda passa a somar **serviço agendado + serviços adicionais + produtos**.
- Adicionada a migration `supabase/migrations/007_command_extra_services.sql`.

### IMPORTANTE — ativar serviços extras na comanda

Em um projeto Supabase já existente, execute o arquivo `ATUALIZAR_BANCO_1.1.34.sql` em **Supabase > SQL Editor**.


## Versão 1.1.35

- Na agenda do barbeiro, quando o cliente ainda não possui comanda, o botão aparece como **Abrir comanda**.
- Depois que a comanda é aberta, o botão do cliente muda automaticamente para **Fechar comanda**.
- Ao fechar a comanda, o sistema pede confirmação, finaliza a comanda e marca o atendimento como concluído.
- Comandas já finalizadas aparecem como **Comanda fechada**.
- Não exige alteração no banco nem republicação da Edge Function.


## Versão 1.1.38

- O botão **Comanda fechada** continua disponível no painel do barbeiro.
- Ao clicar, abre um modal solicitando a **senha do dono da barbearia**.
- A senha é validada com segurança pela Edge Function `admin-actions`; ela não é salva no navegador nem no banco.
- Com a senha correta, a comanda volta para **Aberta**, o atendimento volta para **Em atendimento** e a comanda é aberta automaticamente para edição.
- Esta versão não exige alteração de banco. É necessário republicar `supabase/functions/admin-actions/index.ts`.


## Versão 1.1.39

- Modal único de mensagens para sucesso, atenção e erro.
- Removidas notificações temporárias soltas do canto da tela.
- Confirmação de fechamento da comanda usa modal próprio do sistema.
- Mensagens de erro do login seguem o mesmo padrão.
- Sem alteração de banco ou Edge Function.


## Atualização 1.1.40

- Modal de mensagens passa a abrir acima de todos os outros modais.
- Cliques fora de qualquer modal não fecham mais a janela.
- ESC também não fecha modais; use os botões da própria janela.
- Não requer SQL nem republicação de Edge Function.

## Versão 1.1.41

- Criado o **Financeiro completo** no painel do dono.
- Filtros por período e barbeiro, resumo de faturamento, serviços, produtos, comissões e líquido após comissão.
- Relatório por barbeiro mostra quanto cada profissional faturou e ganhou em comissão.
- Relatório detalhado mostra cliente, comanda, serviços, produtos, total e divisão do valor.
- Exportação em CSV.
- O fechamento da comanda passa a guardar uma fotografia dos totais e da comissão vigente no momento do fechamento.
- A comissão é aplicada somente sobre serviços; produtos ficam integralmente para a barbearia.

### IMPORTANTE — ativar o financeiro

Execute `ATUALIZAR_BANCO_1.1.41.sql` em **Supabase > SQL Editor**. Não é necessário republicar a Edge Function nesta versão.


## Versão 1.1.42

O painel do dono foi reorganizado em abas para reduzir a quantidade de cards e informações exibidas ao mesmo tempo.

- Removidos da tela principal os cards de **Agendamento / Link público** e **Ações rápidas**.
- Nova navegação: **Visão geral**, **Financeiro**, **Serviços**, **Produtos** e **Barbeiros**.
- Os indicadores da Visão geral servem como atalhos para as áreas correspondentes.
- O link público continua acessível pelo menu do usuário.
- Não exige alteração no banco nem republicação de Edge Function.

## Versão 1.1.43
- Melhorias específicas para o painel do dono no celular.
- Cards da Visão geral reorganizados em grade 2x2, mais compactos e com área de toque melhor.
- Cards financeiros otimizados para leitura em telas pequenas.
- Listas de Serviços, Produtos e Barbeiros passam a aparecer como cards no mobile, sem tabela larga horizontal.
- Botões e textos ajustados para melhor responsividade e legibilidade.


## Versão 1.1.44
- No Financeiro mobile, **Atendimentos/comandas** fica ao lado de **Comissão da equipe**.
- Cadastro e edição de produtos agora possuem **Valor de custo** e **Preço de venda**.
- A lista de produtos mostra **Custo**, **Venda** e **Lucro unitário**.
- Execute `ATUALIZAR_BANCO_1.1.44.sql` no Supabase para adicionar o campo de custo.
- Não exige republicação da Edge Function.

## Versão 1.1.45
- Adicionado **estoque atual** e **estoque mínimo** em cada produto.
- Novo modal **Controle de estoque** com entrada, saída/perda e ajuste do saldo por conferência.
- Histórico das últimas movimentações de cada produto.
- Resumo com unidades em estoque, produtos com estoque baixo, valor de custo e potencial de venda.
- Ao lançar um produto em uma comanda, o estoque é baixado automaticamente; ao remover o item, a quantidade é devolvida.
- O barbeiro só pode adicionar produtos com saldo disponível e o banco bloqueia venda acima do estoque.
- Execute `ATUALIZAR_BANCO_1.1.45.sql` no Supabase. Não exige republicação da Edge Function.


## Versão 1.1.47
- O menu do painel do barbeiro ganhou **Abrir minha agenda** e **Copiar link da agenda**.
- O link é específico do barbeiro e abre o agendamento público já direcionado para esse profissional.
- Não exige atualização de banco nem Edge Function.

## Versão 1.1.48
- Na **Minha Agenda**, em telas mobile, o botão **Concluir atendimento** agora ocupa a mesma largura do botão da comanda.
- No modal **Instalar aplicativo** do iPhone/iPad, o botão **Entendi** agora fica centralizado no mobile.
- Não exige atualização de banco nem republicação da Edge Function.


## Atualização 1.1.49

- Correção do botão **Entendi** centralizado no modal de instalação do iPhone/iPad.
- Instruções manuais aparecem somente quando o aparelho é iPhone/iPad.
- Android e PC continuam usando o prompt nativo de instalação PWA.
- O botão de instalação fica oculto quando o app já está instalado.


## Atualização 1.1.60

- A navegação por abas do painel do dono virou um carrossel horizontal no padrão do VALLE no celular.
- O botão ativo é centralizado automaticamente.
- É possível arrastar/deslizar a navegação com o dedo com movimento suave.
- O toque continua abrindo a aba normalmente, sem conflito com o gesto de arrastar.
- No computador o layout continua estável e adequado à largura disponível.
- Não exige atualização de banco nem Edge Function.


## Atualização 1.1.56
- Dashboard do dono reorganizado para mostrar informações úteis sem precisar abrir outras abas.
- Novo resumo do dia com agenda, aguardando, em atendimento, concluídos e faturamento de hoje.
- Novo card de próximo atendimento com horário, cliente, serviço e barbeiro.
- Novos destaques do mês com barbeiro de maior faturamento, comissão da equipe e ticket médio.
- Alerta de estoque baixo integrado à Visão geral e atalho direto para Produtos.
- Visual otimizado para celular e desktop, usando Bootstrap Icons.
- Não exige alteração no banco nem Edge Function.


## Versão 1.1.60 — Fidelidade e QR de chegada
- Criado programa de fidelidade configurável pelo dono: ativar/desativar, quantidade de visitas necessárias e nome da recompensa.
- Nova aba **Fidelidade** no painel do dono, com clientes, progresso, visitas validadas, recompensas disponíveis e resgate de recompensa.
- Cada agendamento público passa a gerar um **QR Code de chegada** e um código curto de segurança.
- No painel do barbeiro, o botão **Validar chegada** abre a câmera para ler o QR; também existe digitação manual do código como alternativa.
- A chegada validada pode iniciar o atendimento e, quando a fidelidade estiver ativa, soma exatamente uma visita ao cartão do cliente.
- No celular do cliente, o site guarda um token privado no aparelho e mostra **histórico de cortes/agendamentos**, progresso da fidelidade, recompensas e o QR dos próximos atendimentos.
- Execute `ATUALIZAR_BANCO_1.1.60.sql` no Supabase. Não exige republicação da Edge Function.


## Atualização 1.1.60
- Corrigida a abertura da câmera para validar QR Code no celular.
- O sistema solicita a permissão e prioriza a câmera traseira.
- Melhor compatibilidade com Safari/iPhone e Chrome/Android.
- Adicionado botão para tentar abrir a câmera novamente.
- Adicionado fallback "Ler QR pela câmera", usando a câmera nativa do aparelho para fotografar o QR quando o scanner em tempo real não abrir.
- Mensagens específicas para HTTPS, permissão negada e câmera ocupada.
