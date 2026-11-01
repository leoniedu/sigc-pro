# Prompt para rodar em `pns.zonas`

> Escrito em 15/08/2026 a partir do trabalho feito na extensão SIGC-PRO
> (repositório `sigc-pro`). Tudo abaixo foi medido contra
> `output/questionarios/29/parquet/` (BA, estado atual, `until_ts IS NULL`).
> **Nada aqui foi alterado no lado R** — este arquivo é o pedido, não o
> resultado.

## Contexto

`scripts/relatorio_agenda.R` e a extensão relatam os mesmos dados e devem
concordar. A extensão foi reescrita nesta sessão e três coisas que ela
descobriu ainda não existem do lado R. Uma delas muda números publicados.

---

## 1. A regra de elegibilidade por idade (a mais importante)

**O R não conhece esta regra.** Não há nenhuma menção a idade mínima em
`R/sigc_biomarcadores.R` nem em `scripts/relatorio_agenda.R`, e
`morador_selecionado` só aparece em `R/sigc_exportar.R` e
`R/sigc_parse_moradores.R` — é parseado e gravado, nunca usado em análise.

Medido na BA, cruzando `biomarcadores.parquet` com o morador selecionado de
`moradores/`:

| idade do selecionado | coletados | não iniciados |
|---|---|---|
| **< 35** | **0** | 92 |
| ≥ 35 | 128 | 38 |

- Idade mínima entre TODOS os coletados: **35**
- Idade máxima entre os `Não iniciado` com selecionado < 35: **34**
- Zero exceções em 1.860 domicílios.

Ou seja: **domicílio cujo morador sorteado tem menos de 35 anos nunca terá
coleta.** Isso bate com a taxonomia de situação da entrevista usada em
campo, cuja última linha é literalmente "Finalizada completa (até parte 24)
– UPA com Bio e **selecionado <35 anos**" — um estado terminal.

**Pedido:** verificar esta regra nas outras UFs (PE/MA/RJ) e, confirmando,
separar esses domicílios da demanda. Hoje eles entram em `pendentes` e
possivelmente em `realizadas_sem_agendamento`, inflando a demanda com
trabalho que nunca acontecerá.

Perguntas a responder com dados, não por suposição:
- A regra é 35 anos exatos em todas as UFs?
- Existe alguma coleta com selecionado < 35 em qualquer UF?
- Quantos domicílios por UF saem da demanda ao aplicá-la?

## 2. O que é `25A.01`, e o que os "sem prazo" realmente são

O `data_final_coleta` nasce da resposta ao item **25A.01**, que a extensão
tratava como uma caixa-preta. Lendo `respostas/` descobrimos o enunciado:

> **25A.01 — ENTREVISTADOR(A): Deseja iniciar o agendamento para a coleta de
> sangue e urina?** (variável `VA25001`, módulo P25 "Apêndice 2 —
> Questionário de Coleta de Dados para Material Biológico")

Não é um portão do domicílio: é a pergunta feita **ao entrevistador**, no
último módulo do questionário. Na BA, 254 domicílios responderam (193 "Sim",
61 "Não").

Consequência medida: dos 141 domicílios com entrevista `Realizada` e **sem
prazo**, **nenhum** respondeu 25A.01 — mas **132 já têm morador
selecionado** e **81 chegaram até o módulo P24 (Antropometria)**, o módulo
imediatamente anterior ao P25.

**Pedido:** decidir como o R trata esse grupo. Não são "demanda futura"
genérica: são entrevistas que pararam a um passo do agendamento. A extensão
os separou numa coluna própria ("Sem agendamento iniciado"), distinta de
quem nunca foi distribuído e de quem já tem prazo correndo.

## 3. Vencidos escondidos dentro de "pendente"

Medido na BA: dos 29 domicílios que a extensão classifica como
`Agendamento pendente` (prazo correndo, sem horário marcado), **2 já estão
com o prazo vencido**. Uma fila de 29 novos e uma de 29 já estourados
exigem decisões diferentes e apareciam idênticas.

O R já calcula `dias_para_prazo` (negativo quando vencido) e já tem a aba
`alerta_prazo`. **Pedido:** verificar se as abas de zona (`zonas`,
`capacidade`) distinguem vencidos de não vencidos, e se não, acrescentar a
contagem — o número já existe, é só não estar somado à parte.

## 4. A janela seg-sex (divergência conhecida e deliberada)

A extensão **não** replica o recorte seg-sex de `relatorio_agenda.R`. O
motivo: esse recorte só vale porque hoje não existe slot de fim de semana no
SIGC; nada o proíbe, e um sábado daqui a três semanas é capacidade real.
Excluí-lo subestimaria a zona.

O fim de semana continua entrando no **prazo** (a sexta cujo primeiro dia
agendável vira +4), o que a extensão portou de `primeiro_dia_agendavel()`
sem mudança.

**Pedido (já combinado com o usuário):** remover a restrição seg-sex da
janela de capacidade no R. Quando isso acontecer os dois lados voltam a
concordar. A extensão não precisa mudar.

## 5. Confirmações — coisas que o R já faz certo

Verificadas nesta sessão, nenhuma ação necessária. Registradas para não
serem "consertadas" por engano:

- **`Referer` nas chamadas ao SIGC.** O R envia
  `Referer: <base>/relatorio/<slug>` em todas elas (8 ocorrências em `R/`).
  A extensão **não** enviava, e por isso recebia respostas truncadas — 180
  linhas para um recorte de 1.185, ou uma página sem `#tableRelatorio`. Já
  corrigido do lado da extensão; o R sempre esteve certo.
- **Uma chamada por UF para `ListaEnderecos`**, sem paginação, com apenas
  seis campos no filtro (`R/sigc_enderecos.R:51`). Traz 7.140 endereços da
  BA com **zero** coordenadas faltando e cobertura de 100% da subamostra de
  biomarcadores. Foi a referência que provou que a falha era da extensão.
  Em particular: **`IdZona` não é campo válido nesse relatório** — a
  extensão tentou enviá-lo e recebeu uma página sem tabela.
- **Raio por zoom no mapa** (`R/map_corredores.R:1262-1268`) e o realce do
  urgente. Portados para a extensão como estão.
- **`primeiro_dia_agendavel()`** e `JANELA_DIAS = 17`. Portados sem
  alteração.

## Como verificar

Os parquets das 4 UFs estão em `output/questionarios/<uf>/parquet/`. Toda
medição citada aqui é reproduzível com `arrow::read_parquet()` +
`filter(is.na(until_ts))` para o estado atual. O morador selecionado sai de
`moradores/` (`morador_selecionado == TRUE`), e o enunciado das perguntas de
`respostas/` (coluna `pergunta`, filtrando `modulo == "P25"`).

**Medir contra o estado atual, nunca contra o histórico cru** — foi essa
confusão que gerou percentuais errados numa rodada anterior deste trabalho.
