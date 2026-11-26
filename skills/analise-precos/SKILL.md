---
name: analise-precos
description: Como analisar os preços coletados da concorrência. Definição de cada indicador, ordem de trabalho, cuidados e o que não dá para concluir. Use ao responder sobre preço de produto, categoria, marca ou catálogo contra o mercado.
---

# Análise de preços contra a concorrência

Os preços vêm de coletas semanais nas lojas dos concorrentes, casados pelo EAN. O nosso preço é o de
tabela, gravado na última carga do catálogo.

## O que cada situação quer dizer

| Situação | Significado | Conta como preço |
| --- | --- | --- |
| `OK` | A loja vende por este preço | Sim |
| `SEM_ESTOQUE` | Indisponível; o preço é o que a loja publica | Não |
| `SEM_PRECO` | A loja publica o produto sem preço | Não |
| `NAO_ENCONTRADO` | A loja não vende o produto | Não |
| `ERRO` | A coleta falhou: não se sabe o preço nem se a loja vende | Não |

`NAO_ENCONTRADO` é uma resposta sobre a loja. `ERRO` não é resposta nenhuma: nunca leia um erro como
"a loja não vende".

## Os indicadores

Notação: `n` é o nosso preço; `c` são os preços `OK` das lojas no produto, na última coleta concluída
de cada loja; `k` é quantas lojas têm preço.

| Indicador | Definição | Como ler |
| --- | --- | --- |
| `indice` | `n ÷ mediana(c) × 100` | 100 é o meio do mercado; 108 é 8% acima |
| `indicePonderado` | O mesmo, com cada produto pesando a sua venda líquida de 12 meses | Onde o dinheiro está; compare com o simples |
| `gapMenorPct` | `(n − menor c) ÷ menor c`, em % | Quanto estamos acima (positivo) ou abaixo do mais barato |
| `posicao` | `MAIS_BARATO` se `n ≤ menor c`; `MAIS_CARO` se `n ≥ maior c`; senão `NA_FAIXA` | Só por produto |
| `menorPrecoPct` | % dos produtos com preço em que somos o mais barato; o empate conta | Liderança de preço |
| `amplitudePct` | `(maior c − menor c) ÷ menor c`, só com `k ≥ 3` | Alta: há espaço; baixa: mercado disputado |
| `cobertura` | Produtos da linha e quantos têm `k ≥ 1` | Quanto confiar na linha |
| `emPromocao` | Preços abaixo do preço de lista que a própria loja declara | O preço baixo pode ser oferta |
| `promocao` | `1 − preco ÷ precoLista` numa loja | 0,15 é 15% de desconto declarado |
| `rupturaPct` | % das observações `SEM_ESTOQUE`, sem contar `ERRO` | Concorrente em falta não pressiona o preço |
| `mudancas` | Cada par produto e loja contra a coleta anterior da loja, de outra semana | Quem mexe preço, e para onde |
| `tendencia` | O índice nas 8 semanas mais novas: as 4 recentes contra as 4 anteriores, e a inclinação em % por semana | O mercado subindo ou descendo contra nós |

Nas linhas agregadas (grupo, marca, total), `indice` e `gapMenorPct` são médias simples dos produtos
com preço, `amplitudePct` é a mediana, e `posicao` vem nula.

Na linha de uma loja, os indicadores comparam o nosso preço só com ela. A exceção é
`menorPrecoPct`: dos produtos que ela tem à venda, em quantos o preço dela é o menor entre as lojas.

## Ordem de trabalho

1. Olhe a saúde da coleta: situação, avisos, idade e cobertura de cada loja. Uma loja com rodada
   velha, `SUSPEITA` ou com muitos erros muda o que dá para concluir.
2. Olhe a cobertura antes do índice. Diga sempre sobre quantos produtos o número foi calculado.
3. Para categoria ou catálogo, comece pelo panorama por grupo. Consulte os grupos para achar o código
   da categoria; um grupo inclui os subgrupos quando é o escopo do panorama ou o filtro da busca. No
   panorama agrupado por grupo, cada linha é o grupo em que o produto está cadastrado.
4. Dentro do grupo que chamar atenção, ordene os produtos pelo maior gap ou pelo maior índice.
5. Só nesses produtos, peça os preços atuais com detalhes, para ver loja, URL, vendedor e hora.
6. Peça os produtos em lote. Nunca consulte um por um.

## Cuidados

- Um índice sobre poucos produtos engana. Com `comPreco` muito menor que `produtos`, a linha fala só
  da parte que as lojas vendem.
- Com `k = 1`, o índice compara com uma loja só. Veja a cobertura por loja antes de chamar isso de
  mercado.
- Antes de recomendar baixar um preço, veja se o mais barato está em promoção declarada ou se é o
  único com preço.
- O casamento é pelo EAN, mas material vendido por caixa numa loja e por metro quadrado em outra dá
  índice falso. Um gap muito grande num produto pede conferir a unidade pela URL.
- `indice` acima de 100 e `gapMenorPct` respondem perguntas diferentes: estar na mediana ainda pode
  ser muito acima do mais barato. Mostre os dois.

## O que não concluir

- Com menos de 4 semanas de coleta não há mudanças; com menos de 8 não há tendência. O panorama
  manda `null` e explica em `historico`. Não estime nem preencha.
- Com uma coleta só, não diga que um preço subiu, caiu, está estável ou é sazonal.
- A tendência e as mudanças usam o nosso preço de hoje: mostram o movimento dos concorrentes, não o
  do nosso preço.
- A composição pode mudar de uma semana para outra (uma loja falha, um produto some). Confira a saúde
  e a cobertura antes de atribuir uma variação ao mercado.
- Não há dado de venda por semana nem histórico do nosso preço: não fale de elasticidade nem de
  efeito do preço na venda.
