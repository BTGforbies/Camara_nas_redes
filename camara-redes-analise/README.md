# Câmara nas Redes - Análise de Propostas

Sistema web independente para ler uma base de proposta em CSV ou Excel, combinar os registros com o contexto informado, executar os sete comandos do relatório **Câmara nas Redes**, permitir revisão manual e gerar um PDF A4 apenas com os resultados aprovados.

## O que já funciona

- Upload por seleção ou arrastar e soltar de `.csv`, `.xlsx` e `.xls`;
- Validação da extensão, assinatura real, tamanho, corrupção e conteúdo vazio;
- Leitura da tabela CSV e de todas as planilhas do Excel com dados utilizáveis;
- Reconhecimento de cabeçalhos e pré-marcação de repetidos do mesmo autor;
- Sinalização de linhas possivelmente corrompidas;
- Formulário enxuto com nome do projeto, ficha de tramitação, situação, assunto, contexto e quadro de engajamento por canal;
- Execução sequencial dos sete comandos;
- Seleção entre **Grok/xAI** e **OpenAI**;
- Regeneração de uma única resposta ou de toda a análise;
- Edição manual, restauração e confirmação da versão final;
- PDF A4 com cabeçalho opcional, paginação e somente os resultados aprovados;
- Interface responsiva e acessível por teclado;
- Testes automatizados para CSV, Excel, prompts, PDF e renderização principal.

## Rodar no VS Code - Windows

### 1. Requisitos

- Node.js 22.13 ou superior;
- VS Code;
- Uma chave da xAI, da OpenAI ou de ambas.

### 2. Instalação

Abra a pasta do projeto no VS Code. No terminal integrado, execute:

```powershell
npm install
Copy-Item .env.example .env.local
```

Abra o arquivo `.env.local` e preencha uma das chaves:

```env
XAI_API_KEY=sua_chave_xai
```

ou:

```env
OPENAI_API_KEY=sua_chave_openai
```

Não coloque aspas e não envie esse arquivo para outra pessoa. O `.gitignore` impede que `.env.local` seja versionado.

### 3. Iniciar

```powershell
npm run dev
```

Abra o endereço informado no terminal. A tela mostra automaticamente quais APIs estão configuradas.

## Rodar no GitHub Codespaces

Abra a pasta do projeto no terminal do Codespaces e execute:

```bash
npm install
cp .env.example .env.local
npm run dev -- --host 0.0.0.0
```

Antes do último comando, abra `.env.local`, configure sua chave e salve. Quando o Codespaces detectar a porta do sistema, mantenha-a privada e clique em **Abrir no navegador**. A configuração do Vite aceita os endereços `github.dev` e não depende da pasta oculta `.openai` para iniciar.

## Imagem no topo do relatório

Há duas formas de adicionar a imagem:

1. Na etapa **Informar contexto**, clique em **Selecionar PNG ou JPG**. Essa imagem será usada apenas naquele relatório.
2. Para deixá-la como padrão, salve a imagem com o nome abaixo:

```text
public/report-header.png
```

Ao abrir o sistema, esse arquivo será carregado automaticamente. Use PNG ou JPG, preferencialmente horizontal, com até 5 MB. Enquanto a imagem definitiva não estiver nessa pasta, o PDF usa um cabeçalho tipográfico limpo.

## Escolha da API

O backend usa o SDK oficial da OpenAI para as duas integrações. A xAI oferece compatibilidade com o endpoint `https://api.x.ai/v1`; por isso, o código altera apenas a chave, o endereço e o modelo conforme o motor escolhido na tela.

Variáveis principais:

| Variável | Uso | Padrão |
| --- | --- | --- |
| `XAI_API_KEY` | Chave da API Grok/xAI | sem valor |
| `XAI_MODEL` | Modelo da xAI | `grok-4.6` |
| `OPENAI_API_KEY` | Chave da API OpenAI | sem valor |
| `OPENAI_MODEL` | Modelo da OpenAI | `gpt-5.6` |
| `AI_REQUEST_TIMEOUT_MS` | Tempo máximo de cada comando | `240000` |
| `AI_MAX_CONTEXT_CHARS` | Limite do contexto enviado à IA | `2000000` |
| `NEXT_PUBLIC_MAX_FILE_MB` | Limite do CSV ou Excel | `25` |

Uma assinatura do ChatGPT não fornece automaticamente créditos de API. Para usar a integração OpenAI, crie uma chave e configure faturamento na plataforma da API.

## Comandos

```bash
npm run dev       # desenvolvimento
npm run build:local # compilação local, inclusive no Windows
npm run build     # compilação verificada em Linux/CI
npm run start     # executar a compilação
npm run lint      # análise estática
npm test          # testes + build + verificação do HTML
npm run test:unit # somente testes rápidos
```

## Fluxo de dados

1. O navegador valida e lê o CSV ou Excel com SheetJS.
2. Todas as tabelas utilizáveis viram um contexto textual estruturado.
3. O backend recebe o contexto e executa cada comando na ordem correta.
4. A chave de API permanece no servidor e nunca é enviada ao navegador.
5. O usuário revisa e confirma os textos.
6. O backend gera o PDF com `pdf-lib` e devolve o arquivo ao navegador.

Não há autenticação, cadastro ou banco de dados. Os dados ficam na memória da página durante o uso e não são salvos pelo sistema.

## Estrutura principal

```text
app/
  api/analyze/route.ts   integração segura com as APIs
  api/config/route.ts    informa quais motores estão configurados
  api/pdf/route.ts       gera o documento final
  globals.css            identidade visual e responsividade
  page.tsx               rota principal
components/
  analysis-workspace.tsx fluxo completo das cinco etapas
lib/
  ai.ts                  abstração Grok/OpenAI
  pdf.ts                 composição e paginação A4
  prompts.ts             sete comandos e suas dependências
  types.ts               contratos de dados
  workbook.ts            validação e leitura de CSV e Excel
tests/                   testes automatizados
docs/                    decisões técnicas e relatório de testes
```

## Limitações conhecidas

- A IA precisa receber o texto dos registros; bases acima do limite configurado são bloqueadas com uma mensagem clara, sem truncamento silencioso.
- A detecção automática de autor, texto, canal e pontos de engajamento depende dos nomes das colunas. Quando não há correspondência, todas as colunas ainda seguem para análise e um aviso é mostrado.
- A qualidade das classificações depende do modelo escolhido e da clareza dos dados. A revisão humana continua obrigatória antes da confirmação.
- As chamadas reais não fazem parte dos testes automatizados para evitar consumo de créditos.

Consulte [docs/DECISOES-TECNICAS.md](docs/DECISOES-TECNICAS.md) e [docs/TESTES.md](docs/TESTES.md) para mais detalhes.
