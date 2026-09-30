# Apple Finanças

App de finanças pessoais em formato de chat, preparado para múltiplas contas com Supabase Auth, Postgres e Storage privados. A publicação planejada é `https://app.arcadya.cc`, com a aplicação na Discloud e OCR, transcrição e IA executados por um worker no computador local conectado.

## Ambiente

- Node.js 24 ou mais recente.
- Projeto Supabase com a migration deste repositório aplicada.
- Resend com `arcadya.cc` verificado para e-mails de confirmação e recuperação.
- Discloud com subdomínio reservado e variáveis de produção cadastradas pelo painel.
- Para processar mensagens: computador local ligado, Ollama com `gemma3:4b`, `whisper-cli` e modelo Whisper, FFmpeg, Tesseract e Poppler (`pdftotext` e `pdftoppm`).

## Configurar o Supabase

Copie `.env.example` para `.env.local` e preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `WORKER_TOKEN`. Gere o token do worker com 32 bytes aleatórios. A chave `service_role` fica apenas no servidor e nos scripts administrativos de backup/migração; nunca a copie para `.worker.env` ou para o navegador.

Na organização Supabase, crie o projeto em São Paulo (`sa-east-1`) e aplique `supabase/migrations/20260930113454_finance_multitenant_auth.sql`:

```sh
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Configure no painel Supabase **Authentication → URL Configuration**:

- Site URL: `https://app.arcadya.cc`
- Redirect URLs: `https://app.arcadya.cc/**`, `http://localhost:3000/**` e `http://127.0.0.1:3000/**`

Em **Authentication → SMTP Settings**, use o SMTP da Resend (`smtp.resend.com`, porta 465, usuário `resend`, senha igual à chave `RESEND_API_KEY`) e o remetente `no-reply@arcadya.cc`. Verifique o domínio e seus registros DNS na Resend antes de testar cadastro ou recuperação. O bloco SMTP em `supabase/config.toml` serve ao ambiente local; o SMTP do projeto hospedado também precisa ser configurado no painel.

Cada novo cadastro confirmado recebe categorias padrão e uma carteira principal pelo trigger da migration. O login usa e-mail e senha; confirmação de e-mail, recuperação e troca de senha passam pelo Supabase Auth.

## Executar o site

```sh
npm install
npm run dev
```

Abra `http://localhost:3000`. Crie a primeira conta pela tela de cadastro e confirme o link recebido por e-mail. O build de produção pode ser verificado com `npm run build`; a aplicação inicia na porta 8080 com `npm start`.

## Worker local de IA

O worker recebe tarefas autenticadas, baixa anexos por URLs assinadas de curta duração, processa tudo em arquivos temporários e envia ao servidor somente o texto extraído e a interpretação. Ele não precisa de URL do banco nem da chave `service_role`.

1. Copie `.worker.env.example` para `.worker.env` no computador que executará a IA.
2. Coloque nele o mesmo `WORKER_TOKEN` cadastrado no servidor e defina `WORKER_URL` como a URL pública do app.
3. Instale nesse computador as ferramentas locais de OCR, áudio e IA listadas acima. Defina `WHISPER_MODEL` para o caminho do modelo Whisper.
4. Inicie o worker:

```sh
npm install
npm run worker:local
```

O worker consulta a fila a cada três segundos e remove os arquivos temporários após cada tarefa. Em Windows, configure a inicialização do worker pelo Agendador de Tarefas para mantê-lo ativo depois do login. O setup `npm run ai:setup` prepara as ferramentas do macOS; em Windows, instale os executáveis compatíveis e deixe-os disponíveis no `PATH`.

Se o worker estiver desligado, a mensagem fica aguardando processamento. O app não envia anexos ou texto financeiro a uma API externa de IA.

## Migração dos dados SQLite existentes

Mantenha uma cópia do banco local antes de migrar:

```sh
npm run db:backup
```

Crie e confirme uma conta no novo app. Em `.env.local`, defina `MIGRATION_EMAIL` com o e-mail dessa conta. Depois rode:

```sh
npm run db:migrate-supabase
```

O script associa categorias e a carteira principal existentes, envia os anexos ao bucket privado e copia mensagens, movimentações, transferências, ajustes, regras e recorrências. Ele não apaga o SQLite local; se a migração for interrompida, pode ser executado novamente.

## Backup e restauração criptografados

O plano Supabase Free não inclui backups automáticos baixáveis. O backup deste app é criado no computador confiável e criptografado com AES-256-GCM.

1. Copie `.backup.env.example` para `.backup.env`.
2. Configure URL, chave `service_role` e uma senha aleatória forte. Guarde a senha fora do computador; sem ela, não há restauração.
3. Crie o arquivo criptografado:

```sh
npm run db:backup-supabase
```

Para restaurar em um projeto com a mesma migration aplicada, use o arquivo `.jsonl.enc` produzido em `.data/backups`:

```sh
RESTORE_CONFIRM=RESTORE npm run db:restore-supabase -- .data/backups/ARQUIVO.jsonl.enc
```

A restauração é aditiva e exige a senha correta. Contas recriadas recebem senhas temporárias aleatórias; cada pessoa deve usar **Esqueci minha senha** para definir uma nova. Guarde apenas a cópia local criptografada conforme a decisão do beta; perdê-la pode impedir a recuperação. `.backup.env`, `.worker.env` e os arquivos de backup não devem ser enviados à hospedagem nem ao Git.

## Publicação na Discloud e domínio

O `discloud.config` prepara o build de Next.js na porta 8080, com 1 GB de RAM e reinício automático. Cadastre no painel da Discloud as variáveis públicas do Supabase e as chaves secretas de servidor; não inclua arquivos `.env` no pacote. Reserve primeiro o subdomínio configurado como `ID=arcadya-finances` e publique a aplicação nesse endereço.

Depois, no painel Discloud → **Domains**, associe `app.arcadya.cc`, siga os registros TXT de verificação e A exibidos para o seu domínio e faça rebuild do app após a validação. O domínio customizado depende do plano Diamond ou superior. O painel da Discloud é a fonte dos valores TXT/A e pode mostrá-los por aplicação.

## Contas e privacidade

- Cada conta só consulta dados próprios, protegidos por RLS no banco e bucket privado no Storage.
- Limites beta: até 25 contas, 30 MB armazenados por conta, 100 MB processados por conta/mês, 20 MB por arquivo e até quatro anexos por mensagem.
- **Conta e dados** permite baixar um JSON com registros e anexos ou excluir a conta.
- [Aviso de privacidade](/privacy) e [termos do beta](/terms) descrevem armazenamento e processamento. Configure `NEXT_PUBLIC_PRIVACY_EMAIL` e complete a identificação legal de quem opera o serviço antes da abertura pública.

O Supabase Free custa US$ 0/mês, mas pode pausar projetos após uma semana com pouca atividade e não oferece backup automático baixável. O orçamento e os limites de armazenamento devem ser revistos antes de passar do beta.
