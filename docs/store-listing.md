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
  número de selecionados) no cabeçalho.
• KML-pro — exporta os endereços como KML para uso em Google Earth,
  Google Maps ou QGIS, com camadas separadas para domicílios
  selecionados e não selecionados (cores seguras para daltonismo).

No relatório Último Movimento, filtrado por uma agência:
• Mapa-pro — abre um painel com três abas. Mapa: os domicílios da
  agência no mapa, agrupados e coloridos por zona, com a entrevista
  agendada de cada um. Zonas: a situação de coleta de cada zona —
  inclusive as que ainda não tiveram coleta — quantos domicílios estão
  agendados e quantos não, e os horários ainda livres, listados dia a
  dia. Domicílios: a lista completa, com zona, entrevista agendada,
  situação, tipo e entrevistador, ordenável por qualquer coluna. As
  coordenadas e a agenda vêm do próprio servidor do SIGC, mediante
  clique e confirmação.

Em qualquer relatório com tabela:
• CSV-pro — exporta a tabela como CSV (todas as páginas, pronto para o
  Excel brasileiro), contornando um problema conhecido do portal que
  impede o download pelos botões nativos de CSV/Excel fora da rede VPN.

No relatório Último Movimento:
• CSV TODAS — exporta o relatório de todas as agências da UF atual
  (não só a selecionada na tela) em um único CSV, uma requisição por
  agência ao próprio servidor do SIGC. Confirma antes de rodar,
  informando quantas agências serão consultadas.

Em Administrar Agenda:
• CSV-PRO — exporta os slots do calendário (dia/semana em exibição) com
  Controle, Domicílio, nome, endereço, telefone etc. já separados em
  colunas.
• Verificar Slots — alerta sobre slots abertos agendados dentro do prazo
  mínimo de agendamento e sobre zonas cujo nome não corresponde à equipe.
• Slots Abertos — na visão Semana, um painel com a tabela zona × turno
  dos slots ainda abertos sobre o total de cada zona, para decidir onde
  há capacidade a abrir.
• Guia do Dia — guia HTML autônomo com abas: resumo do dia (com grade
  horário × equipe dos slots), aba Lab compartilhável com o laboratório
  (hora, nome, município e zona por slot, sem Controle nem domicílio)
  e, por equipe, os cartões de cada visita — pronto para imprimir por
  aba. Ao clicar, oferece obter do próprio servidor do SIGC (mediante
  confirmação) as coordenadas, a zona real, a agência e o entrevistador
  de cada visita, para incluir também o mapa da rota do dia, link de
  navegação por visita e seleção de paradas por checkbox (até 9 por
  rota, com link do Google Maps atualizado em tempo real); recusando a
  consulta, o guia é gerado do mesmo jeito, sem esses dados extras.
• Seletor de data — botão de calendário para pular direto a uma data.

PRIVACIDADE: nenhum dado do SIGC sai do circuito usuário–IBGE. A
extensão não solicita NENHUMA permissão do navegador e não armazena
nada; todos os arquivos são gerados localmente e salvos pelo mecanismo
padrão de download do Chrome. As consultas de dados — Guia do Dia, Mapa-pro e
exportação multi-agência do Último Movimento — vão todas ao próprio servidor
do SIGC (mesma sessão do usuário), acionadas por clique e confirmação.

O único recurso externo é o fundo cartográfico do Mapa-pro: as imagens
de mapa (tiles) do OpenStreetMap, buscadas apenas após uma confirmação
própria e separada — recusando, as abas Zonas e Domicílios continuam
funcionando. Nenhum dado do SIGC acompanha esse pedido, e a biblioteca
de mapa vem dentro da extensão, não de um CDN.

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
Último Movimento report, and Agenda helpers (CSV export, slot checks,
open-slot capacity panel, printable day guide, date picker), without
modifying the portal's native features. It requests no browser
permissions and stores nothing.
```

## Host permission justification (dashboard field)

```
The extension injects a content script only on pages of the SIGC portal
(Sistema Integrado de Gestão da Coleta, IBGE) — matched by
`portalweb.ibge.gov.br`, `portalweb2.ibge.gov.br`, and
`w3sigcpns2025.ibge.gov.br`, the specific hosts SIGC is served from,
not the whole ibge.gov.br domain — to add
export buttons (PDF, KML, CSV) to report toolbars
and Agenda helpers (CSV export, slot checks, open-slot capacity panel,
printable day guide, date picker), reading data already rendered on the
page. No access to any
other site is requested. **No browser permission is declared at all** —
the manifest's `permissions` list is empty and nothing is stored. The extension
makes no network calls except three optional, click-and-confirm requests
to the SIGC server itself (same origin, within the user's existing
session): the "Guia do Dia" feature; "Mapa-pro" on the Último Movimento
report, which fetches the filtered agência's Lista de Endereços (for
coordinates and zona) and the UF's agenda slots; and a bulk "Último Movimento" report
export that loops one request per agência in the current UF, behind a
confirmation naming how many agências will be queried. The exported files may include
Google Maps links (not loaded resources — nothing is fetched until
clicked). The one external resource is the map background in "Mapa-pro":
OpenStreetMap tiles, fetched only after a separate confirmation, carrying
no SIGC data (the Leaflet library itself is bundled, not loaded from a
CDN). Nothing is ever sent to the developer, and there is no telemetry.
```

## Storage permission justification (dashboard field)

**Not applicable.** The extension declares no `storage` permission — its
`permissions` list is empty. (Until 0.2.174 it stored one boolean for an
advanced-export flag; that flag and its Options page were retired, and the
permission was dropped with them.) Leave this field blank / do not request
the permission.

## Data safety / Privacy practices (dashboard form — required to submit)

"Collect" here means Google's definition: **transmitting data off the user's
machine**. Reading data already on the page, showing it, and saving a file
locally are not collection. Every answer below is No, and none of them changed
between 0.2.124 and 0.2.174.

| Data type | Answer | Why |
|---|---|---|
| Personally identifiable information | **No** | Names/addresses/telephones are read from the SIGC page the user is already authenticated on, rendered locally, and written to files the user downloads. Nothing is transmitted anywhere. |
| Health information | **No** | PNS data is displayed and exported locally; never sent to the developer or any third party. |
| Financial and payment information | **No** | Never handled. |
| Authentication information | **No** | The extension never reads, stores or transmits credentials, cookies or tokens. Requests reuse the page's existing session (`credentials: 'same-origin'`) — the browser attaches the cookie, the extension never sees it. |
| Personal communications | **No** | Never handled. |
| Location | **No** | Household coordinates are read from the SIGC report and plotted locally. They are never transmitted. Google Maps links are `href`s the user may click; nothing is fetched until they do. |
| Web history | **No** | Never handled. |
| User activity | **No** | No analytics, no telemetry, no click tracking. |
| Website content | **No** | Page content is read and reformatted in the page; it is not sent anywhere. |

Required certifications — all three can be affirmed:

- [x] Not being sold to third parties, outside of approved use cases
- [x] Not being used or transferred for purposes unrelated to the item's core functionality
- [x] Not being used or transferred to determine creditworthiness or for lending purposes

### If a reviewer asks about network activity

Two things are worth having ready, because they are the only outbound requests
and one of them is new since 0.2.124:

1. **Same-origin SIGC requests** (Guia do Dia, Mapa-pro, CSV TODAS) — all to the
   IBGE server the user is already on, inside their authenticated session, each
   behind a click and a confirmation. These fetch *from* the origin; nothing is
   sent to anyone else.
2. **OpenStreetMap tiles** (`https://{s}.tile.openstreetmap.org/...`) — the map
   background in Mapa-pro, **new in this version**. It is an image request
   behind its own separate confirmation. No user or SIGC data is attached: the
   URL carries only zoom/x/y indices of map squares. Declining leaves the
   Zonas and Domicílios tabs fully functional.

Related points a reviewer may raise about this version:

- **Leaflet is bundled** in `extension/vendor/leaflet/` and declared in
  `web_accessible_resources` (new since 0.2.124), loaded via
  `chrome.runtime.getURL`. It is not fetched from a CDN — MV3 forbids remote
  code, and this is the compliant arrangement. Map *imagery* cannot be bundled,
  which is why tiles are external.
- **No permissions at all.** The `permissions` list is empty and there are no
  `host_permissions`. Its
  requests run in the page's own context (MAIN world), so they are same-origin
  to the page rather than cross-origin extension requests.
- **Nothing is persisted at all.** The `permissions` list is empty; there is
  no `chrome.storage`, `localStorage`, cookie or IndexedDB use anywhere.
  Consent flags and caches live in memory and are gone on reload.

## Category

Productivity (or "Tools" if available for the target region)

## Screenshots needed (1280x800 or 640x400, at least 1, up to 5)

1. Toolbar close-up: native buttons + PDF-pro/KML-pro/CSV-pro side by side
   (already captured informally during development — recreate cleanly).
2. Mapa-pro: the panel's Mapa tab, domicílios coloured by zona.
3. PDF-pro output: listagem-style PDF page.
4. (optional) Mapa-pro: the Zonas tab, showing per-zona status and the
   free slots listed day by day.
5. (optional) KML-pro opened in Google Earth, or the Agenda's Guia do Dia
   with its tabs.

Screenshots must not show real respondent data (names, addresses,
telephones) — use a test agência or blur them.

## Privacy policy URL

https://leoniedu.github.io/sigc-pro/PRIVACY_POLICY.html

## Store visibility

Unlisted (installable only via direct link, not searchable).
