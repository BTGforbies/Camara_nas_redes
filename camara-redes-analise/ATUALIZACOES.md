# Atualizações desta versão

## Formulário simplificado

A etapa de contexto possui somente:

1. Nome do projeto;
2. Ficha de tramitação;
3. Situação;
4. Assunto;
5. Contexto;
6. Quadro de engajamento por canal.

O quadro de engajamento é enviado diretamente ao quarto comando, **Canal de destaque**.

## Arquivos aceitos

O upload aceita:

- `.csv`, inclusive arquivos separados por vírgula ou ponto e vírgula;
- `.xlsx`;
- `.xls`.

## GitHub Codespaces

Depois de descompactar e abrir a pasta no terminal:

```bash
npm install
cp .env.example .env.local
npm run dev -- --host 0.0.0.0
```

Configure somente `GROQ_API_KEY` dentro de `.env.local` antes de iniciar. Os modelos já possuem valores padrão. O servidor de desenvolvimento aceita endereços privados do Codespaces e não depende da pasta oculta `.openai` para carregar.

## Revisão e PDF

- O sistema usa a Groq Cloud no backend e não mostra seleção de API na interface.
- A classificação usa `openai/gpt-oss-20b` em lotes pequenos e estruturados.
- O ranking, os cinco textos e o chat usam `openai/gpt-oss-120b`.
- As métricas e tabelas são calculadas localmente, sem chamadas de consolidação.
- Identificadores óbvios são removidos antes do envio e a planilha não sai do navegador.
- As cinco respostas principais aparecem na etapa 3.
- Cada resposta pode ser ajustada pelo chat lateral assistido e precisa ser validada.
- O PDF recebe somente essas respostas, sem métricas, capa, cabeçalho ou rodapé.
