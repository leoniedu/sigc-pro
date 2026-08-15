# Mapa de biomarcadores no Relatório de Acompanhamento de Biomarcadores

> Revisão de `prompt-extensao.md` (sessão pns.zonas, 14/08/2026), com as
> citações de código conferidas contra as fontes e a decisão de página já
> tomada. O que mudou em relação àquele documento está listado no
> apêndice A.

Contexto: `pns.zonas/scripts/relatorio_agenda.R` e esta extensão relatam os
mesmos dados e devem concordar. Numa sessão de 14/08/2026 o script R foi
reescrito contra o parquet de quatro UFs (BA/PE/MA/RJ) e várias premissas
caíram. Parte já foi portada para cá — o domínio de `ultimaPosicao`, o
casamento positivo, a inclusão de `Reentrevista`, a remoção da whitelist de
tipo. Este documento trata do que ficou.

## Decisão de página (resolvida)

**O mapa de biomarcadores vive no Relatório de Acompanhamento de
Biomarcadores**, não no Último Movimento:

```
https://portalweb.ibge.gov.br/f5-w-…$$/relatorio/relatorio-acomp-biomarc
```

O recorte vem do **filtro da própria página**, exatamente como o Mapa faz
hoje no Último Movimento: captura-se `#filtroJson` no clique de `#btnFiltrar`
e exige-se **agência OU município OU controle**. Isso elimina o fan-out por
município e a lista de municípios com biomarcador — o usuário escolhe o
recorte, e é uma requisição só.

Consequências práticas:

- Não é preciso portar `municipios_biomarcador()`. Aquela função lê um
  dataset `sf` local (`pns_upas_biomarcador`) que a extensão não tem e não
  tem como obter — era a dependência não resolvida da versão anterior deste
  documento.
- `motivoBloqueio()` (`ultimo-movimento-map.js:1466`) **já implementa
  exatamente essa regra**: bloqueia quando `IdAgencia`, `IdMunicipio` e
  `Controle` são todos wildcard. Reaproveitar, não reescrever.
- O `manifest.json` já casa `https://portalweb.ibge.gov.br/*`, então a nova
  página está coberta sem mudança de permissão.
- Falta só a detecção de página: `onUltimoMovimento()`
  (`ultimo-movimento-export.js:34`) procura um `<h6>` com "último
  movimento". O análogo é procurar "acompanhamento de biomarcadores" —
  mesma normalização de acento.

## Resumo: a recomendação principal

**Esta lógica pertence ao Relatório de Acompanhamento de Biomarcadores.**
`ultimaPosicao` é um proxy, e a sessão mediu que ele erra nos dois sentidos.
O relatório de biomarcadores traz o status literal da coleta. A extensão já
sabe que ele existe (`common/sigc-common.js:50`, `biomarcadores: { index: 17 }`),
mas não o consome.

---

## 1. Corrigir os números citados nos comentários

> **Não aplicar isolado.** Ver "Ordem sugerida": estes comentários são
> apagados pela migração. O conteúdo abaixo vale como **insumo do código
> novo**. Só vale editá-los no lugar se a migração for adiada.

Os comentários das linhas ~155-170 de `ultimo-movimento-map.js` citam
percentuais que vieram de uma medição sobre o **histórico SCD**, não sobre o
estado atual. `movimento.parquet` tem 26.203 linhas na BA, mas só 7.140 com
`until_ts IS NULL` — uma por domicílio. As outras são versões superadas: um
domicílio que passou por `Descarregado Parcialmente` e hoje está
`Descarregado` contribuía para a contagem de "devido" mesmo estando fechado.

A tabela atual do comentário:

```
//   Descarregado Parcialmente  60% pending   <- owed
//   Reentrevista               53% pending   <- owed
//   Descarregado (completo)    32% pending   <- closed
```

O correto (estado atual, BA, 14/08/2026):

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
daria 32,5% / 25,0% / 7,1% — números que já circularam nesta migração e
**não devem ser usados**: incluem no denominador domicílios que nunca
deveriam coleta.

No denominador correto, `Reentrevista` fica **abaixo** de `Descarregado
Parcialmente` (86,4% vs 89,7%), invertendo a ordem dos números antigos. Isso
**não** muda a conclusão: as duas posições parciais ficam muito acima do
`Descarregado` completo (33,0%), que é o que justifica incluir
`Reentrevista` entre as devidas.

Outras afirmações erradas no mesmo bloco:

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

## 2. Consumir o Relatório de Biomarcadores

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

## 3. Domínio de `status` (10 valores observados)

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

## 4. Duas armadilhas de rótulo homônimo

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

## 5. Prazo final da coleta — o alerta que falta

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

Alerta implementado no R (`relatorio_agenda.R`, aba `alerta_prazo`):
domicílio não coletado, com prazo definido, cujo status seja `Recusa` /
`A agendar` / `Indefinido` / agendamento vencido sem coleta, e a menos de 10
dias do prazo (ou vencido).

Volumes: BA 39 (10 vencidos), PE 25 (**17 vencidos**), MA 38 (12), RJ 63 (5).

**Slot que já não dá tempo de agendar não é capacidade.** Hoje, amanhã e
depois de amanhã não são agendáveis, e numa SEXTA o dia+3 (segunda) também
não — o fim de semana não conta como prazo. Contar essas vagas inflava a
capacidade com slot morto: no R, corrigir isso levou as zonas com gap
negativo de 6 para 9 na BA. A janela de capacidade é de 17 dias corridos a
partir de hoje (~duas semanas de vagas preenchíveis: 9 dias úteis numa
sexta, 12 numa segunda). A extensão **conta slots livres hoje** (ver
`capacidade`/`indexZonaLivres` em `ultimo-movimento-map.js:311`), então
aplicar o mesmo piso não é opcional — é onde as duas ferramentas divergem
agora.

Cobertura: só ~14% dos domicílios têm prazo (BA: 253 de 1.860), porque ele
nasce da resposta ao 25A.01. **`Não iniciado` nunca tem prazo** — o prazo só
existe depois de a coleta começar, então a combinação é impossível, não
apenas rara.

## 6. Zona pode abranger mais de uma agência

A premissa "toda zona resolve a uma agência" vale para a BA e **não vale em
geral**. No PE, 7 zonas abrangem 2 agências cada (RJ: 1). Não é dado
corrompido: cada UPA pertence a uma agência só, mas uma zona reúne UPAs de
agências diferentes — a zona `260T77` tem 3 UPAs em 2 agências.

No R isso duplicava linhas num `left_join` e **inflava a demanda**: o PE
contava 9 domicílios devidos a mais e 23 pendentes a mais. Se a extensão
agrupa zona por agência em qualquer lugar, verificar a mesma armadilha. A
política adotada (igual a `pns.zonas/R/map_corredores.R:291`) é rotular a
zona como ambígua em vez de atribuí-la a uma agência arbitrária.

## 7. `isPendente` muda — como consequência do passo 1

> Não é conserto independente: as duas correções abaixo **exigem** o
> relatório de biomarcadores. Mesma natureza do §4.

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

Na nova página os dois recortes ficam triviais: **toda linha do relatório de
biomarcadores já é da subamostra**, e `status` dá o segundo filtro
diretamente.

Manter o aninhamento (`isRealizadaSemAgendamento` ⊂ `isPendente`) e o
tooltip que impede o leitor de somar as duas colunas.

## 8. Como buscar o relatório DENTRO da extensão

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

## 9. Cabeçalhos literais da tabela

A extensão casa cabeçalho por texto; se errar, falha fechado. **Cuidado: a
tabela do R não é um de-para direto.** `fetch_biomarcadores_municipio()`
aplica `sub("^#?!", "", …)` e depois `janitor::clean_names()`
(`sigc_biomarcadores.R:174-175`) antes de renomear
(`:177-200`). Ou seja, o nome no R passou por duas transformações — não dá
para invertê-lo por adivinhação.

Os cabeçalhos **crus do HTML**, reconstruídos dessa cadeia (o `#!`/`!` é
decoração do SIGC, como no Último Movimento — ver
`ultimo-movimento-map.js:182`):

| cabeçalho no HTML | após `clean_names()` | nome no R |
|---|---|---|
| `Controle` | `controle` | `controle` |
| `N.º Domicilio` | `n_domicilio` | `domicilio` |
| `UF` | `uf` | `id_uf` |
| `Agência` | `agencia` | `id_agencia` |
| `Município` | `municipio` | `municipio` |
| `Id Zona` | `id_zona` | `id_zona` |
| `Nome Zona` | `nome_zona` | `nome_zona` |
| `Tipo Entrevista` | `tipo_entrevista` | `tipo_entrevista` |
| `Nome Equipe` | `nome_equipe` | `nome_equipe` |
| `Status` | `status` | `status` |
| `SIAPE Agendamento` | `siape_agendamento` | `siape_agendamento` |
| `Data Resposta 25A.01` | `data_resposta_25a_01` | `data_resposta_25a01` |
| `Data Agendada` | `data_agendada` | `data_agendada` |
| `Data Visita Biomarcadores` | `data_visita_biomarcadores` | `data_visita` |
| `SIAPE Coleta Biomarcadores` | `siape_coleta_biomarcadores` | `siape_coleta` |
| `Data Final para Coleta` | `data_final_para_coleta` | `data_final_coleta` |
| `Dias Prazo Final` | `dias_prazo_final` | `dias_prazo_final` |
| `Data Hora Coleta Sangue` | `data_hora_coleta_sangue` | `data_hora_sangue` |
| `Status Sangue` | `status_sangue` | `status_sangue` |
| `Motivo Sangue` | `motivo_sangue` | `motivo_sangue` |
| `Data Hora Coleta Urina` | `data_hora_coleta_urina` | `data_hora_urina` |
| `Status Urina` | `status_urina` | `status_urina` |
| `Motivo Urina` | `motivo_urina` | `motivo_urina` |
| `Dias entre 1º agendamento e coleta` | `dias_entre_1_agendamento_e_coleta` | `dias_agendamento_coleta` |

Duas linhas merecem atenção porque `clean_names()` as deforma de um jeito
que não se adivinha: `Data Resposta 25A.01` → `data_resposta_25a_01`
(quebra na fronteira dígito/letra) e `Dias entre 1º agendamento e coleta`
→ `dias_entre_1_agendamento_e_coleta`.

**Confirmar a coluna do HTML contra uma captura viva antes de codificar** —
a tabela acima é derivada, não observada. Como a extensão roda na própria
página, isso é um `Ctrl+Shift+I` e ler os `<th>` de `#tableRelatorio`. Usar a
mesma normalização de rótulo que os parsers existentes
(`normalizeLabel`), que já lida com o prefixo `#!`/`!`.

## 10. Decisões de UX ainda em aberto

1. **~~Em que página a funcionalidade vive~~** — resolvido, ver topo.
2. **~~Custo do fan-out~~** — dissolvido pela decisão de página: o recorte é
   o do filtro, uma requisição.
3. **Os volumes citados aqui são do snapshot de 14/08/2026** e mudam todo
   dia. Servem para conferir a implementação contra este documento, **não
   como critério de aceitação**. (O histórico SCD de biomarcadores começa em
   13/08/2026 18:19.)
4. **O que fazer com o mapa do Último Movimento.** Duas ferramentas na mesma
   extensão, ou aposentar a versão-proxy quando esta estiver de pé. Ver
   passo 4 da ordem.

## 11. O mapa: o lado do R já foi feito

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

### Clique na linha inteira atrapalha copiar

`wireZonaRowClicks()` (`:749`) põe o handler na `<tr>`. No R isso foi
desfeito por pedido de uso real: selecionar um código de controle para
copiar disparava a navegação e a tabela sumia debaixo do cursor.

Mover o clique para um alfinete (📍) numa primeira coluna estreita — no R é
um `<span role="button" tabindex="0" title="Ver no mapa">`. Ganha-se também
deixar explícito o que é clicável. Cuidado: acrescentar coluna desloca os
índices de ordenação e de filtro (no DataTables, marcar a coluna do alfinete
como não-ordenável).

### O que NÃO portar

**Nome do entrevistador.** No R vem da tabela `usuarios` (siape → nome), de
um endpoint em outro host (`w3servicosigc.ibge.gov.br`), um request por
siape, com throttle. Não vale o custo aqui: **mostrar o siape**, como a
extensão já faz.

---

## Ordem sugerida

O trabalho é **construir no Relatório de Biomarcadores**, não consertar o
proxy. Boa parte do que hoje está em `ultimo-movimento-map.js` sai fora,
então não vale poli-lo antes.

1. **Montar na nova página.** Detecção de página análoga a
   `onUltimoMovimento()`, captura de `#filtroJson` no `#btnFiltrar`,
   `motivoBloqueio()` reaproveitado (agência/município/controle), POST via
   `postRelatorio` com `slug=relatorio-acomp-biomarc`, parse de
   `#tableRelatorio` contra os cabeçalhos do §9 — **conferindo-os ao vivo
   primeiro**.
2. **Ler `status`** e derivar a demanda dele (§3), substituindo
   `isRealizadaSemAgendamento`. A zona vem do próprio relatório
   (`id_zona`/`nome_zona`), o que dispensa o join com a Lista de Endereços
   **para agrupar** — mas não para coordenadas.
3. **Alerta de prazo** (§5), incluindo o piso da janela de agendamento nos
   slots livres. É o que o proxy nunca conseguiu fazer, porque
   `data_final_coleta` só existe neste relatório.
4. **Cor por status de biomarcador** e as duas recusas separadas (§11, §4).
   Sai como consequência do passo 2.
5. **Decidir o destino do mapa do Último Movimento** (§10.4). Se aposentado,
   apagar a lógica de "devido" baseada em `ultimaPosicao` e os comentários
   que a sustentam — em vez de corrigi-los agora e deletá-los depois.

As correções do §1 valem como **insumo do código novo**, não como edição do
antigo. A que não pode se perder é a da cobertura: o comentário atual afirma
que a fonte autoritativa cobre ~48% e por isso não serve. É falso (cobre
100%), e é exatamente o argumento que hoje sustenta ficar no proxy.

Se a migração for adiada, aí sim vale aplicar o §1 sozinho — os números de
hoje afirmam coisas falsas com aparência de medição.

### Alcançável hoje, sem depender da migração

- **Rotular "Recusa da entrevista"** onde a UI hoje escreve só "Recusa". A
  extensão só enxerga essa recusa; nomeá-la evita que seja lida como recusa
  da coleta. Mesmo cuidado com `Outro Motivo`.
- **Alfinete no lugar do clique na linha** — incômodo real em uso.
- **Piso da janela de agendamento** nos slots livres (§5). Não depende do
  relatório de biomarcadores: é aritmética de calendário sobre os slots que
  a extensão já lê, e hoje é uma divergência silenciosa com o R.

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
