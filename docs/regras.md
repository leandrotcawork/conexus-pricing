# Regras do Conexus que valem aqui

Os guias ficam no repositório do Conexus (`docs/guides/code.md`, `data.md`, `security.md`,
`testing.md`, `delivery.md`). Este arquivo lista as regras por identificador, com a adaptação, e não
copia o texto: cite o identificador, nunca reescreva a regra.

## Valem iguais

| Regra | Onde morde aqui |
| --- | --- |
| code C11, C18, C20, C24, C25 | Estilo: export nomeado, `function` no topo, sem `any`, `!` ou `as`, `type` e não `interface`. O Biome recusa |
| code C19 | Funções com objeto quando argumentos podem trocar de lugar (`tomarRodada({ fonte, agendadaPara, versao })`) |
| code C21, C22 | Situação da observação e da rodada como união discriminada; `switch` termina em `satisfies never`; ausência explícita, nunca preço zero |
| code C23 | `Ean`, `Codprod`, `FonteCodigo`, `ProdutoId`, `RodadaId` com marca, criados só por parse |
| code C26 | Uma regra, um dono: `decidir()` substitui as três cópias do MetalPrice (`vtex.py:98-114`, `tray.py:117-133`, `wake.py:131-142`) |
| code C27 | Toda resposta de loja, o envelope do cron, `fonte.config`, as linhas lidas do Oracle e o `process.env` passam por Zod uma vez |
| code C30 | Ferramentas MCP estreitas; nada de `executar_sql` |
| code C40 | Instantes em RFC 3339 UTC na saída MCP |
| code C44 | `buscar_produto` paginado por continuação do servidor |
| code C50, C53 | Nenhum `catch` vazio; falha de lote vira observação `ERRO` com detalhe e aviso na rodada |
| code C56 | Uma porta por sistema externo; só o adaptador HTTP importa o Crawlee |
| code C57, C59 | Prazo por pedido (25 s, `base.py:21`), prazo da rodada (13 min de 15), teto de bytes por resposta |
| code C67 | `config.ts` é o único leitor de `process.env` |
| code C70 | Comentário só para o porquê; as docstrings do MetalPrice que explicam armadilhas viram comentários curtos no adaptador |
| code C74, C77 | knip; tamanhos máximos do Biome (60 linhas por função, 300 por arquivo, largura 100) |
| code C75 | A tabela nativo contra próprio antes de um mecanismo próprio |
| code C79 | Erro de ferramenta pelo caminho nativo de erro do MCP (`isError: true`), nunca resultado vazio |
| code C80 | Descrições de ferramenta sem nome de loja ou produto como exemplo |
| data D5, D6, D7, D15, D20 | Drizzle dono do schema; migração só adiciona; a que chegou na main não muda; CHECKs no banco; parâmetros ligados |
| data D10, D12 | Roles por SQL, verbos estreitos |
| security S31, S37, S40 | Segredos fora do Git; doubles com valores inventados |
| testing T3, T4, T6, T19, T20, T27, T29 | Timeout global; teste pulado diz o motivo; asserção que distingue a falha; banco descartável; porta 0 e espera por evento; mutação à mão das linhas-chave; doubles gravados do serviço real, recusas incluídas |
| delivery L2, L11, L12, L23, L26, L28 | Etapa usável em dias; achado com evidência; Bloqueia, Fechamento, Issue futura; português no que a pessoa lê; não descartar trabalho alheio; desvio das referências vai ao fundador |
| decisão 0058 | 429 com a espera pedida e uma tentativa |

## Valem adaptadas

| Regra | Adaptação |
| --- | --- |
| code C3-C8 (portas `public.ts`, dependency-cruiser) | Um pacote e seis pastas: as paredes são `noRestrictedImports` do Biome por pasta, em `biome.json`. Sem `public.ts` |
| code C13, C14 (rota, store, handler sem SQL) | `funcoes/` é o handler: lê, chama, responde; o SQL mora em `banco/` |
| code C28 (operação em Zod, OpenAPI emitido) | Cada ferramenta MCP declarada uma vez em Zod; o SDK emite o `outputSchema` |
| code C33-C38 (API) | Sem API REST. A rota `mcp` exige bearer; a rota `coleta` exige o cabeçalho `X-Neon-Trigger-Invocation-Id`, que o Neon remove quando vem do cliente |
| code C48-C52 (catálogo de falhas) | Sem telas: as falhas são as situações e os avisos da rodada, e o `isError` das ferramentas |
| data D9 (migrate antes do start) | `npm run migrar` antes de `neon deploy`, pelo `DATABASE_URL_UNPOOLED` |
| data D27 (nada mantém conexão parada) | Natural: o Neon dorme em 5 min e o Pool tem `idleTimeoutMillis` curto |
| testing T5 (porta pública) | A porta é o `fetch` de cada função: o teste da coleta chama `coleta.fetch(envelope)` contra doubles em loopback; o do MCP usa o cliente MCP real |
| delivery L9, L13, L15 | Um PR por etapa, um commit por unidade, um check `ci`, merge com a palavra do fundador |

## Não valem

Multiempresa, papéis e convites (S6-S13, C81); sessão e cookies do Hub (S17, S18, S24); telas, design,
QA e T23-T25; Mastra, Builder e apps gerados (S4, S5, D28, D29, T24, T26, T28); lago e Singer;
`processo`, approvals, roteiro de uso na instalação (L5, L6, L17, L19, L20, L27) no formato do
Conexus; o teto de palavras por arquivo de L24 (só o do `AGENTS.md`, 400 palavras).
