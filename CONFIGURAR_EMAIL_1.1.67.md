# Configurar validação por e-mail — Na Régua 1.1.67

A versão 1.1.67 não precisa mais da API do WhatsApp para liberar a fidelidade. O código de 6 dígitos é enviado pelo próprio Supabase Auth.

## 1. Atualizar o banco

No Supabase, abra **SQL Editor > New query**, cole o conteúdo de `ATUALIZAR_BANCO_1.1.67.sql` e execute.

## 2. Ativar login por e-mail

No Supabase, abra **Authentication > Providers > Email** e deixe o provedor de e-mail habilitado.

## 3. Fazer o Supabase mandar código de 6 dígitos

Abra **Authentication > Email Templates**.

Nos templates usados para acesso por e-mail, principalmente **Magic Link** e **Confirm signup**, deixe a mensagem mostrando o token de confirmação `{{ .Token }}` em vez de depender somente do link `{{ .ConfirmationURL }}`.

Exemplo de corpo simples:

```html
<h2>Seu código Na Régua</h2>
<p>Use este código para validar seu e-mail e liberar o programa de fidelidade:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>Se você não solicitou este código, ignore esta mensagem.</p>
```

O cliente receberá um código numérico e o digitará diretamente em **4. Seus dados**.

## 4. Teste

1. Abra o link público da barbearia.
2. Escolha serviço, barbeiro, data e horário.
3. Em **4. Seus dados**, informe nome, WhatsApp/telefone e e-mail.
4. Toque em **Enviar código por e-mail**.
5. Abra o e-mail recebido, copie os 6 números e toque em **Validar código**.
6. Deve aparecer **E-mail validado. Fidelidade liberada!**.
7. O agendamento pode ser feito mesmo sem validar. Nesse caso o QR de chegada funciona normalmente, mas a visita não soma fidelidade.

## 5. Produção

Para testes, o envio padrão do Supabase pode ser suficiente. Para uso com muitos clientes, configure um SMTP próprio em **Project Settings / Authentication / SMTP** para melhorar limite de envio, reputação e entrega dos e-mails.

## Não é mais necessário

A validação de fidelidade da 1.1.67 não usa mais:

- Meta WhatsApp Cloud API
- WABA
- token do WhatsApp
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- Edge Function `whatsapp-verification`

O WhatsApp cadastrado na barbearia continua existindo normalmente como telefone de contato.
