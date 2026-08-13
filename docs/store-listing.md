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

No relatório Último Movimento, com um flag avançado ativado nas Opções
da extensão:
• CSV TODAS — exporta o relatório de todas as agências da UF atual
  (não só a selecionada na tela) em um único CSV, uma requisição por
  agência ao próprio servidor do SIGC.

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
extensão solicita apenas a permissão "storage" do navegador, usada só
para lembrar o estado do flag avançado acima (Opções da extensão); todos
os arquivos são gerados localmente e salvos pelo mecanismo padrão de
download do Chrome. As consultas de dados — Guia do Dia, Mapa-pro e
exportação avançada do Último Movimento — vão todas ao próprio servidor
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
modifying the portal's native features.
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
other site is requested. The only browser permission declared is
`storage`, used solely to remember the on/off state of one advanced,
off-by-default flag (set on the extension's own Options page) that
gates a bulk export feature; no other data is stored. The extension
makes no network calls except three optional, click-and-confirm requests
to the SIGC server itself (same origin, within the user's existing
session): the "Guia do Dia" feature; "Mapa-pro" on the Último Movimento
report, which fetches the filtered agência's Lista de Endereços (for
coordinates and zona) and the UF's agenda slots; and — only when the
advanced flag above is enabled — a bulk "Último Movimento" report export
that loops one request per agência in the current UF. The exported files may include
Google Maps links (not loaded resources — nothing is fetched until
clicked). The one external resource is the map background in "Mapa-pro":
OpenStreetMap tiles, fetched only after a separate confirmation, carrying
no SIGC data (the Leaflet library itself is bundled, not loaded from a
CDN). Nothing is ever sent to the developer, and there is no telemetry.
```

## Storage permission justification (dashboard field)

```
The extension uses chrome.storage.local to persist a single
on/off flag: the "CSV TODAS" advanced export feature on the
Último Movimento report. The flag is off by default and can only
be toggled on the extension's own Options page
(chrome://extensions → Opções). No other data is stored — no
user preferences, no credentials, no cached responses, no
analytics. The flag exists because the feature loops one
same-origin request per agência in the current UF, which is
deliberately noisy; requiring an explicit opt-in prevents
accidental activation.
```

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
