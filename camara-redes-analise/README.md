# Câmara nas Redes - Análise de Propostas

Sistema para ler bases em CSV ou Excel, gerar respostas com o Grok, revisar cada texto em uma conversa assistida e criar um PDF A4 cru somente com as respostas validadas.

## O que funciona

- Upload de `.csv`, `.xlsx` e `.xls`;
- Leitura de todas as tabelas utilizáveis e detecção de registros repetidos;
- Formulário com nome do projeto, ficha de tramitação, situação, assunto, contexto e quadro de engajamento por canal;
- Geração sequencial dos sete comandos exclusivamente pela API Grok/xAI;
- Exibição das cinco respostas principais antes da conferência final;
- Chat lateral com o Grok para ajustar uma resposta, sem edição manual;
- Validação individual obrigatória de cada resposta;
- PDF A4 sem capa, cabeçalho, rodapé, métricas ou resultados intermediários.

## Rodar no GitHub Codespaces

No terminal, dentro da pasta `camara-redes-analise`, execute:

```bash
npm install
cp .env.example .env.local
```

Abra `.env.local` e preencha:

```env
XAI_API_KEY=sua_chave_xai
XAI_MODEL=grok-4.6
```

Depois, inicie:

```bash
npm run dev -- --host 0.0.0.0
```

Quando o Codespaces detectar a porta, mantenha-a privada e clique em **Abrir no navegador**. Não digite o conteúdo do `.env.local` diretamente no terminal e nunca envie esse arquivo ao GitHub.

## Variáveis

| Variável | Uso | Padrão |
| --- | --- | --- |
| `XAI_API_KEY` | Chave da API Grok/xAI | sem valor |
| `XAI_MODEL` | Modelo da xAI | `grok-4.6` |
| `AI_REQUEST_TIMEOUT_MS` | Tempo máximo de cada chamada | `240000` |
| `AI_MAX_CONTEXT_CHARS` | Limite do contexto enviado | `2000000` |
| `NEXT_PUBLIC_MAX_FILE_MB` | Limite do CSV ou Excel | `25` |

## Fluxo

1. O navegador valida e lê o CSV ou Excel.
2. O backend executa os sete comandos com o Grok. A chave nunca é enviada ao navegador.
3. O sistema exibe cinco respostas principais: O que dizem, Canal de destaque, Quem mobilizou, O que mobilizou e Resumo executivo.
4. O usuário pode conversar com o Grok para ajustar cada resposta.
5. Cada resposta precisa ser validada individualmente.
6. O PDF recebe somente as cinco respostas validadas.

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build:local  # compilação local
npm run build        # compilação verificada
npm run lint         # análise estática
npm test             # testes completos
npm run test:unit    # testes rápidos
```

As chamadas reais ao Grok não fazem parte dos testes automatizados para evitar consumo de créditos.
