# Decisões técnicas

## Arquitetura

A aplicação usa React 19, Next.js 16 e Vinext em um único projeto. As telas ficam no frontend e as credenciais permanecem em rotas de backend. Essa separação evita expor chaves e mantém a execução local simples: um único `npm run dev`.

## Leitura de CSV e Excel

O SheetJS lê `.csv`, `.xlsx` e `.xls` no navegador. Antes da leitura, o sistema confere extensão, tamanho e estrutura inicial. Para arquivos Excel, valida as assinaturas ZIP ou OLE; para CSV, rejeita conteúdo binário disfarçado de texto. Tabelas vazias são ignoradas; as demais preservam a representação exibida de datas, moedas, números e percentuais. O sistema não executa macros nem conteúdo incorporado.

O pré-processamento identifica colunas comuns de autor, texto, canal e pontos de engajamento. Textos idênticos do mesmo autor recebem uma pré-marcação de repetição sem serem removidos. Linhas sem campos essenciais recebem sinal de possível corrupção.

## Execução dos prompts

Os sete comandos estão centralizados em `lib/prompts.ts`. Cada definição declara suas dependências. O navegador chama o backend uma seção por vez, o que permite mostrar progresso real, preservar respostas concluídas e repetir apenas a seção que falhou.

Os dados das células são tratados como evidência não confiável. Uma regra de sistema proíbe obedecer a comandos eventualmente inseridos na tabela, reduzindo risco de prompt injection.

## Integração de IA

`lib/ai.ts` chama o endpoint `generateContent` do Google Gemini somente no servidor. A chave usada é `GEMINI_API_KEY` e não há seleção de provedor na interface. A classificação em massa e as consolidações usam `gemini-3.5-flash-lite`; ranking, redações e chat usam `gemini-3.6-flash`. A aplicação repete falhas temporárias com espera progressiva e não envia ferramentas externas ao modelo.

Os lotes possuem até 20 mil caracteres e são consolidados hierarquicamente. O conteúdo total reconhecido pode chegar a 10 milhões de caracteres, mas cada solicitação recebe somente o lote necessário. Essa combinação reduz o número de chamadas sem reenviar a base inteira aos comandos qualitativos.

## Geração do PDF

O PDF é criado no backend com `pdf-lib`. O algoritmo controla margens, quebra de linhas e criação de páginas, mas não adiciona capa, cabeçalho, rodapé ou paginação. Apenas as cinco respostas principais validadas entram no documento.

O documento recebe somente os títulos das sete seções e as respostas confirmadas. Prompts, formulário, dados brutos, histórico e detalhes técnicos não entram no arquivo.

## Privacidade

Não há banco de dados, autenticação ou armazenamento permanente. O CSV ou Excel é processado no navegador; o contexto necessário segue para a API escolhida durante a geração. O sistema não registra credenciais nem o conteúdo da proposta.
