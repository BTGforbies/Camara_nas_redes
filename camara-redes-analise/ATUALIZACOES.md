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

Configure a chave da xAI ou OpenAI dentro de `.env.local` antes de iniciar. O servidor de desenvolvimento aceita endereços privados do Codespaces e não depende da pasta oculta `.openai` para carregar.

