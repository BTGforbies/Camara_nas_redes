# Relatório resumido de testes

## Automatizados

| Área | Cenários cobertos |
| --- | --- |
| Excel | `.xlsx`, `.xls`, várias planilhas, repetidos, arquivo inválido, assinatura incompatível e limite de contexto |
| Prompts | Ordem dos sete comandos, dependências, regras críticas e limite de 400 caracteres |
| PDF | Criação A4, múltiplas páginas, imagem no cabeçalho e padronização do nome do arquivo |
| Aplicação | Build de produção, resposta HTML, título correto e presença do fluxo de upload |

Execute tudo com:

```bash
npm test
```

## Verificação manual recomendada com uma chave real

1. Copiar `.env.example` para `.env.local` e configurar a API.
2. Iniciar com `npm run dev`.
3. Enviar um `.xlsx` e um `.xls` reais.
4. Conferir planilhas, registros e avisos reconhecidos.
5. Preencher os três campos obrigatórios e a tabela de pontos de engajamento.
6. Gerar as sete seções e conferir o avanço etapa a etapa.
7. Editar uma seção, cancelar outra edição e restaurar um texto.
8. Gerar novamente apenas uma seção e confirmar que as demais não mudaram.
9. Confirmar a versão final.
10. Gerar, visualizar e baixar o PDF.
11. Repetir em largura de celular e com navegação por teclado.
12. Testar chave inválida, limite da API e indisponibilidade para conferir as mensagens de erro.

Chamadas reais aos provedores não são automatizadas, pois consumiriam créditos e poderiam gerar resultados variáveis.

