# Consolidar AGENDA PRO no Mapa do Último Movimento

Data: 2026-08-11
Estado: aprovado (brainstorming), pendente de plano de implementação

## Problema

Duas features juntam os MESMOS dois conjuntos de dados a partir de pontas
opostas:

| | AGENDA PRO (Lista de Endereços) | Mapa (Último Movimento) |
|---|---|---|
| Página | Lista de Endereços | Último Movimento |
| Tem nativamente | endereço, coordenadas, zona | controle, domicílio, entrevistador, situação, tipo, data |
| Busca por rede | Último Movimento + Agenda | Lista de Endereços |
| Junta por | `controle\|domicilio` | `controle\|domicilio` |
| Entrega | arquivo HTML baixado | painel Leaflet ao vivo |

Cada lado busca exatamente o que o outro já tem na tela. O caso mais claro:
em 2026-08-11 `indexMovimento` (lista-agenda.js) passou a ler a coluna
Entrevistador do relatório de Último Movimento — um campo que
`ultimo-movimento-map.js` já lê nativamente em
`ULTIMO_MOVIMENTO_MAP_LABELS`. Esse trabalho vira desnecessário aqui.

Os dois MAPAS (SVG em `agenda-day-guide/route-map.js`, Leaflet em
`ultimo-movimento-map/`) NÃO são a duplicação: são artefatos diferentes
(um impresso/offline, um vivo/interativo) e ambos continuam existindo.

## Decisão

O Último Movimento passa a ser a casa única, porque é o lado que já possui
o registro por domicílio mais rico. As coordenadas são a única coisa que
ele precisa buscar.

O botão AGENDA PRO da Lista de Endereços é removido, junto com o download
da tabela HTML. As funções puras de agenda migram para o Mapa.

## Estrutura: três abas

Painel existente (`buildPanelHtml`), hoje com duas abas:

- **Mapa** — inalterado, mais uma seção "Agendamentos" no popup
- **Zonas** — contagens inalteradas, mais a lista de slots abertos por zona
- **Domicílios** (nova) — a tabela ordenável, agora aba em vez de download

### Popup (aba Mapa)

Abaixo de "Zona", quando existe agendamento para aquele
`controle|domicilio`:

    Agendado: 01/09/2026 09:00

Estilo futuro/passado como a tabela já faz (negrito verde / cinza). Quando
não há agendamento, a linha simplesmente não aparece — nada de "—" em
popup.

### Aba Zonas

Cada linha de zona expande (clique) para seus slots ABERTOS agrupados por
dia, reusando o markup de `buildSlotsLivresHtml`. São os horários reais,
não apenas a contagem.

O clique no NOME da zona mantém a função atual (focar a zona no mapa), então
a expansão precisa de um alvo próprio — célula separada ou caret — em vez de
roubar esse gesto.

### Aba Domicílios

Colunas da tabela baixada hoje: Endereço, Domicílio, Agendado, Situação,
Tipo, Entrevistador, Data. Ordenável. Escopo: a agência filtrada.
Entrevistador vem direto da página de Último Movimento, sem re-derivação.

## Aquisição de dados

Um clique, um consentimento, duas buscas same-origin.

### Coordenadas (Lista de Endereços)

Regras, em ordem de importância:

1. **Cachear `fetchEnderecosByAgencia`** por `uf|agencia`, em memória, pelo
   tempo de vida da página — espelhando `enderecosCache`. Corrige defeito
   real: hoje a função é explicitamente não-cacheada com a justificativa
   "acontece uma vez por clique no Mapa", premissa que cai quando o painel
   pode ser reaberto e três abas podem re-renderizar.
2. **Nunca buscar em relatório de estado inteiro.** O gate
   `filteredAgencia()` já garante isso: um relatório TODOS deixa o valor
   `''`. Não há lógica de gate nova.
3. **Sem caminho por controle.** Uma forma só: uma agência, uma chamada
   cacheada. O laço por Controle (`fetchEnderecos`) NÃO é reintroduzido —
   escala com o número de linhas, exatamente o que a mudança de 2026-08-10
   eliminou.

Efeito líquido: a consolidação REDUZ o tráfego de coordenadas — uma chamada
cacheada por agência, em vez da atual uma-por-clique.

### Agenda

`fetchAgenda(uf, ${ano}-01-01, ${ano+1}-01-01)` migra literalmente de
lista-agenda.js: UF inteira, ano corrente, filtrada no cliente para os
controles juntados. Cacheada por `uf|ano`, buscada uma vez por tempo de
vida da página e compartilhada pelas três abas.

Janela ampla de propósito: numa tela de "último movimento" os agendamentos
PASSADOS são justamente o que interessa; uma janela curta (hoje → +2
semanas) os descartaria.

É a única chamada que não encolhe com o filtro — mas é uma só, e cacheada.

## Consentimento

Um prompt só, reescrito para nomear os dois propósitos (endereços/
coordenadas E agenda). O consentimento de tiles continua separado: é
terceiro, e genuinamente diferente.

## Estado do botão

O botão MAPA PRO passa a ficar **visível e desabilitado** com tooltip em
português (ex.: "filtre por uma agência para ver o mapa") quando o
relatório não está filtrado por uma agência única — hoje ele some.

Isso alinha com a convenção já escrita em lista-agenda.js: *"Button stays
VISIBLE either way — an absent button is indistinguishable from a broken
extension, a mistake already made once in this project."* Com o Último
Movimento virando a casa única da feature, "o botão sumiu" passa a ser uma
falha bem pior do que era.

## Reuso

Migram como funções puras, já exportadas e já testadas — movidas, não
reescritas:

- `fetchAgenda`, `parseSlots`, `pickAgendado`, `indexByControle`
- `slotsLivresDaJanela`, `agruparPorDia`, `buildSlotsLivresHtml`
- construtores da tabela de domicílios (`buildDomiciliosTable`)

A junção `controle|domicilio` passa a existir UMA vez.

## Fora de escopo

- Os dois mapas (SVG do Guia do Dia, Leaflet do Mapa) continuam separados
- Nenhuma mudança em `route-map.js` / `agenda-day-guide.js`
- Nenhuma consulta a terceiros; nada de coordenada sai da origem

## Sequência de commits

Separados de propósito, para que um revert seja cirúrgico:

1. Cache de `fetchEnderecosByAgencia` + botão visível-e-desabilitado
2. Migração das funções puras de agenda para o módulo compartilhado
3. Aba Domicílios + agendamentos no popup + slots abertos na aba Zonas
4. **Remoção do AGENDA PRO da Lista de Endereços** (commit próprio)

## Questões em aberto

- O download HTML autocontido desaparece. Se for necessário, cabe um botão
  "Baixar" na aba Domicílios reusando o construtor existente — barato,
  mas não incluído até haver demanda.
