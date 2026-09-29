# Apple Finanças

MVP web local de finanças em formato de chat. A aplicação guarda mensagens, movimentações e comprovantes no próprio computador. Carteiras de conta corrente, poupança e investimentos mantêm saldos separados; transferências entre elas não alteram os relatórios de renda e gastos. O modelo local interpreta pedidos; os totais dos relatórios são calculados pelo SQLite.

## Requisitos

- macOS com Node.js 24 ou mais recente e npm.
- Para usar no celular: ambos os aparelhos na mesma rede Wi-Fi. O HTTPS de desenvolvimento usa certificados locais gerados por OpenSSL, sem Homebrew.
- Para transcrever áudio: o instalador local compila `whisper.cpp` e baixa o modelo multilíngue quantizado `medium-q5_0` (cerca de 515 MB), com melhor reconhecimento em português. Reserve aproximadamente 1 GB livre para compilação e modelo.
- Para interpretação flexível dos pedidos: Ollama com `gemma3:4b` (cerca de 3,3 GB). O modelo é opcional; regras locais tratam registros comuns e relatórios mesmo sem ele.

## Início rápido

```sh
npm install
cp .env.example .env.local
```

Edite `.env.local` e defina `APP_ACCESS_PASSWORD` com uma senha privada de pelo menos 12 caracteres. Para gerar uma senha aleatória, execute `openssl rand -base64 32` e copie o resultado para esse arquivo. Não compartilhe o arquivo; ele está ignorado pelo Git.

Inicie o app no computador:

```sh
npm run dev
```

Abra `http://localhost:3000`, entre com a senha e comece pelo chat. Sem Ollama, frases simples como “Gastei R$ 50 no mercado” e relatórios básicos usam um interpretador local por regras. No macOS, OCR de imagens e PDFs digitalizados usa Vision e PDFKit do próprio sistema.

## Ferramentas locais de IA

```sh
npm run ai:setup
```

O instalador compila Whisper e prepara o OCR do macOS dentro de `.data/`, sem permissões administrativas nem alterações no Homebrew. Baixe o aplicativo oficial do [Ollama para macOS](https://ollama.com/download), mova `Ollama.app` para `~/Applications` e abra o aplicativo. Depois, baixe o modelo de interpretação:

```sh
ollama pull gemma3:4b
```

Ao iniciar o Ollama, ele mantém a API local disponível em `127.0.0.1:11434`. Gemma recebe instruções delimitadas para interpretar registros, recorrências, filtros de relatório e pedidos de orientação. Ele retorna JSON validado pelo servidor; saldos e relatórios são calculados pelo SQLite. Áudio gravado no app é convertido no próprio navegador para WAV mono de 16 kHz e transcrito com Whisper. PDFs pesquisáveis usam extração de texto local; PDFs digitalizados e imagens passam pelo Vision e, quando disponível, pelo modelo visual. Mensagens, anexos e inferência ficam no computador por padrão.

Formatos aceitos: PDF, JPEG, PNG, WebP, HEIC, WebM, OGG, MP4/M4A, MP3 e WAV. Máximo de quatro arquivos por mensagem, 20 MB por arquivo e 30 MB combinados. O processamento de PDF digitalizado cobre as cinco primeiras páginas; PDFs com texto pesquisável podem ser extraídos por inteiro.

## Acesso pelo celular na rede local

Áudio no navegador exige HTTPS quando a página é acessada pelo IP do computador. `dev:lan` cria certificados de desenvolvimento locais, sem instalar ferramentas no sistema.

1. Execute `npm run dev:lan` no computador.
2. Compartilhe por AirDrop somente o certificado público `.data/certs/lan-ca.crt` com o celular. No iPhone, instale o perfil e habilite confiança total em **Ajustes › Geral › Sobre › Ajustes de Confiança de Certificados**. No Android, instale a CA nas credenciais do usuário; os nomes das telas variam por fabricante.
3. Abra o endereço HTTPS que o terminal mostrar e entre com a senha local.

Nunca copie nem compartilhe `.data/certs/lan-ca-key.pem`. O certificado serve apenas para desenvolvimento local. O servidor fica disponível na rede enquanto `dev:lan` estiver executando; mantenha a senha privada.

## Dados e backup

- Banco: `.data/apple.sqlite`; anexos: `.data/attachments/`.
- Backup local do banco e dos anexos: `npm run db:backup`. Guarde a pasta `backup-*` em um local seguro.
- `npm test` executa os testes de regras financeiras e recorrências.
- O desenvolvimento local não acessa contas bancárias nem envia documentos a serviços externos.

## Publicação futura

O deploy na Vercel é uma etapa posterior à aprovação deste MVP. Antes dele, migrar o repositório SQLite para banco PostgreSQL hospedado, os arquivos locais para armazenamento persistente, a inferência Ollama/Whisper para serviços hospedados e adicionar autenticação adequada a usuários públicos. A Vercel não garante persistência de arquivos SQLite nas funções serverless.
