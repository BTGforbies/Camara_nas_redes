# Câmara nas Redes - Análise de Propostas

Sistema para ler bases em CSV ou Excel, classificar argumentos com a Groq, revisar cada texto em uma conversa assistida e criar um PDF A4 somente com as respostas validadas.

## Fluxo econômico

1. O navegador valida e lê o arquivo.
2. Repetições, linhas corrompidas, somas, percentuais, canais e autores são processados localmente, sem tokens.
3. Somente textos compactos e com identificadores óbvios removidos são classificados em lotes pequenos pelo modelo **openai/gpt-oss-20b**.
4. As duas tabelas são montadas localmente e não exigem conversa nem validação manual.
5. Um único pedido ao **openai/gpt-oss-120b** gera o ranking e os cinco textos finais.
6. O chat envia somente a resposta em revisão e as últimas mensagens, nunca a planilha.
7. O PDF recebe o ranking e os cinco textos validados.

Não é usado **groq/compound**, busca web, execução de código ou qualquer ferramenta externa do modelo.

## Rodar no GitHub Codespaces

Crie uma chave em [Groq API Keys](https://console.groq.com/keys). No terminal, dentro de **camara-redes-analise**, execute:

```bash
npm install
test -f .env.local || cp .env.example .env.local
code .env.local
```

No arquivo **.env.local**, deixe:

```env
GROQ_API_KEY=gsk_SUA_CHAVE
GROQ_BULK_MODEL=openai/gpt-oss-20b
GROQ_QUALITY_MODEL=openai/gpt-oss-120b
```

Salve o arquivo e inicie:

```bash
pkill -f "vite --host" || true
npm run dev -- --host 0.0.0.0 --port 5173
```

Abra a porta **5173** pela aba **Portas** do Codespaces. Mantenha a porta privada. Não digite a chave diretamente no terminal e nunca envie **.env.local** ao GitHub.

## Privacidade

- A chave permanece no backend.
- O arquivo original permanece no navegador e não é enviado ao servidor.
- Os lotes não contêm coluna de autor, canal, engajamento, URL ou outras colunas da planilha.
- URL, e-mail, telefone, CPF e identificadores iniciados por @ são removidos dos textos antes do envio.
- Cada texto enviado possui no máximo 900 caracteres e usa um id neutro, como P000001.
- Somente nomes agregados dos autores de maior destaque, sem ligação com postagens individuais, seguem para a redação de “Quem mobilizou”.
- A aplicação não possui banco de dados nem grava o arquivo, prompts ou respostas no servidor.

Para maior proteção, um administrador da organização deve ativar **Zero Data Retention** em [Groq Data Controls](https://console.groq.com/settings/data-controls). A remoção automática de identificadores reduz exposição, mas não substitui revisão institucional quando a base contiver dados pessoais sensíveis em linguagem livre.

## Variáveis

| Variável | Uso | Padrão |
| --- | --- | --- |
| GROQ_API_KEY | Chave da Groq Cloud | sem valor |
| GROQ_BULK_MODEL | Classificação econômica | openai/gpt-oss-20b |
| GROQ_QUALITY_MODEL | Ranking, textos e chat | openai/gpt-oss-120b |
| AI_REQUEST_TIMEOUT_MS | Tempo máximo por chamada | 180000 |
| AI_MAX_COMPLETION_TOKENS | Teto de saída | 5000 |
| AI_MAX_REQUEST_BYTES | Limite local de cada requisição | 250000 |
| NEXT_PUBLIC_AI_CHUNK_CHARS | Tamanho-alvo do lote compacto | 10000 |
| NEXT_PUBLIC_MAX_FILE_MB | Limite do arquivo | 25 |

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build:local  # compilação local
npm run build        # compilação verificada
npm run lint         # análise estática
npm test             # testes completos
npm run test:unit    # testes rápidos
```

As chamadas reais à Groq não fazem parte dos testes automatizados, portanto os testes não consomem créditos.
