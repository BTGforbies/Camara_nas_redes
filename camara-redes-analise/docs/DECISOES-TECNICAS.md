# Decisões técnicas

## Arquitetura

A aplicação usa React 19, Next.js 16 e Vinext em um único projeto. As telas ficam no frontend e as credenciais permanecem em rotas de backend. Essa separação evita expor chaves e mantém a execução local simples: um único `npm run dev`.

## Leitura do Excel

O SheetJS lê `.xlsx` e `.xls` no navegador. Antes da leitura, o sistema confere a extensão e a assinatura binária do arquivo. Planilhas vazias são ignoradas; as demais preservam a representação exibida de datas, moedas, números e percentuais. O sistema não executa macros nem conteúdo incorporado.

O pré-processamento identifica colunas comuns de autor, texto, canal e pontos de engajamento. Textos idênticos do mesmo autor recebem uma pré-marcação de repetição sem serem removidos. Linhas sem campos essenciais recebem sinal de possível corrupção.

## Execução dos prompts

Os sete comandos estão centralizados em `lib/prompts.ts`. Cada definição declara suas dependências. O navegador chama o backend uma seção por vez, o que permite mostrar progresso real, preservar respostas concluídas e repetir apenas a seção que falhou.

Os dados das células são tratados como evidência não confiável. Uma regra de sistema proíbe obedecer a comandos eventualmente inseridos na planilha, reduzindo risco de prompt injection.

## Integração de IA

`lib/ai.ts` cria o cliente somente no servidor. A OpenAI usa o endpoint padrão. A xAI usa o mesmo SDK com `baseURL=https://api.x.ai/v1`. O provedor e o modelo são selecionáveis sem mudar os prompts.

## Geração do PDF

O PDF é criado no backend com `pdf-lib`. O algoritmo controla margens, quebra de linhas, criação de páginas, prevenção de título isolado, rodapé e numeração. A imagem de cabeçalho pode ser carregada na interface ou definida como `public/report-header.png`.

O documento recebe somente os títulos das sete seções e as respostas confirmadas. Prompts, formulário, dados brutos, histórico e detalhes técnicos não entram no arquivo.

## Privacidade

Não há banco de dados, autenticação ou armazenamento permanente. O Excel é processado no navegador; o contexto necessário segue para a API escolhida durante a geração. O sistema não registra credenciais nem o conteúdo da proposta.

