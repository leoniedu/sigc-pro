# O mapa em duas variantes: Biomarcadores e Último Movimento

> Revisão de `prompt-extensao.md` (sessão pns.zonas, 14/08/2026), com as
> citações de código conferidas contra as fontes. O que mudou em relação
> àquele documento está no apêndice A; o que já foi implementado, no
> apêndice B.

Contexto: `pns.zonas/scripts/relatorio_agenda.R` e esta extensão relatam os
mesmos dados e devem concordar. Numa sessão de 14/08/2026 o script R foi
reescrito contra o parquet de quatro UFs (BA/PE/MA/RJ) e várias premissas
caíram. Parte já foi portada para cá — o domínio de `ultimaPosicao`, o
casamento positivo, a inclusão de `Reentrevista`, a remoção da whitelist de
tipo. Este documento trata do que ficou.

## Decisão de arquitetura (resolvida): duas variantes, não uma migração

O mapa de biomarcadores vive no Relatório de Acompanhamento de
Biomarcadores:

```
https://portalweb.ibge.gov.br/f5-w-…$$/relatorio/relatorio-acomp-biomarc
```

**Mas o Último Movimento mantém um mapa próprio.** A versão anterior deste
documento tratava a mudança como migração — "reduzir o Último Movimento ao
que ele faz bem", apagar a lógica de proxy. Não é isso: são **duas
variantes do mesmo painel**, escolhidas pela página, porque a versão sem
agendamentos vale por si.

| | Último Movimento (`MODO_MOVIMENTO`) | Biomarcadores (`MODO_BIOMARCADORES`) |
|---|---|---|
| Requisições | **1** (Lista de Endereços) | 2 (Endereços + agenda) |
| Demanda vem de | `ultimaPosicao` (proxy) | `status` (literal) |
| `agendado` vem de | — | `Data Agendada` do relatório |
| Agenda serve para | — | **só** slots livres por zona |
| Colunas de agenda/slot | ausentes | completas |
| Flag de capacidade | nunca dispara | dispara |

Por que a variante sem agenda vale a pena: **uma requisição só**, o que a
torna utilizável em qualquer recorte de controle/município/agência sem o
custo (nem o consentimento) da consulta à agenda da UF. Ela perde as
colunas derivadas da agenda, e as **omite** em vez de mostrá-las zeradas —
uma coluna de travessões diz "nada agendado" quando a verdade é "não foi
perguntado".

O proxy do `ultimaPosicao` **continua vivo** nessa variante, e continua
sendo um proxy: erra nos dois sentidos (§2). Isso é aceitável porque ali
ele é a única fonte disponível, e porque a variante não afirma demanda de
coleta como se fosse autoritativa — quem quer o número certo abre o
relatório de biomarcadores. O que **não** se faz é apagá-lo.

O recorte vem do **filtro da própria página** nas duas variantes:
captura-se `#filtroJson` no clique de `#btnFiltrar` e exige-se **agência OU
município OU controle**. Isso elimina o fan-out por município e a lista de
municípios com biomarcador — o usuário escolhe o recorte, e é uma
requisição só.

Consequências práticas:

- Não é preciso portar `municipios_biomarcador()`. Aquela função lê um
  dataset `sf` local (`pns_upas_biomarcador`) que a extensão não tem e não
  tem como obter — era a dependência não resolvida da versão anterior deste
  documento.
- `motivoBloqueio()` **já implementava exatamente essa regra**: bloqueia
  quando `IdAgencia`, `IdMunicipio` e `Controle` são todos wildcard.
  Reaproveitada nas duas variantes, sem reescrita.
- O `manifest.json` já casa `https://portalweb.ibge.gov.br/*`, então a nova
  página ficou coberta sem mudança de permissão.
- ✅ Detecção de página: `onBiomarcadores()`. Não dá para compartilhar com
  `onUltimoMovimento()` (`ultimo-movimento-export.js:34`), que procura um
  `<h6>` — esta página não tem título em `<h6>`, só o breadcrumb. Casa o
  **nome completo** do relatório, nunca a palavra "Biomarcadores" sozinha,
  que é entrada de menu em todo o SIGC. `modoAtual()` escolhe a variante a
  partir dela.

## Resumo: a recomendação principal

**A demanda de coleta pertence ao Relatório de Acompanhamento de
Biomarcadores.** `ultimaPosicao` é um proxy, e a sessão mediu que ele erra
nos dois sentidos. Onde o relatório está disponível, é ele que manda.

O que **não** decorre disso: apagar o mapa do Último Movimento. Lá o proxy
segue sendo a única fonte, e a variante de uma requisição só tem valor
próprio — ver a tabela acima.

---

## 1. Corrigir os números citados nos comentários

> ✅ **Feito.** A versão anterior deste documento mandava esperar, porque a
> migração apagaria estes comentários. Não houve migração —
> `MODO_MOVIMENTO` mantém a regra do `ultimaPosicao` —, então os
> comentários foram corrigidos no lugar. O registro abaixo fica como
> memória do que estava errado e por quê.

Os comentários citavam percentuais medidos sobre o **histórico SCD**, não
sobre o estado atual. `movimento.parquet` tem 26.203 linhas na BA, mas só
7.140 com `until_ts IS NULL` — uma por domicílio. As outras são versões
superadas: um domicílio que passou por `Descarregado Parcialmente` e hoje
está `Descarregado` contribuía para a contagem de "devido" mesmo estando
fechado.

A distinção agora está registrada no próprio código, junto ao domínio de
`ultimaPosicao`: enumerar um domínio quer toda versão já vista; contar uma
população quer uma linha por domicílio. Confundir as duas foi a origem de
tudo o que segue.

A tabela que estava no comentário:

```
//   Descarregado Parcialmente  60% pending   <- owed
//   Reentrevista               53% pending   <- owed
//   Descarregado (completo)    32% pending   <- closed
```

foi substituída pelo correto (estado atual, BA, 14/08/2026):

```
//   Denominador: domicílios da SUBAMOSTRA de biomarcadores com
//   tipo_entrevista == 'Realizada' (só quem pode dever alguma coisa),
//   estado atual (until_ts IS NULL) dos dois parquets.
//
//   Descarregado Parcialmente  89,7% em aberto (96/107)  <- devido
//   Reentrevista               86,4% em aberto (19/22)   <- devido
//   Descarregado (completo)    33,0% em aberto (86/261)  <- fechado
```

**Declarar o denominador é obrigatório aqui** — foi o erro que gerou os
números antigos. Duas escolhas mudam o resultado:

- *histórico cru vs. estado atual* — no cru, versões superadas contam;
- *todas as Realizadas do movimento vs. só a subamostra* — fora da
  subamostra o domicílio não tem `status`, e tratá-lo como "não aberto"
  dilui o percentual.

Sobre o mesmo recorte de estado atual, o denominador "todas as Realizadas"
daria 32,5% / 25,0% / 7,1% — números que já circularam neste trabalho e
**não devem ser usados**: incluem no denominador domicílios que nunca
deveriam coleta.

No denominador correto, `Reentrevista` fica **abaixo** de `Descarregado
Parcialmente` (86,4% vs 89,7%), invertendo a ordem dos números antigos. Isso
**não** muda a conclusão: as duas posições parciais ficam muito acima do
`Descarregado` completo (33,0%), que é o que justifica incluir
`Reentrevista` entre as devidas.

Outras afirmações erradas no mesmo bloco, todas corrigidas:

- "covers only ~48% of these households" → **é falso, e é a correção mais
  importante deste documento**: `biomarcadores.parquet` cobre **100% da
  subamostra** (BA: 1.860 linhas, uma por domicílio selecionado, todas com
  `status` preenchido). O argumento de "cobertura insuficiente" para não
  usar a fonte autoritativa **não existe**.

  (Não se sabe de onde saiu o "~48%". Uma medição intermediária desta sessão
  deu 23,2% cruzando contra os domicílios *devidos-pelo-proxy* em vez da
  tabela inteira; nenhum dos dois se reproduz hoje. A proveniência é
  obscura — o fato de a cobertura ser total é que está verificado.)
- "the live table carries at least fifteen [tipos]" → são **12** na BA. A
  remoção da whitelist continua certa; só o número está errado.
- "'Em condições de ser habitada' (152 unbooked in BA)" → esse tipo **não
  existe** em nenhuma das 4 UFs. Nem `'Em Ruínas'` — o valor real é
  `'Em obras ou ruínas'` (8 na BA).
- `'Uso Ocasional'` → 47 na BA (não 9 nem 99).
- linha ~189, "Enviado para Carga (3.582 rows in BA)" → é contagem do
  histórico cru. No estado atual são **800**. A parte "all Não Iniciada"
  vale nos dois recortes.

**Verificado:** nenhuma dessas strings aparece em constante de código —
`Em condições de ser habitada`, `Em Ruínas`, `Uso Ocasional` e `Domicílio
Vago` só ocorrem no comentário (`ultimo-movimento-map.js:193-195`). Não há
casamento morto a consertar; é erro de documentação apenas.

## 2. Consumir o Relatório de Biomarcadores ✅

### Por que o proxy não serve

Medido na BA, estado atual, cruzando `ultimaPosicao` com o `status` literal:

- Dos **121** domicílios que o proxy dava como devidos: **11 já estavam
  coletados** e **4 recusados** — ~12% não deviam nada.
- Dos que o proxy dava como fechados (`Descarregado`): **81 estavam em
  aberto** (69 `Não iniciado`, 7 `A agendar`, 5 `Agendado`).

O proxy não é uma aproximação conservadora: ele perde mais do que acerta. No
script R, trocar o proxy pelo status mudou a demanda da BA de 73 para 144
domicílios (hoje 160, depois de a janela passar a ignorar vagas já não
agendáveis).

### Como acessar

Referência de implementação: `fetch_biomarcadores_municipio()` em
`pns.zonas/R/sigc_biomarcadores.R:129`.

- `IdFiltro: "relatorio-acomp-biomarc"`
- Campos do filtro: `IdUf`, `IdAgencia`, `IdMunicipio`, `Controle`,
  `IdSupervisores`, `IdEntrevistadores`, `IdZona`. No R os não-usados vão
  como `"*"`; **aqui vem tudo de `#filtroJson`**, que já traz o objeto
  montado pelo próprio SIGC.
- POST `form-urlencoded`, corpo `filtro=<json url-encoded>`, resposta HTML,
  tabela em `#tableRelatorio`.

Note que o conjunto de campos difere do Último Movimento: biomarcadores tem
`IdSupervisores` e `IdZona`, e **não** tem `IdTipoAcompanhamento`. Como a
leitura é via `#filtroJson`, isso sai de graça — mas o fallback campo-a-campo
de `lerFiltro()` (`FILTRO_FIELDS`, `ultimo-movimento-map.js:1100-1106`) está
escrito para o Último Movimento e precisa da lista desta página.

### Diferenças de request a vigiar

`postRelatorio()` (`agenda-lookups.js:479`) é o helper certo — mas o R faz
duas coisas que ele não faz:

1. **URL**: o R monta só a forma F5 (`f5-h-$$` + `F5_origin` + `F5CH=I`,
   `sigc_biomarcadores.R:152-157`). `postRelatorio` tenta primeiro a forma
   simples e só depois a F5, movendo-se adiante em erro/não-2xx/tabela não
   reconhecida — então o comportamento é compatível, apenas com uma
   requisição a mais no pior caso.
2. **Referer**: o R envia
   `Referer: <base>/relatorio/relatorio-acomp-biomarc`
   (`sigc_biomarcadores.R:162`). `FORM_POST_HEADERS`
   (`agenda-lookups.js:460-463`) envia só `Content-Type` e
   `X-Requested-With`. Os outros dois slugs funcionam sem Referer; **se este
   der 403 ou "tabela não reconhecida" nas duas URLs, o Referer é o primeiro
   suspeito.** Rodando na própria página do relatório o navegador já manda um
   Referer coerente, então provavelmente é não-problema — mas é a hipótese a
   testar antes de qualquer outra.

### O que o relatório traz que o proxy não tem

`status`, `data_agendada`, `data_visita`, `data_resposta_25a01`,
`data_final_coleta`, `dias_prazo_final`, `nome_equipe`, `id_zona`,
`nome_zona`, `status_sangue`, `status_urina`, `motivo_sangue`,
`motivo_urina` (lista completa em `colunas_biomarcadores`,
`sigc_biomarcadores.R:208`).

Traz `id_zona`/`nome_zona` — ou seja, **dispensa o join com a Lista de
Endereços** para agrupar por zona. Não dispensa o join para **coordenadas**:
o relatório não tem lat/lon, então o mapa continua precisando da Lista de
Endereços por esse motivo.

## 3. Domínio de `status` (10 valores observados) ✅

```
Fecham COM coleta:  Coletado Sangue e Urina, Coletado apenas Sangue,
                    Coletado apenas Urina
Fecham SEM coleta:  Recusa, Outro Motivo, Não elegível
Em aberto:          A agendar, Não iniciado, Indefinido
Condicional:        Agendado  -> fechado enquanto data_agendada >= hoje;
                                 vencida sem coleta, volta a ser demanda
```

Constantes correspondentes no R: `STATUS_BIOMARCADOR_ABERTO`
(`sigc_biomarcadores.R:52`) e `STATUS_BIOMARCADOR_FECHADO_SEM_COLETA`
(`:68`).

Casar **positivamente**, como já se faz com as posições. Um `status` novo
deve ficar de fora das contagens e disparar aviso, não ser absorvido por uma
negação.

`Não elegível`: 1 caso (RJ, 14/08/2026), zero nas outras 10 UFs. É o
domicílio em que só na hora da coleta se descobre que não dá para colher.
Fechado — sem prazo, agendamento ou visita. Provavelmente a mesma família de
`Outro Motivo` do lado do biomarcador, que é o rótulo mais antigo para o
mesmo desfecho.

## 4. Duas armadilhas de rótulo homônimo ✅

**Recusa** e **Outro Motivo** existem nos DOIS campos e significam coisas
diferentes, em populações quase disjuntas (BA, 14/08/2026):

| rótulo | no biomarcador (`status`) | na entrevista (`tipoEntrevista`) | em ambos |
|---|---|---|---|
| Recusa (BA) | ~50 | 18 | — |
| Outro Motivo (BA) | 12 | 2 | **0** |
| Outro Motivo (RJ) | 21 | 8 | **1** |

Das ~50 recusas de biomarcador da BA, quase todas (~49) aparecem no
movimento como `tipo_entrevista == 'Realizada'`, e a maioria dessas
(~45) com `ultimaPosicao == 'Descarregado'` — isto é, como entrevista
**bem-sucedida**. A recusa da coleta é invisível no Último Movimento. Nunca
somar as duas; se ambas aparecerem na UI, rotular explicitamente qual é qual.

> Os valores exatos oscilaram entre medições da mesma sessão (50/44 no
> roxygen de `sigc_biomarcadores.R:62-65`, 51/45 numa remedição posterior).
> São dados vivos: use a ordem de grandeza, não o número. Ver §10.3.

## 5. Prazo final do biomarcador ✅

Regra confirmada em 1.019 linhas nas 4 UFs, sem exceção:

```
data_final_coleta = data_resposta_25a01 + 25 dias corridos
```

**`dias_prazo_final` (campo do SIGC) é outra coisa**: é o que falta a partir
de hoje, e vem **truncado em zero**. Um domicílio vencido há 3 semanas sai
como `0`, igual a um que vence hoje. Na BA, 40 de 253 linhas divergem de
`data_final_coleta - hoje`; 39 delas por truncamento (vencidas) e 1 por
diferença de 1 dia. **Recalcular**, para que atraso apareça negativo e ordene
na frente.

Portado como `emAlertaDePrazo()` / `acaoDePrazo()`, com as colunas Prazo e
Ação na aba Domicílios e a contagem no rótulo da aba. Espelha o
`alerta_prazo` do R (`relatorio_agenda.R:523`): domicílio não coletado, com
prazo definido, com a coleta em aberto (ou `Recusa`, por exceção — é status
fechado, mas revertê-la é o trabalho que o relógio ameaça), a menos de 10
dias do prazo ou já vencido.

A coluna **Ação** separa trabalho de agenda (agendar, reagendar) de
convencimento (reverter recusa), porque nenhum slot livre resolve uma
recusa. Sem essa separação, 24 das 39 linhas da BA eram recusa e os
domicílios de fato agendáveis viravam minoria na própria lista.

Volumes: BA 39 (10 vencidos), PE 25 (**17 vencidos**), MA 38 (12), RJ 63 (5).

**Slot que já não dá tempo de agendar não é capacidade.** ✅ **Feito** —
`primeiroDiaAgendavel()` / `fimDaJanela()` em `ultimo-movimento-map.js`.

Hoje, amanhã e depois de amanhã não são agendáveis, e numa SEXTA o dia+3
(segunda) também não — o fim de semana não é tempo útil para arranjar nada.
Contar essas vagas inflava a capacidade com slot morto: no R, corrigir isso
levou as zonas com gap negativo de 6 para 9 na BA. A janela é de 17 dias
corridos **a partir de hoje** (não do primeiro dia agendável: a cabeça morta
come a janela de propósito — é "o curto prazo", não "os próximos N dias
agendáveis"), o que deixa ~duas semanas de vagas preenchíveis.

A extensão contava a partir de hoje até +14; agora usa o mesmo piso e a
mesma janela do R (`primeiro_dia_agendavel()`, `sigc_biomarcadores.R:442`;
`JANELA_DIAS`, `relatorio_agenda.R:92`).

> **O fim de semana é prazo, não filtro.** O R restringe a janela a seg-sex
> porque hoje não existe slot de sábado no SIGC. A extensão
> **deliberadamente não** replica esse recorte: nada proíbe um slot de fim
> de semana, e um sábado daqui a três semanas é capacidade real. Excluí-lo
> subestimaria a zona — o erro oposto ao que este piso conserta. O fim de
> semana entra só no cálculo do prazo (a sexta que vira +4).
>
> (O R vai deixar de restringir seg-sex também; quando isso acontecer, os
> dois lados passam a concordar e esta nota vira histórica.)

Tudo isto vale **só em `MODO_BIOMARCADORES`**. Sem consulta à agenda não há
slot livre para comparar, então a flag de capacidade não dispara na
variante do Último Movimento — pintar escassez a partir de dado que não foi
buscado diria "0 slots livres" quando a verdade é "não foi perguntado".

Cobertura: só ~14% dos domicílios têm prazo (BA: 253 de 1.860), porque ele
nasce da resposta ao 25A.01. **`Não iniciado` nunca tem prazo** — o prazo só
existe depois de a coleta começar, então a combinação é impossível, não
apenas rara.

## 6. Zona pode abranger mais de uma agência ✅ (não se aplica)

A premissa "toda zona resolve a uma agência" vale para a BA e **não vale em
geral**. No PE, 7 zonas abrangem 2 agências cada (RJ: 1). Não é dado
corrompido: cada UPA pertence a uma agência só, mas uma zona reúne UPAs de
agências diferentes — a zona `260T77` tem 3 UPAs em 2 agências.

No R isso duplicava linhas num `left_join` e **inflava a demanda**: o PE
contava 9 domicílios devidos a mais e 23 pendentes a mais. Se a extensão
agrupa zona por agência em qualquer lugar, verificar a mesma armadilha. A
política adotada (igual a `pns.zonas/R/map_corredores.R:291`) é rotular a
zona como ambígua em vez de atribuí-la a uma agência arbitrária.

## 7. As duas medidas de demanda ✅

> Implementado. `MODO_BIOMARCADORES` usa `deveColeta()`/`coletaEmAberto()`;
> `MODO_MOVIMENTO` mantém `isRealizadaSemAgendamento()`/`isPendente()`.
> As duas variantes **não concordam entre si**, e não deveriam: uma lê o
> status literal, a outra um proxy que erra nos dois sentidos.

O casamento por posição continua certo — sem whitelist de tipo, excluindo
`Distribuido` + `Enviado para Carga`. Mas isso sozinho não basta para as duas
ferramentas concordarem. O `pendentes` do R (`relatorio_agenda.R`, seção 3)
tem mais dois recortes:

```r
pendentes <- bio_mov |>                       # 1. só a SUBAMOSTRA de biomarcadores
  filter(!ultima_posicao %in% POSICOES_NAO_EM_CAMPO, !is.na(ultima_posicao),
         coleta_em_aberto) |>                 # 2. e só com a COLETA em aberto
  anti_join(booked_keys, by = c("controle", "domicilio"))
```

Domicílio fora da subamostra não é pendente (nunca deveu coleta), e
domicílio cuja coleta já fechou também não. O `isPendente` atual, que roda
sobre todos os domicílios e ignora o status, conta os dois — e diverge do R.

Na página de biomarcadores os dois recortes ficaram triviais: **toda linha
do relatório já é da subamostra**, e `status` dá o segundo filtro
diretamente. A distinção entre as duas colunas é a mesma do R
(`relatorio_agenda.R:345` vs `:375`):

- **Realizadas sem agend.** (`deveColeta`) — coleta em aberto **e**
  entrevista já realizada. É o que o gap mede.
- **Pendentes** (`coletaEmAberto`) — coleta em aberto, sem exigir
  entrevista. Pano de fundo.

O aninhamento é por construção, mas o tooltip o afirma ao usuário, então é
**verificado por teste** em 108 combinações de status/tipo/data — foi assim
que se pegou uma primeira versão de `deveColeta()` que, ao excluir todo
`Agendado`, ficava idêntica a `coletaEmAberto()` e colapsava as duas
colunas em uma.

Um detalhe que só aparece na implementação: **`Agendado` vencido conta como
demanda**, e não se testa "tem `agendado` preenchido" para decidir isso — a
linha vencida ainda carrega a data antiga. Quem resolve é o próprio
`coletaEmAberto`, que só devolve `true` para `Agendado` depois de a data
passar.

## 8. Como buscar o relatório DENTRO da extensão ✅

Não reimplementar a mecânica do R (`f5_hex`, curl): a extensão já tem o
helper certo em `features/agenda-lookups/agenda-lookups.js`.

- `filtrarUrl()` (`agenda-lookups.js:49-55`) monta a URL com F5: já trata
  `slug=` e o prefixo `f5-h-$$`/`F5_origin`, inclusive o caso sem F5. Basta
  passar `slug=relatorio-acomp-biomarc`.
- `postRelatorio()` (`agenda-lookups.js:479-495`) faz o POST e o parse, já
  com `X-Requested-With: XMLHttpRequest` e o fallback simples→F5.

O comentário em `agenda-lookups.js:45-48` já registra que o mesmo endpoint
serve Lista de Endereços e Último Movimento; biomarcadores é mais um slug.
Ver §2 "Diferenças de request a vigiar" para o Referer.

## 9. Cabeçalhos literais da tabela ✅

A extensão casa cabeçalho por texto; se errar, falha fechado.

Os 24 cabeçalhos abaixo são **observados ao vivo** (captura do `<thead>` de
`#tableRelatorio`, BA/Pituba, 14/08/2026), na ordem em que aparecem. Casar
por texto, nunca por índice.

| # | `<th>` no HTML | nome no R |
|---|---|---|
| 1 | `UF` | `id_uf` |
| 2 | `Agência` | `id_agencia` |
| 3 | `Município` | `municipio` |
| 4 | `ID Zona` | `id_zona` |
| 5 | `Nome Zona` | `nome_zona` |
| 6 | `#!Controle` | `controle` |
| 7 | `!N.º Domicílio` | `domicilio` |
| 8 | `Tipo Entrevista` | `tipo_entrevista` |
| 9 | `Nome Equipe` | `nome_equipe` |
| 10 | `Status` | `status` |
| 11 | `Siape Agendamento` | `siape_agendamento` |
| 12 | `Data Resposta 25A.01` | `data_resposta_25a01` |
| 13 | `Data Agendada` | `data_agendada` |
| 14 | `Data Visita Biomarcadores` | `data_visita` |
| 15 | `Siape Coleta Biomarcadores` | `siape_coleta` |
| 16 | `Data Final para Coleta` | `data_final_coleta` |
| 17 | `Dias Prazo Final` | `dias_prazo_final` |
| 18 | `Data/hora coleta sangue` | `data_hora_sangue` |
| 19 | `Status sangue` | `status_sangue` |
| 20 | `Motivo sangue` | `motivo_sangue` |
| 21 | `Data/hora coleta urina` | `data_hora_urina` |
| 22 | `Status urina` | `status_urina` |
| 23 | `Motivo urina` | `motivo_urina` |
| 24 | `Dias entre 1° agendamento e coleta` | `dias_agendamento_coleta` |

Cinco armadilhas confirmadas na captura, todas resolvidas por `foldLive()`
(`agenda-lookups.js:210-211` — `normalizeLabel` + `stripAccents` +
`stripHeaderMarker`), que é o casador a usar:

- **`#!Controle` e `!N.º Domicílio` trazem a decoração de ordenação/filtro**,
  a mesma quirk do Último Movimento (`agenda-lookups.js:182-187`).
  `normalizeLabel` sozinho NÃO remove o `#!`; é `stripHeaderMarker` que
  remove.
- **`Siape` vem em caixa mista**, não `SIAPE`. `normalizeLabel` já baixa a
  caixa, então não é problema — desde que ninguém case a string literal.
- **`Data/hora coleta sangue` usa barra, não espaço**, e é minúscula em
  "hora". Idem `urina`.
- **`Status sangue`/`Status urina`/`Motivo …` são minúsculos** no segundo
  termo, enquanto `Status` (col. 10) é capitalizado. Distinguir por texto
  completo, não por prefixo `status`.
- **`Dias entre 1° agendamento e coleta` usa `°` (DEGREE SIGN, U+00B0)**, não
  `º` (MASCULINE ORDINAL INDICATOR, U+00BA) — enquanto `N.º Domicílio` usa o
  ordinal de verdade. Os dois símbolos convivem na mesma tabela e não se
  casam por igualdade. `stripAccents` (`agenda-lookups.js:196-198`) usa NFD,
  que **não** toca em nenhum dos dois (verificado: NFD de ambos é ele mesmo;
  só NFKD converteria `º`→`o`, e mesmo assim `°` continuaria intacto). Casar
  esta coluna por igualdade exata é frágil — preferir
  `includes('agendamento e coleta')`.

O de-para do R (`sigc_biomarcadores.R:177-200`) chega aos mesmos nomes por
outro caminho — `sub("^#?!", "", …)` seguido de `janitor::clean_names()`
(`:174-175`). Útil como conferência cruzada, mas **não** como fonte dos
cabeçalhos: `clean_names()` deforma de um jeito que não se inverte por
adivinhação (`Data Resposta 25A.01` → `data_resposta_25a_01`).

Note que o relatório **não traz coordenadas** — nenhuma das 24 colunas é
lat/lon. É por isso que o join com a Lista de Endereços continua necessário
(ver §2), exatamente como no Mapa do Último Movimento.

### Sobre as linhas de exemplo

A captura mostra `Tipo Entrevista` e `Nome Equipe` **vazios** em domicílios
`Não iniciado` — o relatório lista a subamostra inteira, inclusive quem nem
começou. Confirma o §5: `Não iniciado` não tem prazo, agendamento nem
visita, e aqui não tem sequer tipo de entrevista. O parser não pode assumir
célula preenchida em nenhuma coluna além das cinco primeiras, `Controle`,
`N.º Domicílio` e `Status`.

Confirma também que a chave é `(controle, domicilio)` e não `controle`
sozinho: as três primeiras linhas compartilham
`Controle = 292740805220571` com `N.º Domicílio` 1, 2 e 3 — o mesmo motivo
documentado em `enderecoKey()` (`sigc-common.js:70`).

## 10. Decisões de UX ✅

1. **~~Em que página a funcionalidade vive~~** — resolvido, ver topo.
2. **~~Custo do fan-out~~** — dissolvido pela decisão de página: o recorte é
   o do filtro, uma requisição.
3. **Os volumes citados aqui são do snapshot de 14/08/2026** e mudam todo
   dia. Servem para conferir a implementação contra este documento, **não
   como critério de aceitação**. (O histórico SCD de biomarcadores começa em
   13/08/2026 18:19.)
4. **~~O que fazer com o mapa do Último Movimento~~** — resolvido: **fica**,
   como `MODO_MOVIMENTO`. Não é uma segunda ferramenta a manter em
   paralelo, é a mesma, com as colunas que dependem da agenda omitidas.
   Ver a tabela no topo.
5. **~~Como o usuário sabe qual variante está vendo~~** — resolvido: o
   painel se identifica na própria barra ("Biomarcadores" ou "Último
   Movimento (sem demanda estimada)"), com tooltip dizendo de onde vêm os
   dados. Antes a diferença só era inferível pelas colunas **ausentes**, o
   que não ajuda quem nunca viu a outra variante.

   O rótulo do Último Movimento diz "sem demanda estimada", não "demanda
   estimada": aquela variante não mostra coluna de demanda nenhuma, então
   a ressalva honesta é "não há esse número aqui", não "o número é
   aproximado".

## 11. O mapa: cor, alfinete e contorno ✅

Em 14/08/2026 o mapa do `pns.zonas` foi reformulado. O que segue é resultado
— não proposta — e vale como referência.

### O que estava errado

`ultimo-movimento-map.js:297-300`, igual ao que o R fazia:

```js
function statusColor(row) {
  if (row.ultimaPosicao === 'Distribuido') return STATUS_INATIVO;
  return STATUS_TIPO_COLOR[row.tipoEntrevista] || STATUS_OUTROS;
}
```

A cor é o desfecho da ENTREVISTA, não o da coleta. As ~50 recusas de
biomarcador da BA saem **verdes**, idênticas a um domicílio já coletado —
porque a entrevista delas de fato deu certo.

✅ **Corrigido em `MODO_BIOMARCADORES`**, que agora usa a escala abaixo.
`MODO_MOVIMENTO` segue colorindo por entrevista — ali é a única fonte que
existe, e a cor está certa.

(A suspeita registrada antes, de que o mapa do R lia biomarcador de uma
planilha do OneDrive, estava errada: aquela planilha só fornece o endereço
dos laboratórios. O mapa simplesmente não tinha nenhum dado de coleta.)

### A escala que ficou no R

```
Coletado (S+U, só S, só U)      verde    #009E73
Agendado com data futura        azul     #0072B2
A agendar / Indefinido /
  agendamento vencido           amarelo  #F0E442
Recusa do biomarcador           laranja  #D55E00
Recusa da entrevista            vermelho #A63603
Outro Motivo (biomarcador)      roxo     #882255
Não elegível                    preto    #000000
Ocupado, sem entrevista         âmbar    #E69F00
Não iniciado                    cinza    #999999
```

Duas decisões que só apareceram ao olhar o mapa pronto:

- **As duas recusas precisam de cores distintas.** Recusar a coleta e
  recusar a entrevista custam esforços diferentes — uma exige convencimento
  sobre o exame, a outra sobre a pesquisa inteira. No R elas caíram na mesma
  cor por acidente (dois ramos com o mesmo hex em `case_when` diferentes) e
  a recusa de entrevista acabou no âmbar de "precisa de ação", misturada com
  quem só precisava de agenda.
- **"Ocupado, sem entrevista" merece cor própria**, e o conjunto é menor do
  que parece: só `Recusa`, `Domicílio Fechado` e `Não Foi Encontrado`. `Uso
  Ocasional` (segunda residência) e `Domicílio Vago` (vazio) NÃO entram —
  não há morador a entrevistar, então não há o que reverter.

### Destaque de urgência: dois erros a não repetir

O que precisa de ação é pouco e some no meio do resto (60 marcadores contra
~1.600 "Não iniciado" na BA), então o marcador urgente ganhou raio maior e
borda escura. Dois cuidados:

- **A regra tem de exigir coleta em aberto.** A primeira versão usava só
  "prazo < 10 dias", e como um domicílio coletado continua tendo prazo, 75
  dos 138 destacados já estavam coletados e 24 recusados. Destacar trabalho
  concluído é pior que não destacar nada.
- **Raio fixo em pixels não serve.** Com milhares de marcadores, 9px vira
  mancha sólida de longe e fica maior que o prédio de perto. No R o raio
  interpola por zoom (3px na visão do estado, 13px na da rua) e o rótulo
  some abaixo do zoom 14. Em Leaflet, ajustar `radius` no `zoomend`.

### Contorno da zona: já está certo aqui

O hull do R passou a sair das coordenadas dos domicílios. A área mediana da
zona caiu de 1,67 para 0,88 km² (menor em 44 das 55 zonas) mas **cresceu em
11** — não é "apertar", é corrigir.

**A extensão já faz isso**: `ultimo-movimento-map.js:956-961` agrupa
`[r.lat, r.lon]` por `idZona` e passa direto a `convexHull()`. Nunca usou
centroide de UPA. **Não há trabalho a fazer deste lado** — era correção
só do R.

Vale confirmar apenas o piso: zona com menos de 3 pontos não deve fechar
área. `convexHull()` (`:1361`) já devolve tipos distintos
(`polygon`/`capsule`/`circle`) e de-duplica coordenadas idênticas antes de
decidir, o que sugere que o caso já está tratado.

### Zonas sem campo iniciado

O mapa do R mostrava só zonas com movimento, e uma zona com 60 domicílios e
nenhuma entrevista sumia — justamente onde o trabalho precisa começar. Eram
25 zonas e ~705 domicílios invisíveis na BA.

**A extensão já cobre**: `aggregateZonas()` (`:233-237`) semeia os buckets a
partir de `enderecosMap` **antes** de dobrar o `joined`, então uma zona sem
nenhuma linha de movimento ainda produz uma linha. Verificação restante:
confirmar que a Lista de Endereços realmente devolve zonas sem movimento —
o código está certo, a fonte é que não foi conferida.

### Clique na linha inteira atrapalha copiar ✅

Feito: `wireZonaRowClicks()` agora liga o handler ao alfinete, não à `<tr>`.
No R isso foi desfeito por pedido de uso real — selecionar um código de
controle para copiar disparava a navegação e a tabela sumia debaixo do
cursor.

Três coisas que a implementação acrescentou ao que o R fez:

- O alfinete é `role="button" tabindex="0"` **e responde a Enter/Espaço**.
  Um elemento tabulável que só atende ao mouse é pior que um não-tabulável.
- A coluna declara `data-orderable="false"` **no próprio `<th>`**, não por
  índice: `initPanelTables` usa `order: []` e nenhum `columnDefs`
  posicional, então nada precisou ser renumerado — era exatamente a
  armadilha que uma configuração por índice teria armado.
- O código da zona virou **texto puro**. Era um `<a>` com estilo de link;
  com o alfinete carregando o gesto, o link seria um segundo alvo de
  clique sobre justamente o texto que o usuário quer selecionar.

Efeito colateral bem-vindo: o `<details>` dos slots livres deixou de ser
impossível. O comentário no código registrava que a lista ficava inline
porque o handler da linha engolia o clique do `<summary>` — essa restrição
não existe mais.

### O que NÃO portar

**Nome do entrevistador.** No R vem da tabela `usuarios` (siape → nome), de
um endpoint em outro host (`w3servicosigc.ibge.gov.br`), um request por
siape, com throttle. Não vale o custo aqui: **mostrar o siape**, como a
extensão já faz.

---

## O que falta

Nada deste documento. Tudo o que ele propunha está implementado
(apêndice B) ou verificado e descartado como não-aplicável.

O que resta é de outra natureza — só a realidade responde:

- **Conferir os números ao vivo.** Todos os volumes citados aqui são do
  snapshot de 14/08/2026 e servem para conferir a implementação, **não
  como critério de aceitação** (§10.3). Rodar as duas variantes num
  recorte real e comparar com o `relatorio_agenda.R` do mesmo dia é o
  único teste que este documento não pode escrever.
- **A janela seg-sex do R.** A extensão deliberadamente não replica esse
  recorte (§5). Quando o R deixar de restringi-lo, os dois lados passam a
  concordar e aquela nota vira histórica.

### Concluídos

- ~~**Montar na nova página**~~ ✅ (§ decisão de arquitetura).
- ~~**Ler `status` e derivar a demanda**~~ ✅ (§3, §7).
- ~~**Piso da janela de agendamento**~~ ✅ (§5).
- ~~**Rotular "Recusa da entrevista"**~~ ✅ (§4).
- ~~**Alfinete no lugar do clique na linha**~~ ✅ (§11).
- ~~**Cor por status de biomarcador**~~ ✅ (§11).
- ~~**Alerta de prazo**~~ ✅ (§5).
- ~~**Corrigir os comentários do §1**~~ ✅ (§1).
- ~~**Rotular `Outro Motivo`**~~ ✅ (§4).
- ~~**Zonas sem campo iniciado**~~ ✅ verificado e coberto por teste (§11).
- ~~**Zona em duas agências**~~ ✅ não se aplica: `IdAgencia` só aparece
  como campo de filtro, nunca como chave de agrupamento (§6).
- ~~**Qual variante o usuário está vendo**~~ ✅ o painel se identifica
  (§10.5).

## Como verificar

O parquet das 4 UFs está em `pns.zonas/output/questionarios/<uf>/parquet/`.
Toda medição citada aqui é reproduzível com `arrow::read_parquet()` +
`filter(is.na(until_ts))` para o estado atual. **Medir contra o estado
atual, nunca contra o histórico cru** — foi essa confusão que gerou os
números errados do §1.

---

## Apêndice A — o que mudou em relação a `prompt-extensao.md`

Correções aplicadas nesta revisão, todas conferidas contra as fontes:

1. **Citações do R corrigidas.** `fetch_biomarcadores_municipio` está em
   `sigc_biomarcadores.R:129` (não `:52` — lá fica
   `STATUS_BIOMARCADOR_ABERTO`); `colunas_biomarcadores` em `:208` (não
   `:131`); o de-para de colunas em `:177-200` (não `:100-125`, que é
   `municipios_biomarcador()`).
2. **§9 reescrito.** A tabela original dava pares "nome no R → cabeçalho"
   como se fosse um mapa literal. Não é: passa por `clean_names()`. A tabela
   agora mostra as três formas e sinaliza os dois casos indivináveis
   (`data_resposta_25a_01`, `dias_entre_1_agendamento_e_coleta`).
3. **A lista de municípios deixou de ser um buraco.** Vinha de um dataset
   `sf` local sem equivalente na extensão; a decisão de página a torna
   desnecessária.
4. **"Contorno da zona pelos domicílios" saiu da lista de tarefas.** A
   extensão já faz isso desde sempre (`:956-961`); era correção só do R.
5. **§7 reclassificado** como consequência do passo 1, não conserto
   independente — ambos os recortes exigem o relatório.
6. **§1 marcado como "não aplicar isolado"** logo no início, em vez de só na
   ordem sugerida ao fim.
7. **Referer e forma de URL** documentados como diferença real entre o
   request do R e `postRelatorio` (§2).
8. **Números da §4 marcados como oscilantes** — o roxygen do R diz 50/44, a
   remedição disse 51/45.
9. **Confirmações por leitura de código**: as strings de tipo do §1 só
   existem em comentário; `aggregateZonas` de fato semeia de `enderecosMap`.
10. **Piso da janela de agendamento** promovido a item alcançável hoje: é
    divergência ativa com o R e não depende da migração.
11. **§9 substituído por captura ao vivo** (14/08/2026). A tabela derivada de
    `clean_names()` errava seis cabeçalhos: `Siape` (não `SIAPE`), `ID Zona`
    (não `Id Zona`), `Data/hora coleta sangue`/`urina` (barra, minúsculo),
    `Status sangue`/`Motivo sangue` (minúsculos) e `Dias entre 1°…` (grau, não
    ordinal). Também confirmou que só 8 das 24 colunas são sempre
    preenchidas, e que nenhuma traz coordenada.
12. **A migração virou duas variantes.** Era a premissa estrutural do
    documento anterior — "reduzir o Último Movimento ao que ele faz bem",
    apagar o proxy. O Último Movimento fica, como `MODO_MOVIMENTO`, e o
    proxy com ele. Reescreveu o topo, §1, §5, §7, §10.4 e a ordem.

---

## Apêndice B — o que já está implementado

Ordem cronológica, com o que cada passo ensinou.

**Piso da janela de agendamento** (§5). `primeiroDiaAgendavel()` /
`fimDaJanela()`. A janela ia de hoje a +14; agora vai do primeiro dia ainda
agendável a +17, como o R. Divergência do R **por decisão**: o fim de semana
é prazo, não filtro (ver a nota no §5).

**Busca e parse do relatório** (§2, §8, §9). `filtroBodyBiomarcadores()`,
`parseBiomarcadoresHtml()`, `fetchBiomarcadoresPorFiltro()` em
`agenda-lookups.js`; `onBiomarcadores()` em `ultimo-movimento-map.js`.
Reaproveita `postRelatorio` — terceiro slug no mesmo endpoint genérico.
Acrescentou `foldOrdinal`, que mapeia `°` e `º` para `o`: o SIGC mistura os
dois na mesma linha de cabeçalho e o NFD não normaliza nenhum, então uma
troca futura de um pelo outro mataria o parser em silêncio.

**Recusa da entrevista nomeada** (§4). Coluna "Recusa entrev." com tooltip
que nomeia a recusa que ela **não** mostra, e legenda do mapa por extenso.

**Alfinete no lugar do clique na linha** (§11).

**As duas variantes** (topo, §3, §7). `MODO_MOVIMENTO` /
`MODO_BIOMARCADORES`, `modoAtual()`, `biomarcadoresParaLinhas()`,
`coletaEmAberto()`, `deveColeta()`.

Três coisas que só apareceram ao implementar:

1. **A flag de capacidade vazava.** Em `MODO_MOVIMENTO` ela continuava
   pintando escassez, com tooltip dizendo "0 slot(s) livre(s)" — a partir
   de dado que nunca foi buscado. Corrigido; tem teste.
2. **`deveColeta()` quase colapsou as duas colunas.** A primeira versão era
   "em aberto e não `Agendado`", o que a tornava idêntica a
   `coletaEmAberto()`. O `relatorio_agenda.R:345` mostrou a distinção real:
   a medida estreita exige **entrevista feita**, a larga só **estar em
   campo**. O aninhamento virou teste de 108 combinações.
3. **Cabeçalho e corpo têm de ser condicionados pelos mesmos flags.** Uma
   coluna presente em um e ausente no outro desloca em silêncio todas as
   células seguintes. Há teste de paridade de contagem por variante.

**Cor por status** (§11, §4). `statusColor()` passou a receber a variante.
Duas distinções que uma tabela plana de status não faria: as duas recusas
em cores distintas (reverter uma exige convencer sobre o exame, a outra
sobre a pesquisa inteira), e `Não iniciado` separado por **porquê** —
travado atrás de uma entrevista reversível não é o mesmo que esperando a
vez. Um agendamento vencido toma a cor de "precisa de ação", reusando
`coletaEmAberto` para que mapa e colunas reabram pela mesma regra. Testes
garantem que duas entradas da legenda nunca dividem uma cor e que as 231
combinações de status/tipo/data caem numa cor documentada.

**Terminologia** (§4). Toda string visível diz "biomarcador", nunca
"coleta": no SIGC a entrevista regular também é chamada de coleta, então o
rótulo nomeava justamente aquilo de que precisava se distinguir. Nesse
passo dois tooltips se revelaram **errados** em `MODO_BIOMARCADORES` —
descreviam as exclusões do proxy ("exceto os já descarregados", "não inclui
Distribuído"), que não é como aquela variante calcula demanda. Passaram a
ser escritos por variante, e encolheram de 3-4 frases (até 230 caracteres)
para 1-2 (68-116).

**Alerta de prazo** (§5). `diasParaPrazo()`, `emAlertaDePrazo()`,
`acaoDePrazo()`, colunas Prazo e Ação na aba Domicílios, contagem no rótulo
da aba. O prazo é **recalculado**: o campo do SIGC trunca em zero, então
vencido há três semanas e vence hoje saem iguais e a ordenação não serve.
Aqui vai negativo e lidera a ordem crescente.

Duas regras que não se adivinham, e o §5 já avisava sobre a primeira:

1. **Domicílio coletado mantém prazo**, então "prazo < 10 dias" sozinho
   destaca trabalho concluído — 75 dos 138 destaques da primeira versão do
   R. O alerta exige coleta em aberto.
2. **`Recusa` alerta por exceção.** É status fechado, mas revertê-la é
   exatamente o trabalho que o relógio ameaça. `Outro Motivo` e `Não
   elegível` não: não há o que reverter.

Achado de passagem: a coluna "Situação" da aba Domicílios renderizava
`ultimaPosicao`, sempre vazio na página de biomarcadores — era uma coluna
de travessões. Passou a mostrar o `status`.

**Correção dos comentários do §1.** Os seis números falsos foram
substituídos, cada um com o registro do que estava errado e por quê — o
denominador declarado, a diferença entre enumerar um domínio (histórico
cru) e contar uma população (estado atual), e a retratação do "~48% de
cobertura" que era o argumento para ficar no proxy.

**Últimos ajustes.** O painel passou a se identificar na barra (§10.5), e
`Outro Motivo` ganhou a qualificação que a `Recusa` já tinha (§4). Dois
itens não precisaram de código:

- **Zonas sem campo iniciado** já apareciam — `aggregateZonas` semeia os
  buckets a partir de `enderecosMap` antes de dobrar as linhas de
  movimento. Comportamento agora fixado por teste, sozinho e ao lado de
  uma zona com movimento.
- **Zona em duas agências** não se aplica: `IdAgencia` só aparece aqui
  como campo de filtro, nunca como chave de agrupamento — a agregação é
  por `idZona` puro. A armadilha que inflava a demanda do PE no R depende
  de um `left_join` que esta extensão não faz.
