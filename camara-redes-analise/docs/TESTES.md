# Relatório resumido de testes

## Automatizados

| Área | Cenários cobertos |
| --- | --- |
| CSV e Excel | `.csv`, `.xlsx`, `.xls`, ponto e vírgula, várias planilhas, repetidos, arquivo inválido, assinatura incompatível, limite de contexto e reconhecimento de links/títulos |
| Argumentos | Todos os registros, múltiplos argumentos por comentário, mapa completo e consolidação dos cinco principais |
| Links públicos | Bloqueio de destinos locais, extração de título, descrição e trecho, limites e falha tolerante |
| Prompts | Dependências, regras críticas, contexto das fontes e limite de 400 caracteres |
| PDF | Criação A4 crua, múltiplas páginas e padronização do nome do arquivo |
| Aplicação | Build de produção, resposta HTML, título correto e presença do fluxo de upload |

Execute tudo com:

```bash
npm test
```

## Verificação manual recomendada com uma chave real

1. Copiar `.env.example` para `.env.local` e configurar `GROQ_API_KEY`.
2. Iniciar com `npm run dev`.
3. Enviar arquivos `.csv`, `.xlsx` e `.xls` reais.
4. Conferir tabelas, registros e avisos reconhecidos.
5. Preencher nome do projeto, ficha de tramitação, situação, assunto, contexto e quadro de engajamento por canal.
6. Gerar as sete seções e conferir o avanço etapa a etapa.
7. Abrir o chat lateral, pedir um ajuste e conferir a nova versão da resposta.
8. Validar as cinco respostas e confirmar que a etapa 4 só é liberada depois disso.
9. Confirmar a versão final.
10. Gerar, visualizar e baixar o PDF cru.
11. Repetir em largura de celular e com navegação por teclado.
12. Testar chave inválida, limite da API e indisponibilidade para conferir as mensagens de erro.

Chamadas reais ao provedor de IA não são automatizadas, pois consumiriam cota e poderiam gerar resultados variáveis.
