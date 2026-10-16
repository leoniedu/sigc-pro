# Chrome Web Store listing draft

## Short description (max 132 chars)

```
Melhorias não oficiais para o SIGC (IBGE): PDF, KML e CSV dos relatórios, mapa de zonas e ferramentas da Agenda, sem coletar dados.
```
(131 chars — limit is 132)

## Detailed description

```
SIGC-PRO adiciona botões azuis às páginas do SIGC (Sistema Integrado de
Gestão da Coleta, IBGE), ao lado dos botões nativos — que não são
alterados.

Na Lista de Endereços:
• PDF-pro — reexporta o PDF no formato listagem clássico do IBGE, com
  colunas reorganizadas e informações-chave (Controle, Situação, Zona,
  número de selecionados) no cabeçalho. Antes de gerar, pergunta o
  tamanho da letra (padrão pré-preenchido) — todos os tamanhos
  acompanham proporcionalmente.
• KML-pro — exporta os endereços como KML para uso em Google Earth,
  Google Maps ou QGIS, com camadas separadas para domicílios
  selecionados e não selecionados (cores seguras para daltonismo).

No relatório Último Movimento e no Relatório de Acompanhamento de
Biomarcadores, filtrados por agência, município ou controle:
• Mapa-pro — abre um painel com cinco abas. Mapa: os domicílios do
  recorte filtrado, coloridos pela situação de cada um, com marcadores
  que crescem com o zoom, destaque para os que estão perto do prazo e
  camadas por agência que podem ser ligadas e desligadas uma a uma;
  domicílios no mesmo endereço abrem em leque, para que nenhum fique
  escondido sob o outro. Zonas (ou Controles): o andamento de cada
  grupo — inclusive os que ainda não tiveram coleta — o que já foi
  coletado, o que está agendado, o que ainda precisa de agendamento e
  quantos horários seguem livres, com os casos mais problemáticos no
  topo. Cada página agrupa pela unidade que sabe responder: o relatório
  de biomarcadores por ZONA, que é a unidade da agenda, e o Último
  Movimento por CONTROLE, a unidade de amostragem — sem consulta à
  agenda não há capacidade por zona a comparar. Entrevistadores: as
  mesmas contagens, por entrevistador, com a transmissão mais recente
  de cada um e as zonas (ou controles) em que tem domicílios; no
  Último Movimento, a aba de Controles também diz quem tem domicílios
  em cada controle. Domicílios: a
  lista completa, com situação, a ação devida em cada caso e um
  pino que leva ao domicílio no mapa — e, em cada linha, o botão Carta,
  que baixa a carta de notificação do domicílio em PDF (uma página,
  campos editáveis), já preenchida com endereço, município, o agente
  que detém o domicílio e o cadastro dele (função, telefone, e-mail),
  consultado no módulo de usuários do SIGC na hora do clique, sem
  armazenar nada; a agência vem do relatório ou do filtro. Em todas as abas, além da busca
  geral, há um filtro por coluna sob cada cabeçalho — para cruzar
  critérios que a busca única não separa (os pendentes DE uma zona, por
  exemplo). Cada aba de dados pode ser baixada em CSV, já com os filtros
  aplicados. E a aba Entenda, que diz de onde vem cada número do painel: o
  que o relatório afirma, o que foi calculado a partir dele e o que é
  apenas provável — para que uma estimativa não seja lida como um fato.
  As coordenadas e a agenda vêm do próprio servidor do SIGC, mediante
  clique e confirmação, no mesmo recorte filtrado na tela.
  No Último Movimento o painel faz uma requisição só (a lista de
  endereços) e omite as colunas que dependem da agenda, em vez de
  mostrá-las zeradas. No relatório de biomarcadores, onde a situação da
  coleta é informada pelo próprio relatório, ele também consulta os
  horários livres da agenda para dizer onde há capacidade.

Em qualquer relatório com tabela:
• CSV-pro — exporta a tabela como CSV (todas as páginas, pronto para o
  Excel brasileiro).

No relatório Último Movimento:
• CSV TODAS — exporta o relatório de todas as agências da UF atual
  (não só a selecionada na tela) em um único CSV, uma requisição por
  agência ao próprio servidor do SIGC. Confirma antes de rodar,
  informando quantas agências serão consultadas.

No relatório Gerenciamento da Coleta:
• GEREN-PRO — painel da UF inteira (Domicílios, Município, Agência)
  com o andamento de cada domicílio e as recusas separadas. Uma requisição ao próprio servidor do SIGC, a partir do clique;
  guarda, só no seu navegador, as contagens por agência (aba Histórico);
  nunca dados de domicílio.

Em Administrar Agenda:
• CSV-PRO — exporta os slots do calendário (dia/semana em exibição) com
  Controle, Domicílio, nome, endereço, telefone etc. já separados em
  colunas.
• Verificar Slots — alerta sobre slots abertos agendados dentro do prazo
  mínimo de agendamento e sobre zonas cujo nome não corresponde à equipe.
• Slots Abertos — na visão Semana, um painel com a tabela zona × turno
  dos slots ainda abertos sobre o total de cada zona, para decidir onde
  há capacidade a abrir.
• Guia do Dia — guia HTML autônomo em que cada domicílio agendado tem
  UM número para o dia inteiro, o mesmo em todas as abas e no mapa —
  para montar rotas misturando equipes sem confusão. Abas: Resumo (a
  lista completa dos domicílios do dia, numerada e em ordem de horário,
  com a equipe em destaque em cada cartão), aba Lab compartilhável com
  o laboratório (agrupada por equipe, com marcador por linha: nº, hora,
  primeiro nome e ano de nascimento, domicílio, município e zona — sem
  Controle, sem nome completo, sem data de nascimento completa) e, por
  equipe, os mesmos cartões — em toda aba, "Ocultar não selecionadas"
  esconde as linhas desmarcadas, inclusive na impressão — pronto
  para imprimir por aba. Ao clicar, oferece obter do próprio servidor
  do SIGC (mediante confirmação) as coordenadas, a zona real, a agência
  e o entrevistador de cada visita, para incluir também o mapa do dia
  (pontos numerados, uma cor só) e a montagem de rota por checkbox em
  cada cartão — inclusive misturando equipes no Resumo (até 9 por rota,
  com link do Google Maps atualizado em tempo real); recusando a
  consulta, o guia é gerado do mesmo jeito, sem esses dados extras.
  Cada cartão traz ainda "abrir no mapa (ponto exato)", que marca a
  coordenada do domicílio sem ajuste: o link de rota manda o Google
  traçar caminho até a rua mais próxima que ele conhece, e o nome de rua
  ou bairro que ele mostra às vezes não é o do domicílio — o guia avisa
  disso sob cada rota.
• Seletor de data — botão de calendário para pular direto a uma data.

PRIVACIDADE: nenhum dado do SIGC sai do circuito usuário–IBGE. A
extensão não solicita NENHUMA permissão do navegador. A única coisa que
guarda, no seu próprio navegador, é o histórico de contagens por agência
do GEREN-PRO (nunca dados de domicílio; há "Limpar histórico"); todos os arquivos são gerados localmente e salvos pelo mecanismo
padrão de download do Chrome. As consultas de dados — Guia do Dia, Mapa-pro
(nos dois relatórios), exportação multi-agência do Último Movimento e a
Carta do Mapa-pro (o cadastro do agente, pela matrícula, no módulo de
usuários do SIGC) — vão todas ao próprio servidor do SIGC (mesma sessão
do usuário), acionadas por clique. Se o módulo de usuários não tiver
sessão iniciada, a extensão abre a página dele em uma aba para o login
único do navegador e a fecha quando ele responde; nunca envia
credenciais nem formulários de autenticação.

O único recurso externo é o fundo cartográfico do Mapa-pro: as imagens
de mapa (tiles) do OpenStreetMap, buscadas apenas após uma confirmação
própria e separada — recusando, as abas Zonas e Domicílios continuam
funcionando, e os CSV de cada aba também. Nenhum dado do SIGC acompanha
esse pedido, e as bibliotecas de mapa e de PDF (e as imagens do timbre
da carta) vêm dentro da extensão, não de um CDN.

Os arquivos gerados contêm links para o Google Maps nos endereços
(quando há coordenadas), que são links, não recursos carregados — nada é
buscado ao abrir o arquivo, e a navegação só ocorre ao clicar. Nada é
enviado ao desenvolvedor, e não há telemetria. Isso é verificado
automaticamente a cada alteração no código-fonte (veja o repositório).

AVISO: projeto independente, sem vínculo oficial com o IBGE. Protótipo
para uso e demonstração à equipe de desenvolvimento do SIGC. Use por sua
conta e risco.

Código-fonte aberto: https://github.com/leoniedu/sigc-pro
```

## Single purpose (dashboard field)

```
Adds unofficial productivity tools to SIGC (IBGE) pages: export buttons
(PDF, KML, CSV) on report tables, a zone map and scheduling panel on the
Último Movimento and Biomarcadores reports with a per-household
notification-letter PDF, and Agenda helpers (CSV export, slot checks,
open-slot capacity panel, printable day guide, date picker), without
modifying the portal's native features. It requests no browser
permissions. The only thing it stores, locally in the browser, is the
GEREN-PRO history of per-agência counts (never household data).
```

## Host permission justification (dashboard field)

Limit: 1000 characters. Current text is 993.

```
The extension injects a content script only on SIGC portal pages (Sistema Integrado de Gestão da Coleta, IBGE), matched by the three hosts SIGC is served from — portalweb.ibge.gov.br, portalweb2.ibge.gov.br and w3sigcpns2025.ibge.gov.br — not the whole ibge.gov.br domain. It adds export buttons (PDF, KML, CSV), a zone map panel and Agenda helpers, reading data already on the page. No other site is accessed, no permission is declared, nothing is stored.

Network calls are four optional, click-triggered requests to the SIGC server itself, same origin, in the user's session: a printable day guide; a map panel on two reports (address list and agenda slots of the filtered scope); a bulk report export, one request per agência; and a notification-letter PDF, looking up one agent by matrícula in the portal's user module.

The only external resource is the map background: OpenStreetMap tiles, after a separate confirmation, with no SIGC data. Leaflet and pdf-lib are bundled. No telemetry.
```

## Storage permission justification (dashboard field)

**Not applicable.** The extension declares no `storage` permission — its
`permissions` list is empty — and does not use `chrome.storage`. From 0.2.248
it keeps one thing in IndexedDB, in the extension's own origin, owned by a
service worker declared in the manifest (`background.service_worker`):
the GEREN-PRO history, one record per UF per day with agência-level counts
(households per interview-progress label and biomarker-sample yes/no).
IndexedDB needs no permission. Leave this field blank / do not request
the permission.

## Data safety / Privacy practices (dashboard form — required to submit)

"Collect" here means Google's definition: **transmitting data off the user's
machine**. Reading data already on the page, showing it, and saving a file
locally are not collection — and neither is keeping data in the browser's own
IndexedDB (0.2.248, the GEREN-PRO history of per-agência counts, no household
data, never transmitted). Every answer below is No, and none of them has
changed through 0.2.248.

| Data type | Answer | Why |
|---|---|---|
| Personally identifiable information | **No** | Names/addresses/telephones are read from the SIGC page the user is already authenticated on, rendered locally, and written to files the user downloads. Nothing is transmitted anywhere. |
| Health information | **No** | PNS data is displayed and exported locally; never sent to the developer or any third party. |
| Financial and payment information | **No** | Never handled. |
| Authentication information | **No** | The extension never reads, stores or transmits credentials, cookies or tokens. Requests reuse the page's existing session (`credentials: 'same-origin'`) — the browser attaches the cookie, the extension never sees it. When the portal's user module has no session, the extension opens that module's page in a tab for the browser's own single sign-on and polls its own same-origin request until it answers; an authentication redirect is never followed by code (`redirect: 'manual'`), and no form is posted to the sign-in service. |
| Personal communications | **No** | Never handled. |
| Location | **No** | Household coordinates are read from the SIGC report and plotted locally. They are never transmitted. Google Maps links — both the exact-point pin and the multi-stop route — are `href`s the user may click; nothing is fetched until they do, and the coordinate travels only in the URL the user themselves opens. |
| Web history | **No** | Never handled. |
| User activity | **No** | No analytics, no telemetry, no click tracking. |
| Website content | **No** | Page content is read and reformatted in the page; it is not sent anywhere. |

Required certifications — all three can be affirmed:

- [x] Not being sold to third parties, outside of approved use cases
- [x] Not being used or transferred for purposes unrelated to the item's core functionality
- [x] Not being used or transferred to determine creditworthiness or for lending purposes

### What changed since the published 0.2.229

Nothing here affects privacy, permissions or the set of hosts contacted —
the answers in the table above are unchanged. One new kind of same-origin
request was added in 0.2.237 (the notification letter's agent lookup)
and another in 0.2.238–0.2.246 (GEREN-PRO's whole-UF report fetch); see those
entries.

- **0.2.177** — Mapa-pro works on more reports. It used to require the
  Último Movimento report to be filtered to exactly one agência, read off
  that filter's own selector; most user profiles have no agência selector
  at all, so the button was permanently disabled for them. It now reuses
  whatever filter the user submitted (agência, município or controle), so
  the address-list request is scoped exactly as the on-screen report is.
  Same endpoint, same origin, same click-and-confirm, one request — only
  the scoping fields differ.
- **0.2.178** — the toolbar buttons are 8px wider so the longest label
  ("MAPA") is not truncated. Cosmetic.
- **0.2.179–0.2.216** — Mapa-pro also runs on the **Relatório de
  Acompanhamento de Biomarcadores** (`relatorio-acomp-biomarc`), a second
  SIGC report on the same three hosts. This is the one change in this
  range a reviewer should look at, and it adds **no new host, no new
  permission and no new kind of request**: it is the same click-and-confirm,
  same-origin, `credentials: 'same-origin'` POST the panel already made on
  Último Movimento, issued from a second page of the same portal. As
  before, every URL is built from `location.origin` and `location.pathname`
  — no absolute host appears anywhere in the source, and the privacy gate
  in `scripts/check-privacy.sh` fails the build if one does.

  On that report the panel also asks for the UF's free agenda slots, so it
  can say which zones still have capacity. That request already existed for
  Guia do Dia and goes to the same server; on Último Movimento the panel
  still makes a single request and simply omits the agenda-derived columns.

  Everything else in this range is presentation of data already fetched:
  colouring households by collection status, markers that scale with zoom,
  fanning out households that share coordinates, per-agência layer toggles,
  a CSV download button per tab (built from the table already on screen),
  rebuilt Zonas/Domicílios columns, and fixes to counting and labelling.
  No data leaves the user–IBGE circuit at any point.

- **0.2.230–0.2.234** — corrections to the files the extension writes, plus
  per-column filtering in the Mapa-pro panel. No new request, host,
  permission or stored value; nothing here changes what leaves the
  user–IBGE circuit (which remains: nothing).

  - CSV exports wrote `[object Object]` in every column that carries a
    sort key (Prazo, Agendado, Coleta). The cell value was being read
    without unwrapping the table library's sorted-cell form. Affected
    every report's CSV, not only the map panel's.
  - The Domicílios tab showed the *agendador's* Siape while the
    Entrevistadores tab counted by the Último Movimento *entrevistador* —
    two different people, so the two tabs disagreed about who holds a
    household. The column now shows the entrevistador both tabs group by.
    As a result the panel no longer reads the two Siape columns at all.
  - The em-dash placeholder ("—") drawn in empty cells is now written as
    an empty field in CSV, where it otherwise forced spreadsheet and
    statistical software to treat whole numeric columns as text.
  - Each table in the panel gained a filter box under every column
    heading, alongside the existing single search box; the CSV download
    now exports what those filters leave, rather than the whole table.

- **0.2.235–0.2.236** — the per-household "abrir no mapa" link on the Guia
  do Dia now pins the exact surveyed coordinate instead of routing to it.
  Both are `href`s the user clicks; no request is made either way, and
  nothing here changes what leaves the user–IBGE circuit (nothing).

  Reported from BA: a stop whose coordinate is in Itapuã, Salvador opened
  in Google Maps captioned as a street in Pernambués, a bairro ~8 km away.
  Google's directions endpoint snaps each coordinate to the nearest road
  IT knows and names the stop after that road, so its street/bairro text
  can be wrong even when the coordinate is right. The single-household
  link now uses the Maps *search* endpoint, which per Google's
  documentation pins a bare lat,lng with "no additional place
  information" — no snapping, no reverse geocoding. The multi-stop route
  link still uses directions, since routing to a road is what it is for,
  and the guide now says under each route that the card's address and the
  exact-point link are what count.

- **0.2.237** — **Carta de notificação**: a per-household button on the
  Mapa-pro Domicílios tab that downloads a one-page PDF notification
  letter (editable form fields, built with the bundled pdf-lib; no
  template or font is fetched). This is the change a reviewer should
  look at. It adds **no new host and no new permission**, and one new
  kind of same-origin request: on click, the agent's record (função,
  telefone, e-mail) is looked up by matrícula in the portal's own user
  module — two `credentials: 'same-origin'` requests to `location.origin`
  through the portal's gateway (the gateway prefix for that module is a
  constant in `common/sigc-common.js`; no absolute URL appears in the
  feature, and the privacy gate's self-test plants one to prove it
  fails). Results are cached in memory for 60 seconds and never stored.
  When the filter is by agência, the UF's agência list is read once to
  name it (the same request CSV TODAS already makes).

  That user module keeps its own session. When it has none, its answer
  is the portal's sign-in redirect page; the extension does not follow
  it (`redirect: 'manual'`) and posts nothing to the sign-in service.
  Instead it opens the module's page in a tab from the user's click, so
  the browser's own single sign-on runs as it would in any tab, and
  repeats its same-origin lookup every 2 seconds for up to 90 seconds,
  closing the tab when the module answers. If sign-in is required, the
  user types it in that tab, never in anything the extension draws.
  The letter is produced either way; without a session it carries only
  the name and matrícula already on the report.

  Also in this release: pdf-lib 1.17.1 and the two letterhead images
  are bundled under `extension/vendor/` and listed in
  `web_accessible_resources`, loaded like Leaflet is.

- **0.2.238–0.2.246** — **GEREN-PRO**: a button next to Filtrar on the
  Gerenciamento da Coleta report opens a panel of that UF's households
  (tabs Domicílios, Município, Agência; counts or % per portal
  interview-progress label; an Amostra Bio filter). **No new host, no
  new permission.** One new same-origin request kind, behind a click: the
  report's own `/relatorio/filtrar` POST for the whole UF, through the same
  shared helper CSV TODAS and the Mapa already use (which moved into
  `common/sigc-common.js`; as a side effect those requests now also send the
  report page as the referrer, a same-origin header). The result lives in
  memory for 5 minutes and is never stored. The panel helpers shared with
  the Mapa moved to `common/sigc-panel.js`; no network code there.

- **0.2.248** — **GEREN-PRO history (Histórico tab)**. This is the change a
  reviewer should look at: **the extension now stores data locally for the
  first time**, and the manifest gains a service worker. It adds **no
  permission and no host**. What is stored: after each real fetch of the
  GEREN-PRO report, one record per UF per day in IndexedDB — counts of
  households per agência × interview-progress label × biomarker-sample
  yes/no, plus household refusals per agência. Nothing that identifies a
  household (no controle, domicílio, name, address or telephone). It never
  leaves the browser, can be exported as CSV and erased with a button, and is
  removed with the extension. How: IndexedDB opened by the extension's own
  service worker (`background.service_worker`, module) on the extension's
  origin; an ISOLATED content script relays to it with
  `chrome.runtime.sendMessage` (no permission needed) and the page-side code
  reaches that relay through DOM attributes, not `postMessage` (the portal's
  F5 rewriting layer swallows it). `scripts/check-privacy.sh` permits
  `indexedDB` in exactly one directory, forbids any network API there, and
  still bans `chrome.storage`, `localStorage`, `sessionStorage` and cookies
  everywhere; its self-test plants each of those to prove it fails.

### If a reviewer asks about network activity

These are the only outbound requests. The first two were already present in
the published 0.2.176 and are unchanged in kind; 0.2.237 adds the user-module
lookup and 0.2.238–0.2.246 the GEREN-PRO report fetch to the same-origin list,
on the same hosts:

1. **Same-origin SIGC requests** (Guia do Dia, Mapa-pro, CSV TODAS, Carta, GEREN-PRO) — all
   to the IBGE server the user is already on, inside their authenticated
   session, each behind a click (and, for the three bulk ones, a
   confirmation). These fetch *from* the origin; nothing is sent to anyone
   else.
2. **OpenStreetMap tiles** (`https://{s}.tile.openstreetmap.org/...`) — the map
   background in Mapa-pro. It is an image request behind its own separate
   confirmation. No user or SIGC data is attached: the URL carries only
   zoom/x/y indices of map squares. Declining leaves the Zonas and Domicílios
   tabs fully functional.

Related points a reviewer may raise:

- **Leaflet and pdf-lib are bundled** in `extension/vendor/` (with the
  letter's two letterhead images) and declared in
  `web_accessible_resources`, loaded via `chrome.runtime.getURL`. Nothing is
  fetched from a CDN — MV3 forbids remote code, and this is the compliant
  arrangement. Map *imagery* cannot be bundled, which is why tiles are
  external.
- **No permissions at all.** The `permissions` list is empty and there are no
  `host_permissions`. Its requests run in the page's own context (MAIN world),
  so they are same-origin to the page rather than cross-origin extension
  requests.
- **One thing is persisted, locally.** The `permissions` list is empty and
  there is no `chrome.storage`, `localStorage` or cookie use anywhere.
  IndexedDB is used in exactly one place (`features/gerenciamento-historico/`,
  enforced by the privacy gate, with no network code allowed there): the
  GEREN-PRO history, counts per agência per day, no controle, domicílio,
  name or address. It stays in the user's browser, is exportable as CSV and
  erased by "Limpar histórico" or by removing the extension. Consent flags and
  other caches live in memory and are gone on reload.

## Category

Productivity (or "Tools" if available for the target region)

## Privacy policy URL

https://leoniedu.github.io/sigc-pro/PRIVACY_POLICY.html

## Store visibility

Unlisted (installable only via direct link, not searchable).
