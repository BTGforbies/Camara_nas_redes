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

`lib/ai.ts` cria o cliente somente no servidor e aponta para `https://api.groq.com/openai/v1`. A chave usada é `GROQ_API_KEY` e não há seleção de provedor na interface. A aplicação repete temporariamente solicitações limitadas pela cota gratuita e não habilita ferramentas externas do modelo.

## Geração do PDF

O PDF é criado no backend com `pdf-lib`. O algoritmo controla margens, quebra de linhas e criação de páginas, mas não adiciona capa, cabeçalho, rodapé ou paginação. Apenas as cinco respostas principais validadas entram no documento.

O documento recebe somente os títulos das sete seções e as respostas confirmadas. Prompts, formulário, dados brutos, histórico e detalhes técnicos não entram no arquivo.

## Privacidade

Não há banco de dados, autenticação ou armazenamento permanente. O CSV ou Excel é processado no navegador; o contexto necessário segue para a API escolhida durante a geração. O sistema não registra credenciais nem o conteúdo da proposta.
