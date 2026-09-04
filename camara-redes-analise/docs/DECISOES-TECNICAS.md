# Decisões técnicas

## Arquitetura

A aplicação usa React 19, Next.js 16 e Vinext em um único projeto. As telas ficam no frontend e as credenciais permanecem em rotas de backend. Essa separação evita expor chaves e mantém a execução local simples: um único `npm run dev`.

## Leitura de CSV e Excel

O SheetJS lê `.csv`, `.xlsx` e `.xls` no navegador. Antes da leitura, o sistema confere extensão, tamanho e estrutura inicial. Para arquivos Excel, valida as assinaturas ZIP ou OLE; para CSV, rejeita conteúdo binário disfarçado de texto. Tabelas vazias são ignoradas; as demais preservam a representação exibida de datas, moedas, números e percentuais. O sistema não executa macros nem conteúdo incorporado.

O pré-processamento identifica colunas comuns de autor, texto, canal, pontos de engajamento, link e título. Quando há mais de uma coluna textual, a aplicação prioriza o texto completo ou o comentário, evitando classificar repetidamente a publicação original. Textos idênticos do mesmo autor recebem uma pré-marcação de repetição sem serem removidos. Linhas sem campos essenciais recebem sinal de possível corrupção.

## Execução da análise

As sete saídas visíveis continuam separadas, mas a IA trabalha em apenas duas fases. Primeiro, `openai/gpt-oss-20b` classifica pequenos lotes em JSON e extrai todos os argumentos distintos expressos em cada postagem ou comentário. Depois, `openai/gpt-oss-120b` recebe métricas, o mapa completo dos argumentos, exemplos compactos dos cinco mais frequentes e o contexto público dos links para gerar o ranking e os cinco textos em uma chamada. Somas, percentuais, repetidos, linhas corrompidas, canais e autores são calculados no navegador.

## Contexto dos links

A aplicação reconhece URLs na planilha, na ficha de tramitação e no contexto informado. Consulta no máximo 12 links públicos, prioriza os links inseridos diretamente no formulário e usa somente HTML ou texto. Endereços locais, IPs literais, credenciais e portas não públicas são bloqueados; cada página possui limites de tempo, redirecionamento e leitura. Título, descrição e trecho curto ajudam principalmente a redigir “O que mobilizou”. Uma página inacessível não interrompe a classificação nem é tratada como fato confirmado.

Os dados das células são tratados como evidência não confiável. Uma regra de sistema proíbe obedecer a comandos eventualmente inseridos na tabela, reduzindo risco de prompt injection.

## Integração de IA

`lib/ai.ts` chama `https://api.groq.com/openai/v1/chat/completions` somente no servidor. A chave usada é `GROQ_API_KEY` e não há seleção de provedor na interface. As respostas usam Structured Outputs em modo estrito, não habilitam ferramentas externas e ocultam o raciocínio do modelo. A aplicação repete falhas temporárias com espera progressiva.

Os lotes possuem cerca de 10 mil caracteres, no máximo 20 postagens e nunca precisam de consolidação textual por IA. Cada postagem usa id neutro e até 900 caracteres. Se a API recusar um lote, o navegador o divide ao meio automaticamente.

## Geração do PDF

O PDF é criado no backend com `pdf-lib`. O algoritmo controla margens, quebra de linhas e criação de páginas, mas não adiciona capa, cabeçalho, rodapé ou paginação. Apenas as cinco respostas principais validadas entram no documento.

O documento recebe somente o ranking e os cinco textos confirmados. Prompts, formulário, tabelas automáticas, dados brutos, histórico e detalhes técnicos não entram no arquivo.

## Privacidade

Não há banco de dados, autenticação ou armazenamento permanente. O CSV ou Excel é processado no navegador. Antes da classificação, URLs, e-mails, telefones, CPF e perfis iniciados por `@` são removidos; autores, canais e engajamento não seguem nos lotes. A redação final recebe agregados, até três exemplos anonimizados por tema e extratos compactos de fontes públicas. A organização deve ativar Zero Data Retention no console da Groq.
